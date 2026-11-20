package github.partysync.notification;

import github.partysync.common.ApiException;
import github.partysync.groupmember.GroupMemberRepository;
import github.partysync.groupmember.auth.MemberPrincipal;
import github.partysync.groupmember.auth.MemberTokenService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PushSubscriptions {
    private final JdbcTemplate jdbc;
    private final GroupMemberRepository members;
    private final MemberTokenService tokens;
    private final PushGateway gateway;

    public PushSubscriptions(JdbcTemplate jdbc, GroupMemberRepository members, MemberTokenService tokens, PushGateway gateway) {
        this.jdbc = jdbc; this.members = members; this.tokens = tokens; this.gateway = gateway;
    }

    public record Configuration(boolean enabled, String publicKey) { }
    public Configuration configuration() { return new Configuration(gateway.enabled(), gateway.publicKey()); }

    public boolean subscribed(MemberPrincipal principal, String endpoint) {
        PushEndpoint.validate(endpoint);
        return Boolean.TRUE.equals(jdbc.queryForObject("""
            select exists(select 1 from push_subscription s left join user_session u on u.id=s.user_session_id
              where s.group_member_id=? and s.endpoint_hash=? and (s.user_session_id is null or u.revoked_at is null))
            """, Boolean.class, principal.groupMemberId(), tokens.hash(endpoint)));
    }

    @Transactional
    public void subscribe(MemberPrincipal principal, String rawToken, String endpoint, String p256dh, String auth) {
        if (!gateway.enabled()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "PUSH_UNAVAILABLE", "아직 알림 서비스를 준비 중입니다.");
        PushEndpoint.validate(endpoint); PushEndpoint.validateKeys(p256dh, auth);
        var member = members.findForAvailabilityUpdate(principal.groupMemberId()).orElseThrow();
        if (!member.isActive() || !member.getGroup().getId().equals(principal.groupId())) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "접근 권한이 없습니다.");
        Long parent = null;
        if (member.getUser() != null) {
            var parents = jdbc.queryForList("select user_session_id from member_session where group_member_id=? and token_hash=? and revoked_at is null", Long.class, member.getId(), tokens.hash(rawToken));
            if (parents.isEmpty()) throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증 정보를 확인하세요.");
            parent = parents.getFirst();
        }
        String hash = tokens.hash(endpoint);
        boolean exists = Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from push_subscription where group_member_id=? and endpoint_hash=?)", Boolean.class, member.getId(), hash));
        if (!exists && jdbc.queryForObject("select count(*) from push_subscription where group_member_id=?", Integer.class, member.getId()) >= 10)
            throw new ApiException(HttpStatus.CONFLICT, "PUSH_DEVICE_LIMIT", "알림은 파티당 최대 10개 기기에서 받을 수 있습니다.");
        // 같은 브라우저에서 계정을 바꿨다면 이전 계정의 알림 연결을 정리한다.
        jdbc.update("""
            delete from push_subscription s using group_member m
            where s.group_member_id=m.id and s.endpoint_hash=? and m.user_id is distinct from ?
            """, hash, member.getUser() == null ? null : member.getUser().getId());
        jdbc.update("""
            insert into push_subscription(group_member_id,user_session_id,endpoint_hash,endpoint,p256dh,auth)
            values(?,?,?,?,?,?) on conflict(group_member_id,endpoint_hash) do update
            set user_session_id=excluded.user_session_id, endpoint=excluded.endpoint, p256dh=excluded.p256dh, auth=excluded.auth
            """, member.getId(), parent, hash, endpoint, p256dh, auth);
    }

    @Transactional
    public void unsubscribe(MemberPrincipal principal, String endpoint) {
        PushEndpoint.validate(endpoint);
        jdbc.update("delete from push_subscription where group_member_id=? and endpoint_hash=?", principal.groupMemberId(), tokens.hash(endpoint));
    }

    /** 강퇴 시 구독과 대기 중인 알림을 함께 정리한다. */
    @Transactional
    public void removeMember(Long memberId) {
        jdbc.update("delete from push_delivery where actor_id=?", memberId);
        jdbc.update("delete from push_subscription where group_member_id=?", memberId);
    }

    @Transactional
    public void logoutMember(Long memberId, Long parentSessionId) {
        jdbc.update("delete from push_subscription where group_member_id=? and user_session_id=?", memberId, parentSessionId);
    }

    @Transactional
    public void linkMember(Long memberId, Long parentSessionId) {
        jdbc.update("update push_subscription set user_session_id=? where group_member_id=?", parentSessionId, memberId);
    }
}
