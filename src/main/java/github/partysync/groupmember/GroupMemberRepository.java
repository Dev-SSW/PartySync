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
    /** 실제 비회원 토큰 소유권을 검증하며 동시에 연결되는 것을 방지한다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from GroupMember m where m.accessTokenHash=:hash and m.user is null")
    Optional<GroupMember> findGuestForClaim(@Param("hash") String hash);

    Optional<GroupMember> findByUserIdAndGroupId(Long userId, Long groupId);

    /** 계정에 연결된 그룹을 한 번에 조회한다. */
    @Query("select new github.partysync.account.AccountResponses$Group(m.group.id, m.group.name, m.id, m.nickname, m.role, m.joinedAt) from GroupMember m where m.user.id=:userId order by m.id")
    List<github.partysync.account.AccountResponses.Group> findAccountGroups(@Param("userId") Long userId);
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
            from GroupMember m where m.accessTokenHash = :tokenHash and m.user is null
            """)
    Optional<MemberPrincipal> findPrincipalByTokenHash(@Param("tokenHash") String tokenHash);
}
