package github.partysync.availability;

import java.time.LocalDate;
import java.util.List;

import github.partysync.groupmember.auth.MemberPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PathVariable;

import static github.partysync.availability.AvailabilityResponses.*;

/** 본인 일정 관리와 그룹 일정 조회 API다. */
@RestController
@RequestMapping("/api")
public class AvailabilityController {
    private final AvailabilityService availability;

    public AvailabilityController(AvailabilityService availability) {
        this.availability = availability;
    }

    /** 내 주간 반복 일정을 전체 교체한다. */
    @PutMapping("/members/me/weekly-availability")
    public WeeklySchedule replaceWeekly(@AuthenticationPrincipal MemberPrincipal principal,
                                        @Valid @RequestBody AvailabilityRequests.WeeklyUpdate request) {
        return availability.replaceWeekly(principal, request);
    }

    /** 내 주간 반복 일정을 조회한다. */
    @GetMapping("/members/me/weekly-availability")
    public WeeklySchedule weekly(@AuthenticationPrincipal MemberPrincipal principal) {
        return availability.getWeekly(principal);
    }

    /** 특정 날짜의 예외 일정을 생성하거나 전체 교체한다. */
    @PutMapping("/members/me/availability-overrides/{date}")
    public OverrideSchedule replaceOverride(@AuthenticationPrincipal MemberPrincipal principal,
            @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @Valid @RequestBody AvailabilityRequests.OverrideUpdate request) {
        return availability.replaceOverride(principal, date, request);
    }

    /** 특정 날짜의 예외 일정을 삭제한다. */
    @DeleteMapping("/members/me/availability-overrides/{date}")
    public ResponseEntity<Void> deleteOverride(@AuthenticationPrincipal MemberPrincipal principal,
            @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        availability.deleteOverride(principal, date);
        return ResponseEntity.noContent().build();
    }

    /** 기간 내 내 예외 일정을 조회한다. */
    @GetMapping("/members/me/availability-overrides")
    public List<OverrideSchedule> overrides(@AuthenticationPrincipal MemberPrincipal principal,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return availability.getOverrides(principal, from, to);
    }

    /** 그룹 멤버별 날짜의 최종 가능 시간을 조회한다. */
    @GetMapping("/groups/{groupId}/availability")
    public GroupAvailability group(@PathVariable @Positive Long groupId,
            @AuthenticationPrincipal MemberPrincipal principal,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return availability.getGroup(groupId, principal, from, to);
    }

    /** 그룹의 시간대별 참여 인원과 전원 가능 여부를 조회한다. */
    @GetMapping("/groups/{groupId}/common-availability")
    public GroupCommonAvailability common(@PathVariable @Positive Long groupId,
            @AuthenticationPrincipal MemberPrincipal principal,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return availability.getCommon(groupId, principal, from, to);
    }
}
