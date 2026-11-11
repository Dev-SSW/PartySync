package github.partysync.availability;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface WeeklyAvailabilityRepository extends JpaRepository<WeeklyAvailability, Long> {
    /**
     * 멤버와 요일에 해당하는 반복 시간 구간을 시작 분 오름차순으로 조회
     */
    List<WeeklyAvailability> findAllByGroupMemberIdAndDayOfWeekOrderByStartMinuteAsc(Long groupMemberId, java.time.DayOfWeek dayOfWeek);
}
