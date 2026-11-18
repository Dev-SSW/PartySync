package github.partysync.account;

import java.time.*;
import java.sql.Timestamp;
import github.partysync.common.ApiException;
import github.partysync.groupmember.auth.MemberTokenService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 로그인 복원 토큰은 HttpOnly 쿠키로 전달하고 DB에는 해시만 저장한다. */
@Service
public class RememberLoginService {
    public record Refreshed(AccountResponses.SignedIn login, String secret, Instant expiresAt, boolean persistent) {
        @Override public String toString() { return "Refreshed[REDACTED]"; }
    }
    private final JdbcTemplate jdbc;
    private final UserSessionRepository sessions;
    private final MemberSessionRepository children;
    private final MemberTokenService tokens;
    private final Clock clock;
    private final SessionPolicy policy;
    private final Duration ttl;
    public RememberLoginService(JdbcTemplate jdbc, UserSessionRepository sessions, MemberSessionRepository children,
            MemberTokenService tokens, Clock clock, SessionPolicy policy,
            @Value("${REMEMBER_LOGIN_TTL:P30D}") Duration ttl) {
        if (ttl.isNegative() || ttl.isZero()) throw new IllegalArgumentException("Invalid remember TTL");
        this.jdbc=jdbc; this.sessions=sessions; this.children=children; this.tokens=tokens;
        this.clock=clock; this.policy=policy; this.ttl=ttl;
    }
    /** 로그인한 기기에 고정 수명의 복원 토큰을 발급한다. */
    @Transactional
    public String issue(AccountResponses.SignedIn login, boolean persistent) {
        var principal = sessions.authenticate(tokens.hash(login.accountAccessToken()), clock.instant()).orElseThrow(AccountService::unauthorized);
        return insert(principal.userSessionId(), clock.instant().plus(ttl), persistent);
    }
    private String insert(Long parent, Instant expiry, boolean persistent) {
        // 발급 시 오래된 만료 토큰을 최대 100개씩 정리한다.
        jdbc.update("delete from account_refresh_token where token_hash in (select token_hash from account_refresh_token where expires_at < ? limit 100)", Timestamp.from(clock.instant().minus(Duration.ofDays(1))));
        String raw=tokens.issue().raw();
        jdbc.update("insert into account_refresh_token(token_hash,user_session_id,expires_at,persistent) values(?,?,?,?)", tokens.hash(raw), parent, Timestamp.from(expiry), persistent);
        return raw;
    }
    /** 토큰을 회전하고 재사용·만료 시 해당 기기의 세션을 폐기한다. */
    @Transactional(noRollbackFor = ApiException.class)
    public Refreshed refresh(String raw) {
        if (!tokens.hasValidFormat(raw)) throw AccountService.unauthorized();
        var rows=jdbc.queryForList("select user_session_id, expires_at, persistent, used_at from account_refresh_token where token_hash=? for update", tokens.hash(raw));
        if (rows.isEmpty()) throw AccountService.unauthorized();
        var row=rows.getFirst();
        UserSession parent=sessions.findLocked(((Number)row.get("user_session_id")).longValue()).orElseThrow(AccountService::unauthorized);
        Instant now=clock.instant(), expiry=((Timestamp)row.get("expires_at")).toInstant();
        if (row.get("used_at") != null || !now.isBefore(expiry) || parent.getRevokedAt()!=null) {
            // 인증 실패를 반환해도 세션 폐기는 커밋한다.
            parent.revoke(now); children.revokeChildren(parent.getId(), now);
            throw AccountService.unauthorized();
        }
        jdbc.update("update account_refresh_token set used_at=? where token_hash=?", Timestamp.from(now), tokens.hash(raw));
        String access="u_"+tokens.issue().raw();
        Instant accessExpiry=now.plus(policy.accountTtl);
        if (accessExpiry.isAfter(expiry)) accessExpiry=expiry;
        parent.rotate(tokens.hash(access), accessExpiry);
        return new Refreshed(new AccountResponses.SignedIn(AccountResponses.Me.from(parent.getUser()),access,accessExpiry),insert(parent.getId(),expiry,(Boolean)row.get("persistent")),expiry,(Boolean)row.get("persistent"));
    }
    /** 복원 토큰에 연결된 계정과 하위 그룹 세션을 폐기한다. */
    @Transactional
    public void revoke(String raw) {
        if (!tokens.hasValidFormat(raw)) return;
        var ids=jdbc.queryForList("select user_session_id from account_refresh_token where token_hash=?", Long.class,tokens.hash(raw));
        if (!ids.isEmpty()) sessions.findLocked(ids.getFirst()).ifPresent(parent -> {
            parent.revoke(clock.instant()); children.revokeChildren(parent.getId(),clock.instant());
        });
    }
}
