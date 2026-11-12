package github.partysync.availability;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.List;

/** 일정 조회·저장 응답 DTO다. */
public final class AvailabilityResponses {
    private AvailabilityResponses() { }

    /** 최종 구간의 적용 근거: 반복 일정 또는 날짜별 예외. */
    public enum Source { WEEKLY, OVERRIDE }

    /** 시작 포함·종료 제외의 분 단위 구간이다. */
    public record Slot(int startMinute, int endMinute) { }

    public record WeeklySlot(DayOfWeek dayOfWeek, int startMinute, int endMinute) { }

    /** 내 반복 설정의 조회·저장 응답이다. */
    public record WeeklySchedule(List<WeeklySlot> slots) { }

    /** 날짜별 예외 응답이다. 빈 slots도 하루 전체 불가능을 나타내는 예외다. */
    public record OverrideSchedule(LocalDate date, List<Slot> slots) { }

    /** 멤버의 최종 구간과 적용 근거를 담는다. */
    public record MemberAvailability(Long memberId, String nickname, Source source, List<Slot> slots) { }

    public record DayAvailability(LocalDate date, List<MemberAvailability> members) { }

    public record GroupAvailability(Long groupId, List<DayAvailability> days) { }

    /** 구간별 참여 인원·멤버 ID·전원 가능 여부를 담는다. */
    public record CountedSlot(int startMinute, int endMinute, int availableCount, List<Long> availableMemberIds, boolean allAvailable) { }

    public record CommonDay(LocalDate date, int totalMembers, List<CountedSlot> timeSlots) { }

    public record GroupCommonAvailability(Long groupId, List<CommonDay> days) { }
}
