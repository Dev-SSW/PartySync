package github.partysync.account;

import jakarta.servlet.http.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import github.partysync.common.ApiException;

/** 로그인 복원 쿠키의 발급·갱신·삭제와 요청 출처 검증을 담당한다. */
@RestController
public class RememberLoginController {
    static final String COOKIE="partysync_remember";
    private final RememberLoginService remember;
    private final boolean secure;
    private final java.time.Duration ttl;
    public RememberLoginController(RememberLoginService remember, @Value("${AUTH_COOKIE_SECURE:true}") boolean secure, @Value("${REMEMBER_LOGIN_TTL:P30D}") java.time.Duration ttl) {
        this.remember=remember; this.secure=secure; this.ttl=ttl;
    }
    /** 쿠키 변경은 전용 헤더와 같은 Origin의 요청만 허용한다. */
    static void protect(HttpServletRequest request) {
        if (!"web".equals(request.getHeader("X-PartySync-Client")))
            throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","Client header required");
        String origin=request.getHeader("Origin");
        String expected=request.getScheme()+"://"+request.getServerName();
        int port=request.getServerPort();
        if (!(request.isSecure() && port==443) && !(!request.isSecure() && port==80)) expected+=":"+port;
        if (origin!=null && !origin.equals(expected))
            throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","Same origin required");
    }
    /** 요청 쿠키에서 복원 토큰을 찾는다. */
    String secret(HttpServletRequest request) {
        if (request.getCookies()!=null) for (Cookie cookie:request.getCookies()) if (COOKIE.equals(cookie.getName())) return cookie.getValue();
        return null;
    }
    /** 로그인 유지 선택에 따라 영속 쿠키 또는 세션 쿠키를 설정한다. */
    void cookie(HttpServletResponse response,String raw,boolean persistent, java.time.Instant expiry) {
        var builder=ResponseCookie.from(COOKIE,raw).httpOnly(true).secure(secure).sameSite("Strict").path("/api/auth");
        if (raw.isEmpty()) builder.maxAge(0);
        else if (persistent) builder.maxAge(java.time.Duration.between(java.time.Instant.now(),expiry));
        response.addHeader(HttpHeaders.SET_COOKIE,builder.build().toString());
    }
    /** 이 브라우저의 이전 세션을 폐기하고 새 복원 쿠키를 발급한다. */
    void signedIn(AccountResponses.SignedIn login, boolean persistent, HttpServletRequest request, HttpServletResponse response) {
        protect(request);
        remember.revoke(secret(request));
        cookie(response,remember.issue(login,persistent),persistent,java.time.Instant.now().plus(ttl));
    }
    /** 쿠키로 계정 인증을 복원하고 새 API 토큰을 반환한다. */
    @PostMapping("/api/auth/refresh")
    public ResponseEntity<AccountResponses.SignedIn> refresh(HttpServletRequest request, HttpServletResponse response) {
        protect(request);
        try {
            var result=remember.refresh(secret(request));
            // 최초 만료 시각과 로그인 유지 선택을 그대로 유지한다.
            cookie(response,result.secret(),result.persistent(),result.expiresAt());
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(result.login());
        } catch (ApiException invalid) { cookie(response,"",false,null); throw invalid; }
    }
    /** 현재 기기의 복원 세션을 폐기하고 쿠키를 지운다. */
    @PostMapping("/api/auth/forget")
    public ResponseEntity<Void> forget(HttpServletRequest request,HttpServletResponse response) {
        protect(request); remember.revoke(secret(request)); cookie(response,"",false,null);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
