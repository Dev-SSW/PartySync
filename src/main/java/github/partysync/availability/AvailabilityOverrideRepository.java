package github.partysync.availability;

import java.util.Optional;
import java.util.List;
import java.time.LocalDate;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AvailabilityOverrideRepository extends JpaRepository<AvailabilityOverride, Long> {
    /** 양 끝 날짜를 포함해 본인의 예외 부모를 날짜순으로 조회한다. */
    List<AvailabilityOverride> findAllByGroupMemberIdAndTargetDateBetweenOrderByTargetDateAsc(
            Long memberId, LocalDate from, LocalDate to);

    /** 기간 내 그룹 전체의 예외 부모를 일괄 조회한다. */
    @Query("select o from AvailabilityOverride o where o.groupMember.group.id = :groupId and o.targetDate between :from and :to")
    List<AvailabilityOverride> findAllForGroup(
            @Param("groupId") Long groupId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    /** 멤버와 날짜로 예외를 조회 */
    Optional<AvailabilityOverride> findByGroupMemberIdAndTargetDate(Long groupMemberId, java.time.LocalDate targetDate);
}
