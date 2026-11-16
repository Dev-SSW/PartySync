package github.partysync.account;

import java.time.Instant;
import java.util.Optional;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;

public interface UserSessionRepository extends JpaRepository<UserSession, Long> {
    /** 유효한 계정 세션의 공개 인증 정보만 조회한다. */
    @Query("select new github.partysync.account.AccountPrincipal(s.user.id, s.id, s.user.loginId) from UserSession s where s.tokenHash=:hash and s.revokedAt is null and s.expiresAt>:now")
    Optional<AccountPrincipal> authenticate(String hash, Instant now);

    /** 발급·연결·로그아웃을 계정 세션 행 기준으로 직렬화한다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from UserSession s join fetch s.user where s.id=:id")
    Optional<UserSession> findLocked(Long id);
}
