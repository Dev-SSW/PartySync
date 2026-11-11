package github.partysync.groupmember;

import java.util.List;
import java.util.Optional;

import github.partysync.groupmember.auth.MemberPrincipal;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 멤버 조회·인원 수·닉네임 확인·인증 조회를 담당
 * 인증에는 필요한 필드만 DTO projection으로 읽음
 */
public interface GroupMemberRepository extends JpaRepository<GroupMember, Long> {
    List<GroupMember> findAllByGroupId(Long groupId);

    /**
     * 그룹 인원 수를 별도 컬럼 대신 실제 멤버 행 수로 계산
     */
    long countByGroupId(Long groupId);

    /**
     * 사전 중복 확인용
     * 동시 가입의 최종 방어는 DB UNIQUE 제약이 담당
     */
    boolean existsByGroupIdAndNickname(Long groupId, String nickname);

    List<GroupMember> findAllByGroupIdOrderByIdAsc(Long groupId);

    /**
     * 토큰 해시 인덱스로 인증 필드만 한 번 조회
     * 그룹 ID는 외래키 값으로 읽어 그룹 엔티티 로딩을 피함
     */
    @Query("""
            select new github.partysync.groupmember.auth.MemberPrincipal(m.id, m.group.id, m.nickname, m.role)
            from GroupMember m where m.accessTokenHash = :tokenHash
            """)
    Optional<MemberPrincipal> findPrincipalByTokenHash(@Param("tokenHash") String tokenHash);
}
