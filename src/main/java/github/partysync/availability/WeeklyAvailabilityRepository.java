package github.partysync.availability;

import java.util.List;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import org.springframework.data.jpa.repository.JpaRepository;

public interface WeeklyAvailabilityRepository extends JpaRepository<WeeklyAvailability, Long> {
    /** 본인 반복 설정 전체를 조회 */
    List<WeeklyAvailability> findAllByGroupMemberId(Long groupMemberId);

    /** 그룹의 모든 멤버 반복 설정을 한 번에 읽어 날짜·멤버마다 조회하는 N+1을 방지 */
    @Query("select w from WeeklyAvailability w where w.groupMember.group.id = :groupId")
    List<WeeklyAvailability> findAllForGroup(@Param("groupId") Long groupId);

    /** 멤버의 반복 설정 전체를 벌크 삭제 */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from WeeklyAvailability w where w.groupMember.id = :memberId")
    void deleteForMember(@Param("memberId") Long memberId);

    /** 멤버와 요일에 해당하는 반복 시간 구간을 시작 분 오름차순으로 조회 */
    List<WeeklyAvailability> findAllByGroupMemberIdAndDayOfWeekOrderByStartMinuteAsc(Long groupMemberId, java.time.DayOfWeek dayOfWeek);
}
