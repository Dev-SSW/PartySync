package github.partysync.availability;

import java.util.List;
import java.time.LocalDate;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.repository.query.Param;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AvailabilityOverrideSlotRepository extends JpaRepository<AvailabilityOverrideSlot, Long> {
    /** 예외 부모는 유지하고 연결된 슬롯만 벌크 삭제한다. 예외 수정의 전체 교체에 사용한다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from AvailabilityOverrideSlot s where s.availabilityOverride.id = :overrideId")
    void deleteForOverride(@Param("overrideId") Long overrideId);

    /** 조회 기간에 속한 한 멤버의 모든 예외 슬롯을 한 번에 읽는다. */
    @Query("select s from AvailabilityOverrideSlot s " +
            "where s.availabilityOverride.groupMember.id = :memberId and s.availabilityOverride.targetDate between :from and :to")
    List<AvailabilityOverrideSlot> findAllForMember(@Param("memberId") Long memberId,
            @Param("from") LocalDate from, @Param("to") LocalDate to);

    /** 그룹의 기간 내 예외 슬롯을 한 번에 읽어 날짜별·예외별 반복 SQL을 방지한다. */
    @Query("select s from AvailabilityOverrideSlot s " +
            "where s.availabilityOverride.groupMember.group.id = :groupId and s.availabilityOverride.targetDate between :from and :to")
    List<AvailabilityOverrideSlot> findAllForGroup(@Param("groupId") Long groupId,
            @Param("from") LocalDate from, @Param("to") LocalDate to);

    /** 한 예외 일정의 시간 구간을 시작 분 오름차순으로 조회 */
    List<AvailabilityOverrideSlot> findAllByAvailabilityOverrideIdOrderByStartMinuteAsc(Long availabilityOverrideId);
}
