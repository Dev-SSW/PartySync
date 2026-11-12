package github.partysync.availability;

import java.time.DayOfWeek;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** 일정 전체 교체 요청 DTO다. */
public final class AvailabilityRequests {
    private AvailabilityRequests() { }

    /** 내 반복 일정 전체 교체 요청이다. 빈 배열은 전체 삭제다. */
    public record WeeklyUpdate(@NotNull @Size(max = 336) List<@NotNull @Valid WeeklySlot> slots) { }

    /** 날짜별 예외 전체 교체 요청이다. 빈 배열은 하루 전체 불가능이다. */
    public record OverrideUpdate(@NotNull @Size(max = 48) List<@NotNull @Valid Slot> slots) { }

    public record WeeklySlot(@NotNull DayOfWeek dayOfWeek,
                             @NotNull @Min(0) @Max(1439) Integer startMinute,
                             @NotNull @Min(1) @Max(1440) Integer endMinute) { }
    public record Slot(@NotNull @Min(0) @Max(1439) Integer startMinute,
                       @NotNull @Min(1) @Max(1440) Integer endMinute) { }
}
