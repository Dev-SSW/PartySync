package github.partysync.common;

/**
 * 하루의 분 단위 반개구간 [startMinute, endMinute)을 검증
 * - 1440은 종료 시각 24:00을 의미
 */
public final class MinuteRange {
    private MinuteRange() {
    }

    /**
     * 하나의 구간 범위만 확인
     * 다른 구간과의 겹침이나 교집합 계산은 수행하지 않음
     */
    public static void validate(int startMinute, int endMinute) {
        if (startMinute < 0 || startMinute >= endMinute || endMinute > 1440) {
            throw new IllegalArgumentException("Expected 0 <= startMinute < endMinute <= 1440");
        }
    }
}
