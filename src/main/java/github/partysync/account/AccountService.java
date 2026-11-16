package github.partysync.account;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import github.partysync.common.ApiException;
import github.partysync.group.GroupResponses;
import github.partysync.groupmember.*;
import github.partysync.groupmember.auth.MemberTokenService;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {
    private final UserAccountRepository users;
    private final UserSessionRepository sessions;
    private final MemberSessionRepository memberSessions;
    private final GroupMemberRepository members;
    private final MemberTokenService tokens;
    private final PasswordEncoder passwords;
    private final SessionPolicy policy;
    private final Clock clock;
    private final String dummyPasswordHash;

    public AccountService(UserAccountRepository users, UserSessionRepository sessions, MemberSessionRepository memberSessions,
                          GroupMemberRepository members, MemberTokenService tokens, PasswordEncoder passwords, SessionPolicy policy, Clock clock) {
        this.users = users; this.sessions = sessions; this.memberSessions = memberSessions; this.members = members;
        this.tokens = tokens; this.passwords = passwords; this.policy = policy; this.clock = clock;
        dummyPasswordHash = passwords.encode("timing-defense-placeholder");
    }

    /** 계정을 생성하고 별도 그룹 가입 없이 새 계정 세션을 발급한다. */
    @Transactional
    public AccountResponses.SignedIn register(AccountRequests.Credentials request) {
        AccountInput.validatePassword(request.password());
        if (users.findByLoginId(request.loginId()).isPresent()) throw new ApiException(HttpStatus.CONFLICT, "LOGIN_ID_CONFLICT", "이미 사용 중인 로그인 ID입니다.");
        UserAccount user = users.saveAndFlush(new UserAccount(request.loginId(), passwords.encode(request.password())));
        return signIn(user);
    }

    /** 계정 존재 여부와 무관하게 BCrypt 검증을 수행하고 기기별 세션을 추가한다. */
    @Transactional
    public AccountResponses.SignedIn login(AccountRequests.Credentials request) {
        AccountInput.validatePassword(request.password());
        UserAccount user = users.findByLoginId(request.loginId()).orElse(null);
        boolean matches = passwords.matches(request.password(), user == null ? dummyPasswordHash : user.getPasswordHash());
        if (user == null || !matches) throw unauthorized();
        return signIn(user);
    }

    private AccountResponses.SignedIn signIn(UserAccount user) {
        String raw = "u_" + tokens.issue().raw();
        Instant now = clock.instant(), expiry = now.plus(policy.accountTtl);
        sessions.saveAndFlush(new UserSession(user, tokens.hash(raw), now, expiry));
        return new AccountResponses.SignedIn(AccountResponses.Me.from(user), raw, expiry);
    }

    @Transactional(readOnly = true)
    public Optional<AccountPrincipal> authenticate(String raw) {
        if (raw == null || !raw.startsWith("u_") || !tokens.hasValidFormat(raw.substring(2))) return Optional.empty();
        return sessions.authenticate(tokens.hash(raw), clock.instant());
    }

    /** 인증된 계정의 공개 정보만 반환한다. */
    @Transactional(readOnly = true)
    public AccountResponses.Me me(AccountPrincipal principal) {
        requireActive(principal);
        return AccountResponses.Me.from(users.findById(principal.userId()).orElseThrow(AccountService::unauthorized));
    }

    /** 이 계정에 연결된 기존 GroupMember 목록을 조회한다. */
    @Transactional(readOnly = true)
    public List<AccountResponses.Group> groups(AccountPrincipal principal) {
        requireActive(principal);
        return members.findAccountGroups(principal.userId());
    }

    /** 비회원 토큰 검증·연결·과거 토큰 폐기·새 멤버 세션 발급을 한 트랜잭션에서 수행한다. */
    @Transactional
    public AccountResponses.Membership claim(AccountPrincipal principal, String guestToken) {
        UserSession parent = lockActive(principal);
        if (!tokens.hasValidFormat(guestToken)) throw unauthorized();
        // 잠금 획득 후 조건을 다시 검사하므로 두 계정이 같은 멤버를 가져갈 수 없다.
        GroupMember member = members.findGuestForClaim(tokens.hash(guestToken)).orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "CLAIM_UNAVAILABLE", "유효한 비회원 멤버 토큰을 확인하세요. 이미 연결되었을 수 있습니다."));
        if (members.findByUserIdAndGroupId(principal.userId(), member.getGroup().getId()).isPresent())
            throw new ApiException(HttpStatus.CONFLICT, "MEMBERSHIP_CONFLICT", "이 계정은 이미 해당 그룹에 연결되어 있습니다.");
        member.claim(parent.getUser());
        members.flush();
        return issueMember(member, parent);
    }

    /** 멤버를 새로 만들지 않고 연결된 기존 멤버에 새 기기용 세션을 발급한다. */
    @Transactional
    public AccountResponses.Membership enter(AccountPrincipal principal, Long groupId) {
        UserSession parent = lockActive(principal);
        GroupMember member = members.findByUserIdAndGroupId(principal.userId(), groupId)
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "연결된 그룹에만 입장할 수 있습니다."));
        return issueMember(member, parent);
    }

    private AccountResponses.Membership issueMember(GroupMember member, UserSession parent) {
        String raw = "m_" + tokens.issue().raw();
        Instant now = clock.instant(), expiry = now.plus(policy.memberTtl);
        if (!parent.active(now)) throw unauthorized();
        // 그룹 세션은 부모 계정 세션보다 오래 유효할 수 없다.
        if (expiry.isAfter(parent.getExpiresAt())) expiry = parent.getExpiresAt();
        memberSessions.saveAndFlush(new MemberSession(member, parent, tokens.hash(raw), now, expiry));
        var group = member.getGroup();
        return new AccountResponses.Membership(new GroupResponses.Details(group.getId(), group.getName(), group.getDescription(), members.countByGroupId(group.getId()), group.getCreatedAt()), MemberResponse.from(member), raw, expiry);
    }

    /** 현재 기기의 계정 세션과 그 하위 멤버 세션만 폐기한다. */
    @Transactional
    public void logout(AccountPrincipal principal) {
        UserSession parent = lockActive(principal);
        Instant now = clock.instant();
        parent.revoke(now);
        memberSessions.revokeChildren(parent.getId(), now);
    }

    /** 계정 기반 그룹 세션 하나만 폐기한다. 비회원 토큰의 복구 불가능한 삭제와 구분한다. */
    @Transactional
    public void logoutMember(String raw, github.partysync.groupmember.auth.MemberPrincipal principal) {
        if (!raw.startsWith("m_")) throw new ApiException(HttpStatus.CONFLICT, "GUEST_SESSION", "비회원 참여 정보는 계정 연결 후 관리할 수 있습니다.");
        MemberSession session = memberSessions.findByTokenHash(tokens.hash(raw)).orElseThrow(AccountService::unauthorized);
        if (principal == null || !session.getGroupMember().getId().equals(principal.groupMemberId())) throw unauthorized();
        session.revoke(clock.instant());
    }

    private void requireActive(AccountPrincipal principal) {
        if (principal == null || sessions.findById(principal.userSessionId()).filter(s -> s.getUser().getId().equals(principal.userId()) && s.active(clock.instant())).isEmpty()) throw unauthorized();
    }
    private UserSession lockActive(AccountPrincipal principal) {
        if (principal == null) throw unauthorized();
        return sessions.findLocked(principal.userSessionId()).filter(s -> s.getUser().getId().equals(principal.userId()) && s.active(clock.instant())).orElseThrow(AccountService::unauthorized);
    }
    static ApiException unauthorized() { return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증 정보를 확인할 수 없습니다."); }
}
