package github.partysync.availability;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import github.partysync.common.ApiException;
import org.springframework.http.HttpStatus;

import static github.partysync.availability.AvailabilityResponses.*;

/** DB 없이 구간을 계산한다. 시간은 시작 포함·종료 제외다. */
public final class AvailabilityCalculator {
    private AvailabilityCalculator() { }

    /** 저장할 구간을 검증하고 정렬·병합한다. */
    public static List<Slot> normalizeInput(List<Slot> slots) {
        // 입력 전체의 하루 범위와 30분 배수를 먼저 검사한다.
        for (Slot slot : slots) {
            if (slot.startMinute() < 0 || slot.startMinute() >= slot.endMinute() || slot.endMinute() > 1440
                    || slot.startMinute() % 30 != 0 || slot.endMinute() % 30 != 0) {
                throw badRequest("INVALID_TIME_SLOT", "시간은 0~1440 범위의 30분 단위이며 시작이 종료보다 빨라야 합니다.");
            }
        }
        return normalize(slots, true);
    }

    /** 조회한 구간의 합집합을 구한다. */
    public static List<Slot> merge(List<Slot> slots) {
        return normalize(slots, false);
    }

    /** 시간 구간을 정렬하고 겹치거나 맞닿은 구간을 처리한다. */
    private static List<Slot> normalize(List<Slot> slots, boolean rejectOverlap) {
        List<Slot> sorted = slots.stream().sorted(Comparator.comparingInt(Slot::startMinute)
                .thenComparingInt(Slot::endMinute)).toList();
        List<Slot> result = new ArrayList<>();
        for (Slot slot : sorted) {
            if (result.isEmpty()) {
                result.add(slot);
                continue;
            }
            Slot previous = result.getLast();
            // 저장 입력의 겹침은 거절하지만 조회 데이터는 합집합으로 처리한다.
            if (rejectOverlap && slot.startMinute() < previous.endMinute()) {
                throw badRequest("OVERLAPPING_TIME_SLOTS", "같은 요일 또는 날짜의 시간 구간은 겹칠 수 없습니다.");
            }
            // 맞닿거나 겹친 구간은 종료점을 더 늦은 쪽으로 확장한다.
            if (slot.startMinute() <= previous.endMinute()) {
                result.set(result.size() - 1, new Slot(previous.startMinute(),
                        Math.max(previous.endMinute(), slot.endMinute())));
            } else {
                result.add(slot);
            }
        }
        return List.copyOf(result);
    }

    /** 예외를 우선 적용해 최종 가능 구간을 선택한다. */
    public static List<Slot> resolve(List<Slot> weekly, List<Slot> overrideOrNull) {
        // null은 예외 없음, 빈 목록은 하루 전체 불가능이므로 구분한다.
        return merge(overrideOrNull == null ? weekly : overrideOrNull);
    }

    /** 조회 기간을 검증하고 양 끝을 포함한 날짜 목록을 만든다. */
    public static List<LocalDate> dates(LocalDate from, LocalDate to) {
        if (from == null || to == null || from.isAfter(to) || ChronoUnit.DAYS.between(from, to) > 30) {
            throw badRequest("INVALID_DATE_RANGE", "from은 to 이하이고 양 끝을 포함한 조회 기간은 최대 31일입니다.");
        }
        // 양 끝을 포함한 개수만큼 순회해 마지막 날짜의 다음 날을 만들지 않는다.
        int count = (int) ChronoUnit.DAYS.between(from, to) + 1;
        List<LocalDate> dates = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            dates.add(from.plusDays(i));
        }
        return List.copyOf(dates);
    }

    /** 시간대별 참여 멤버와 전원 가능 여부를 계산한다. */
    public static CommonDay common(LocalDate date, Map<Long, List<Slot>> availability) {
        // 하루를 30분씩 48칸으로 나눠 참여 멤버를 담는다.
        List<List<Long>> participants = new ArrayList<>(48);
        for (int i = 0; i < 48; i++) {
            participants.add(new ArrayList<>());
        }
        for (var member : new TreeMap<>(availability).entrySet()) {
            // 한 멤버가 같은 칸에 중복 집계되지 않게 표시한다.
            boolean[] present = new boolean[48];
            for (Slot slot : merge(member.getValue())) {
                // 30분 전체를 덮는 칸만 선택한다. 시작은 올림, 종료는 내림한다.
                int first = (slot.startMinute() + 29) / 30;
                int end = slot.endMinute() / 30;
                for (int i = first; i < end; i++) {
                    present[i] = true;
                }
            }
            for (int i = 0; i < 48; i++) {
                if (present[i]) {
                    participants.get(i).add(member.getKey());
                }
            }
        }
        // 일정이 없는 멤버도 전체 인원에 포함하며 빈 그룹은 전원 가능으로 보지 않는다.
        int total = availability.size();
        List<CountedSlot> result = new ArrayList<>();
        for (int i = 0; i < 48; i++) {
            List<Long> ids = List.copyOf(participants.get(i));
            // 인원수가 아니라 참여 멤버 구성이 같은 인접 칸만 합친다.
            if (!result.isEmpty() && result.getLast().availableMemberIds().equals(ids)) {
                CountedSlot previous = result.getLast();
                result.set(result.size() - 1, new CountedSlot(previous.startMinute(), (i + 1) * 30,
                        ids.size(), ids, total > 0 && ids.size() == total));
            } else {
                result.add(new CountedSlot(i * 30, (i + 1) * 30, ids.size(), ids,
                        total > 0 && ids.size() == total));
            }
        }
        return new CommonDay(date, total, List.copyOf(result));
    }

    /** 시간 정책 위반을 400 오류로 변환한다. */
    private static ApiException badRequest(String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, message);
    }
}
