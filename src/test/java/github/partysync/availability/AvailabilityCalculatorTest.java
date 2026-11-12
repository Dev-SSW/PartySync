package github.partysync.availability;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import github.partysync.common.ApiException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;

import static github.partysync.availability.AvailabilityResponses.*;
import static org.assertj.core.api.Assertions.*;

class AvailabilityCalculatorTest {
    private static final LocalDate DATE = LocalDate.of(2026, 11, 16);

    @Test
    void sortsAndMergesOnlyAdjacentInput() {
        assertThat(AvailabilityCalculator.normalizeInput(List.of(slot(120, 180), slot(0, 60),
                slot(60, 120), slot(240, 300)))).containsExactly(slot(0, 180), slot(240, 300));
        assertThat(AvailabilityCalculator.normalizeInput(List.of())).isEmpty();
        assertThat(AvailabilityCalculator.normalizeInput(List.of(slot(0, 1440)))).containsExactly(slot(0, 1440));
    }

    @ParameterizedTest
    @CsvSource({"0,0", "60,30", "-30,30", "0,1470", "15,60", "0,45", "1440,1470"})
    void rejectsInvalidBoundsAndNonThirtyMinuteInput(int start, int end) {
        assertThatThrownBy(() -> AvailabilityCalculator.normalizeInput(List.of(slot(start, end))))
                .isInstanceOf(ApiException.class);
    }

    static Stream<Arguments> overlapping() {
        return Stream.of(Arguments.of(List.of(slot(0, 120), slot(60, 180))),
                Arguments.of(List.of(slot(0, 60), slot(0, 60))),
                Arguments.of(List.of(slot(0, 180), slot(30, 60))));
    }

    @ParameterizedTest
    @MethodSource("overlapping")
    void rejectsPartialDuplicateAndContainedIntervals(List<Slot> slots) {
        assertThatThrownBy(() -> AvailabilityCalculator.normalizeInput(slots))
                .isInstanceOf(ApiException.class)
                .satisfies(error -> assertThat(((ApiException) error).getCode()).isEqualTo("OVERLAPPING_TIME_SLOTS"));
    }

    @Test
    void missingOverrideUsesWeeklyButEmptyOverrideMeansUnavailable() {
        List<Slot> weekly = List.of(slot(1140, 1380));
        assertThat(AvailabilityCalculator.resolve(weekly, null)).isEqualTo(weekly);
        assertThat(AvailabilityCalculator.resolve(weekly, List.of())).isEmpty();
        assertThat(AvailabilityCalculator.resolve(weekly, List.of(slot(1260, 1380))))
                .containsExactly(slot(1260, 1380));
    }

    @Test
    void singleMemberIncludesMidnightAndEndOfDay() {
        CommonDay day = AvailabilityCalculator.common(DATE, Map.of(9L, List.of(slot(0, 60), slot(1380, 1440))));
        assertThat(day.timeSlots()).containsExactly(
                counted(0, 60, List.of(9L), true),
                counted(60, 1380, List.of(), false),
                counted(1380, 1440, List.of(9L), true));
    }

    @Test
    void computesAllMemberIntersectionAcrossSeveralIntervals() {
        CommonDay day = AvailabilityCalculator.common(DATE, Map.of(
                2L, List.of(slot(1200, 1380)), 1L, List.of(slot(1140, 1260), slot(1320, 1440))));
        assertThat(day.totalMembers()).isEqualTo(2);
        assertThat(day.timeSlots().stream().filter(CountedSlot::allAvailable)).containsExactly(
                counted(1200, 1260, List.of(1L, 2L), true),
                counted(1320, 1380, List.of(1L, 2L), true));
        assertThat(day.timeSlots()).contains(counted(1260, 1320, List.of(2L), false));
        assertThat(day.timeSlots().getFirst().startMinute()).isZero();
        assertThat(day.timeSlots().getLast().endMinute()).isEqualTo(1440);
    }

    @Test
    void sameCountsWithDifferentMembersDoNotMergeAndTouchingIntervalsDoNotIntersect() {
        CommonDay day = AvailabilityCalculator.common(DATE,
                Map.of(1L, List.of(slot(0, 60)), 2L, List.of(slot(60, 120))));
        assertThat(day.timeSlots()).containsExactly(counted(0, 60, List.of(1L), false),
                counted(60, 120, List.of(2L), false), counted(120, 1440, List.of(), false));
        assertThat(day.timeSlots()).noneMatch(CountedSlot::allAvailable);
    }

    @Test
    void emptyGroupAndMemberWithoutSlotsAreNeverAllAvailable() {
        CommonDay empty = AvailabilityCalculator.common(DATE, Map.of());
        assertThat(empty.totalMembers()).isZero();
        assertThat(empty.timeSlots()).containsExactly(counted(0, 1440, List.of(), false));
        CommonDay memberOff = AvailabilityCalculator.common(DATE, Map.of(1L, List.of()));
        assertThat(memberOff.totalMembers()).isEqualTo(1);
        assertThat(memberOff.timeSlots()).containsExactly(counted(0, 1440, List.of(), false));
    }

    @Test
    void overlappingStoredRowsNeverCountOneMemberTwice() {
        CommonDay day = AvailabilityCalculator.common(DATE,
                Map.of(1L, List.of(slot(0, 90), slot(30, 120), slot(0, 90))));
        assertThat(day.timeSlots()).containsExactly(counted(0, 120, List.of(1L), true),
                counted(120, 1440, List.of(), false));
    }

    @Test
    void legacyMinuteDataMustCoverWholeThirtyMinuteSlot() {
        CommonDay day = AvailabilityCalculator.common(DATE, Map.of(1L, List.of(slot(1, 61))));
        assertThat(day.timeSlots()).containsExactly(counted(0, 30, List.of(), false),
                counted(30, 60, List.of(1L), true), counted(60, 1440, List.of(), false));
    }

    @Test
    void dateRangeIsInclusiveAndLimitedToThirtyOneDays() {
        assertThat(AvailabilityCalculator.dates(DATE, DATE.plusDays(30))).hasSize(31)
                .startsWith(DATE).endsWith(DATE.plusDays(30));
        assertThatThrownBy(() -> AvailabilityCalculator.dates(DATE, DATE.plusDays(31)))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> AvailabilityCalculator.dates(DATE, DATE.minusDays(1)))
                .isInstanceOf(ApiException.class);
        assertThat(AvailabilityCalculator.dates(LocalDate.MAX, LocalDate.MAX)).containsExactly(LocalDate.MAX);
    }

    private static Slot slot(int start, int end) { return new Slot(start, end); }
    private static CountedSlot counted(int start, int end, List<Long> ids, boolean all) {
        return new CountedSlot(start, end, ids.size(), ids, all);
    }
}
