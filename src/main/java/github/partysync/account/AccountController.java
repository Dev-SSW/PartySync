package github.partysync.account;

import java.util.List;
import github.partysync.groupmember.auth.MemberPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
public class AccountController {
    private final AccountService accounts;
    private final AuthRateLimiter limiter;
    private final RememberLoginController remember;
    public AccountController(AccountService accounts, AuthRateLimiter limiter, RememberLoginController remember) { this.accounts = accounts; this.limiter = limiter; this.remember=remember; }

    /** 계정을 등록하고 새 계정 세션을 발급한다. */
    @PostMapping("/api/auth/register")
    public ResponseEntity<AccountResponses.SignedIn> register(@Valid @RequestBody AccountRequests.Credentials request, HttpServletRequest http, jakarta.servlet.http.HttpServletResponse response, @RequestParam(defaultValue="true") boolean rememberMe) {
        RememberLoginController.protect(http);
        limiter.check(http.getRemoteAddr(), request.loginId());
        var login=accounts.register(request); remember.signedIn(login,rememberMe,http,response);
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore()).body(login);
    }
    /** 비밀번호를 검증하고 이 기기의 로그인 세션을 생성한다. */
    @PostMapping("/api/auth/login")
    public ResponseEntity<AccountResponses.SignedIn> login(@Valid @RequestBody AccountRequests.Credentials request, HttpServletRequest http, jakarta.servlet.http.HttpServletResponse response, @RequestParam(defaultValue="true") boolean rememberMe) {
        RememberLoginController.protect(http);
        limiter.check(http.getRemoteAddr(), request.loginId());
        var login=accounts.login(request); remember.signedIn(login,rememberMe,http,response);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(login);
    }
    /** 초대받은 파티에 연결된 기존 멤버 세션을 발급한다. */
    @PostMapping("/api/account/invite/session")
    public AccountResponses.Membership resume(@AuthenticationPrincipal AccountPrincipal principal, @Valid @RequestBody github.partysync.group.GroupRequests.Invite request) { return accounts.resumeInvite(principal, request.inviteCode()); }

    /** 계정 공개 정보를 조회한다. */
    @GetMapping("/api/account/me")
    public AccountResponses.Me me(@AuthenticationPrincipal AccountPrincipal principal) { return accounts.me(principal); }
    /** 계정에 연결된 그룹을 조회한다. */
    @GetMapping("/api/account/groups")
    public List<AccountResponses.Group> groups(@AuthenticationPrincipal AccountPrincipal principal) { return accounts.groups(principal); }
    /** 실제 비회원 토큰을 보유한 멤버만 현재 계정에 연결한다. */
    @PostMapping("/api/account/memberships/claim")
    public AccountResponses.Membership claim(@AuthenticationPrincipal AccountPrincipal principal, @Valid @RequestBody AccountRequests.Claim request) { return accounts.claim(principal, request.memberAccessToken()); }
    /** 기존 그룹 멤버 세션을 재발급한다. */
    @PostMapping("/api/account/groups/{groupId}/session")
    public AccountResponses.Membership enter(@AuthenticationPrincipal AccountPrincipal principal, @PathVariable Long groupId) { return accounts.enter(principal, groupId); }
    /** 현재 기기의 계정 및 하위 그룹 세션을 로그아웃한다. */
    @PostMapping("/api/auth/logout")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal AccountPrincipal principal, HttpServletRequest request, jakarta.servlet.http.HttpServletResponse response) { RememberLoginController.protect(request); accounts.logout(principal); return remember.forget(request,response); }
    /** 현재 그룹 세션만 로그아웃한다. */
    @PostMapping("/api/members/me/session/logout")
    public ResponseEntity<Void> logoutMember(@AuthenticationPrincipal MemberPrincipal principal, @RequestHeader("Authorization") String authorization) {
        accounts.logoutMember(authorization.substring(7), principal);
        return ResponseEntity.noContent().build();
    }
}
