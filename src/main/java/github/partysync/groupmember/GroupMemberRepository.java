package github.partysync.groupmember;

import java.util.List;
import java.util.Optional;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;

import github.partysync.groupmember.auth.MemberPrincipal;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import org.springframework.data.jpa.repository.JpaRepository;

/** 멤버 조회·인원 수·닉네임 확인·인증 조회를 담당 */
public interface GroupMemberRepository extends JpaRepository<GroupMember, Long> {
    /** 같은 멤버의 반복 일정·예외 저장·삭제를 직렬화하는 공통 잠금 행을 조회 */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from GroupMember m where m.id = :memberId")
    Optional<GroupMember> findForAvailabilityUpdate(@Param("memberId") Long memberId);

    List<GroupMember> findAllByGroupId(Long groupId);

    /** 그룹 인원 수를 별도 컬럼 대신 실제 멤버 행 수로 계산 */
    long countByGroupId(Long groupId);

    /** 사전 중복 확인용 */
    boolean existsByGroupIdAndNickname(Long groupId, String nickname);

    List<GroupMember> findAllByGroupIdOrderByIdAsc(Long groupId);

    /** 토큰 해시 인덱스로 인증 필드만 한 번 조회 */
    @Query("""
            select new github.partysync.groupmember.auth.MemberPrincipal(m.id, m.group.id, m.nickname, m.role)
            from GroupMember m where m.accessTokenHash = :tokenHash
            """)
    Optional<MemberPrincipal> findPrincipalByTokenHash(@Param("tokenHash") String tokenHash);
}
