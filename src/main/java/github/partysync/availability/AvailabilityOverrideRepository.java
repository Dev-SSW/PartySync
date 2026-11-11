package github.partysync.availability;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AvailabilityOverrideRepository extends JpaRepository<AvailabilityOverride, Long> {
    /**
     * 멤버와 날짜로 예외를 조회
     * 결과가 없으면 해당 요일의 반복 일정을 사용
     */
    Optional<AvailabilityOverride> findByGroupMemberIdAndTargetDate(Long groupMemberId, java.time.LocalDate targetDate);
}
