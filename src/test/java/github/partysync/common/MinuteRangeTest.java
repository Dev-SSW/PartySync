package github.partysync.common;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 자정·24:00·빈 구간·역순·범위 초과를 확인하는 DB 독립적인 시간 범위 단위 테스트다.
 */
class MinuteRangeTest {
    @ParameterizedTest
    @CsvSource({"0,1440", "0,1", "1439,1440", "1140,1380"})
    void acceptsHalfOpenIntervalsIncludingEndOfDay(int start, int end) {
        assertThatCode(() -> MinuteRange.validate(start, end)).doesNotThrowAnyException();
    }

    @ParameterizedTest
    @CsvSource({"-1,60", "0,0", "60,60", "120,60", "0,1441", "1440,1441"})
    void rejectsEmptyReversedOrOutOfDayIntervals(int start, int end) {
        assertThatThrownBy(() -> MinuteRange.validate(start, end)).isInstanceOf(IllegalArgumentException.class);
    }
}
