package github.partysync.account;

import java.time.Instant;
import java.util.Optional;
import github.partysync.groupmember.auth.MemberPrincipal;
import org.springframework.data.jpa.repository.*;

public interface MemberSessionRepository extends JpaRepository<MemberSession, Long> {
    @Modifying
    @Query("delete from MemberSession s where s.groupMember.id=:memberId")
    void deleteForMember(Long memberId);

    /** 부모 계정 세션의 만료·폐기와 연결 계정까지 함께 검증한다. */
    @Query("""
        select new github.partysync.groupmember.auth.MemberPrincipal(m.id, m.group.id, m.nickname, m.role)
        from MemberSession s join s.groupMember m join s.userSession u
        where s.tokenHash=:hash and s.revokedAt is null and s.expiresAt>:now
          and u.revokedAt is null and u.expiresAt>:now and m.user.id=u.user.id and m.active=true
        """)
    Optional<MemberPrincipal> authenticate(String hash, Instant now);

    /** 현재 그룹 세션만 폐기할 때 사용한다. */
    Optional<MemberSession> findByTokenHash(String hash);

    /** 같은 기기의 계정 로그아웃 시 하위 그룹 세션을 모두 폐기한다. */
    @Modifying
    @Query("update MemberSession s set s.revokedAt=:now where s.userSession.id=:parentId and s.revokedAt is null")
    int revokeChildren(Long parentId, Instant now);
}
