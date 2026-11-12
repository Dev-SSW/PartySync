package github.partysync.availability;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import github.partysync.common.ApiException;
import github.partysync.group.GroupService;
import github.partysync.groupmember.GroupMember;
import github.partysync.groupmember.GroupMemberRepository;
import github.partysync.groupmember.auth.MemberPrincipal;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import static github.partysync.availability.AvailabilityResponses.*;

/** 일정 저장·권한 검증·최종 시간표 구성을 담당한다. */
@Service
public class AvailabilityService {
    private final WeeklyAvailabilityRepository weekly;
    private final AvailabilityOverrideRepository overrides;
    private final AvailabilityOverrideSlotRepository slots;
    private final GroupMemberRepository members;
    private final GroupService groups;

    public AvailabilityService(WeeklyAvailabilityRepository weekly, AvailabilityOverrideRepository overrides,
                               AvailabilityOverrideSlotRepository slots, GroupMemberRepository members,
                               GroupService groups) {
        this.weekly = weekly;
        this.overrides = overrides;
        this.slots = slots;
        this.members = members;
        this.groups = groups;
    }

    /** 본인의 주간 반복 일정을 전체 교체한다. */
    @Transactional
    public WeeklySchedule replaceWeekly(MemberPrincipal principal, AvailabilityRequests.WeeklyUpdate request) {
        // 요청 구간을 요일별로 묶는다.
        Map<DayOfWeek, List<Slot>> byDay = new EnumMap<>(DayOfWeek.class);
        for (var slot : request.slots()) {
            byDay.computeIfAbsent(slot.dayOfWeek(), ignored -> new ArrayList<>())
                    .add(new Slot(slot.startMinute(), slot.endMinute()));
        }

        List<WeeklySlot> normalized = new ArrayList<>();
        // 모든 요일의 겹침을 검사하고 맞닿은 구간을 합친 뒤 DB를 변경한다.
        byDay.forEach((day, values) -> AvailabilityCalculator.normalizeInput(values)
                .forEach(slot -> normalized.add(new WeeklySlot(day, slot.startMinute(), slot.endMinute()))));

        // 같은 멤버의 동시 수정을 잠금으로 순서대로 처리한다.
        lockMember(principal);
        weekly.deleteForMember(principal.groupMemberId());
        // 벌크 삭제로 컨텍스트가 비워졌으므로 멤버 참조를 다시 얻는다.
        GroupMember member = members.getReferenceById(principal.groupMemberId());
        // 삭제와 저장은 같은 트랜잭션이므로 저장 실패 시 기존 일정도 복구된다.
        weekly.saveAllAndFlush(normalized.stream().map(slot -> new WeeklyAvailability(
                member, slot.dayOfWeek(), slot.startMinute(), slot.endMinute())).toList());
        return new WeeklySchedule(List.copyOf(normalized));
    }

    /** 본인의 반복 일정을 요일·시작 시간 순으로 조회한다. */
    @Transactional(readOnly = true)
    public WeeklySchedule getWeekly(MemberPrincipal principal) {
        // 요일 문자열 순서가 아닌 월요일(1)부터의 순서로 정렬한다.
        return new WeeklySchedule(weekly.findAllByGroupMemberId(principal.groupMemberId()).stream()
                .map(value -> new WeeklySlot(value.getDayOfWeek(), value.getStartMinute(), value.getEndMinute()))
                .sorted(Comparator.comparingInt((WeeklySlot value) -> value.dayOfWeek().getValue())
                        .thenComparingInt(WeeklySlot::startMinute)).toList());
    }

    /** 한 날짜의 예외 구간을 생성하거나 전체 교체한다. */
    @Transactional
    public OverrideSchedule replaceOverride(MemberPrincipal principal, LocalDate date,
                                             AvailabilityRequests.OverrideUpdate request) {
        // 기존 슬롯을 삭제하기 전에 요청 전체를 검증한다.
        List<Slot> normalized = AvailabilityCalculator.normalizeInput(request.slots().stream()
                .map(value -> new Slot(value.startMinute(), value.endMinute())).toList());
        // 예외 존재 여부를 조회하기 전에 잠가 중복 생성을 막는다.
        GroupMember member = lockMember(principal);
        var existing = overrides.findByGroupMemberIdAndTargetDate(principal.groupMemberId(), date);
        AvailabilityOverride parent;
        if (existing.isPresent()) {
            Long id = existing.get().getId();
            // 예외 부모의 ID·생성 시각은 유지하고 슬롯만 교체한다.
            slots.deleteForOverride(id);
            // 삭제된 슬롯이 부모 컬렉션에 남지 않도록 부모도 다시 조회한다.
            parent = overrides.findById(id).orElseThrow();
        } else {
            parent = overrides.saveAndFlush(new AvailabilityOverride(member, date));
        }
        AvailabilityOverride target = parent;
        // 빈 목록이어도 부모는 남겨 하루 전체 불가능을 표현한다.
        slots.saveAllAndFlush(normalized.stream()
                .map(slot -> new AvailabilityOverrideSlot(target, slot.startMinute(), slot.endMinute())).toList());
        return new OverrideSchedule(date, normalized);
    }

    /** 본인의 날짜별 예외와 연결된 슬롯을 삭제한다. */
    @Transactional
    public void deleteOverride(MemberPrincipal principal, LocalDate date) {
        lockMember(principal);
        // 예외가 없으면 그대로 종료하고, 있으면 연쇄 삭제 정책으로 슬롯도 지운다.
        overrides.findByGroupMemberIdAndTargetDate(principal.groupMemberId(), date).ifPresent(value -> {
            overrides.delete(value);
            overrides.flush();
        });
    }

    /** 기간 내 본인의 예외 일정을 조회한다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<OverrideSchedule> getOverrides(MemberPrincipal principal, LocalDate from, LocalDate to) {
        AvailabilityCalculator.dates(from, to);
        // 빈 슬롯 예외도 포함할 수 있도록 부모와 슬롯을 따로 일괄 조회한다.
        var parents = overrides.findAllByGroupMemberIdAndTargetDateBetweenOrderByTargetDateAsc(
                principal.groupMemberId(), from, to);
        Map<Long, List<Slot>> byOverride = new HashMap<>();
        slots.findAllForMember(principal.groupMemberId(), from, to).forEach(slot ->
                byOverride.computeIfAbsent(slot.getAvailabilityOverride().getId(), ignored -> new ArrayList<>())
                        .add(new Slot(slot.getStartMinute(), slot.getEndMinute())));
        // 슬롯이 없는 예외는 빈 배열로 응답한다.
        return parents.stream().map(parent -> new OverrideSchedule(parent.getTargetDate(),
                AvailabilityCalculator.merge(byOverride.getOrDefault(parent.getId(), List.of())))).toList();
    }

    /** 그룹 멤버별 날짜의 최종 가능 시간을 조회한다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public GroupAvailability getGroup(Long groupId, MemberPrincipal principal, LocalDate from, LocalDate to) {
        return snapshot(groupId, principal, from, to);
    }

    /** 그룹의 날짜별 참여 인원과 공통 가능 시간을 계산한다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public GroupCommonAvailability getCommon(Long groupId, MemberPrincipal principal, LocalDate from, LocalDate to) {
        GroupAvailability snapshot = snapshot(groupId, principal, from, to);
        return new GroupCommonAvailability(groupId, snapshot.days().stream().map(day -> {
            // 해당 날짜의 최종 구간을 멤버 ID별로 묶어 집계한다.
            Map<Long, List<Slot>> byMember = new TreeMap<>();
            day.members().forEach(member -> byMember.put(member.memberId(), member.slots()));
            return AvailabilityCalculator.common(day.date(), byMember);
        }).toList());
    }

    /** 반복 일정과 예외를 합쳐 그룹 전체의 최종 시간표를 만든다. */
    private GroupAvailability snapshot(Long groupId, MemberPrincipal principal, LocalDate from, LocalDate to) {
        List<LocalDate> dates = AvailabilityCalculator.dates(from, to);
        // 기존 그룹 조회의 존재·소속 검증을 재사용한다.
        groups.get(groupId, principal);
        // 그룹 데이터를 일괄 조회해 이후 날짜·멤버 반복문에서 SQL을 실행하지 않는다.
        var groupMembers = members.findAllByGroupIdOrderByIdAsc(groupId);
        // 멤버·요일로 반복 구간을 빠르게 찾을 수 있도록 묶는다.
        Map<Long, Map<DayOfWeek, List<Slot>>> byMember = new HashMap<>();
        weekly.findAllForGroup(groupId).forEach(value ->
                byMember.computeIfAbsent(value.getGroupMember().getId(), ignored -> new EnumMap<>(DayOfWeek.class))
                        .computeIfAbsent(value.getDayOfWeek(), ignored -> new ArrayList<>())
                        .add(new Slot(value.getStartMinute(), value.getEndMinute())));

        // 예외 부모 ID를 멤버·날짜 키와 연결해 슬롯을 합친다.
        Map<Long, MemberDate> overrideKeys = new HashMap<>();
        Map<MemberDate, List<Slot>> byDate = new HashMap<>();
        overrides.findAllForGroup(groupId, from, to).forEach(parent -> {
            MemberDate key = new MemberDate(parent.getGroupMember().getId(), parent.getTargetDate());
            overrideKeys.put(parent.getId(), key);
            // 슬롯이 없어도 예외가 있다는 표시를 남긴다.
            byDate.put(key, new ArrayList<>());
        });
        slots.findAllForGroup(groupId, from, to).forEach(slot ->
                byDate.get(overrideKeys.get(slot.getAvailabilityOverride().getId()))
                        .add(new Slot(slot.getStartMinute(), slot.getEndMinute())));

        List<DayAvailability> days = new ArrayList<>();
        for (LocalDate date : dates) {
            List<MemberAvailability> values = new ArrayList<>();
            for (GroupMember member : groupMembers) {
                MemberDate key = new MemberDate(member.getId(), date);
                List<Slot> baseline = byMember.getOrDefault(member.getId(), Map.of())
                        .getOrDefault(date.getDayOfWeek(), List.of());
                // 빈 예외를 반복 일정으로 되돌리지 않도록 목록 크기가 아닌 키 존재를 검사한다.
                boolean hasOverride = byDate.containsKey(key);
                values.add(new MemberAvailability(member.getId(), member.getNickname(),
                        hasOverride ? Source.OVERRIDE : Source.WEEKLY,
                        AvailabilityCalculator.resolve(baseline, hasOverride ? byDate.get(key) : null)));
            }
            days.add(new DayAvailability(date, List.copyOf(values)));
        }
        return new GroupAvailability(groupId, List.copyOf(days));
    }

    /** 현재 멤버의 쓰기 잠금을 얻고 그룹 소속을 확인한다. */
    private GroupMember lockMember(MemberPrincipal principal) {
        GroupMember member = members.findForAvailabilityUpdate(principal.groupMemberId()).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "MEMBER_NOT_FOUND", "멤버를 찾을 수 없습니다."));
        if (!member.getGroup().getId().equals(principal.groupId())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "접근 권한이 없습니다.");
        }
        return member;
    }

    /** 멤버·날짜별 예외 조회에 사용하는 키다. */
    private record MemberDate(Long memberId, LocalDate date) { }
}
