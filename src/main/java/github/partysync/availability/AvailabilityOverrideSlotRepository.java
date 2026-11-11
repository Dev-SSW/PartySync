package github.partysync.availability;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AvailabilityOverrideSlotRepository extends JpaRepository<AvailabilityOverrideSlot, Long> {
    /**
     * 한 예외 일정의 시간 구간을 시작 분 오름차순으로 조회
     */
    List<AvailabilityOverrideSlot> findAllByAvailabilityOverrideIdOrderByStartMinuteAsc(Long availabilityOverrideId);
}
