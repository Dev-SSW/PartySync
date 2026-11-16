package github.partysync.account;

import java.time.Clock;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import github.partysync.common.ApiException;
import github.partysync.groupmember.auth.MemberTokenService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** 단일 서버용 제한기. 전달 헤더 대신 실제 접속 주소를 사용하고 저장 공간을 제한한다. */
@Component
public class AuthRateLimiter {
    private record Window(long since, int count) { }
    private final Map<String, Window> windows = new HashMap<>();
    private final Clock clock;
    private final MemberTokenService tokens;
    private final int ipAttempts, loginAttempts;
    private final long windowMillis;
    public AuthRateLimiter(Clock clock, MemberTokenService tokens,
                           @Value("${app.auth.rate-limit.ip-attempts:30}") int ipAttempts,
                           @Value("${app.auth.rate-limit.login-attempts:10}") int loginAttempts,
                           @Value("${app.auth.rate-limit.window:PT5M}") Duration window) {
        if (ipAttempts < 1 || loginAttempts < 1 || window.isNegative() || window.isZero()) throw new IllegalArgumentException("Invalid rate limit");
        this.clock = clock; this.tokens = tokens; this.ipAttempts = ipAttempts; this.loginAttempts = loginAttempts; windowMillis = window.toMillis();
    }
    public synchronized void check(String address, String loginId) {
        long now = clock.millis();
        windows.entrySet().removeIf(e -> now - e.getValue().since() >= windowMillis);
        if (windows.size() >= 10000) throw limited();
        take("ip:" + tokens.hash(address), ipAttempts, now);
        take("login:" + tokens.hash(loginId), loginAttempts, now);
    }
    private void take(String key, int limit, long now) {
        Window current = windows.getOrDefault(key, new Window(now, 0));
        if (current.count() >= limit) throw limited();
        windows.put(key, new Window(current.since(), current.count() + 1));
    }
    private ApiException limited() { return new ApiException(HttpStatus.TOO_MANY_REQUESTS, "AUTH_RATE_LIMITED", "요청이 많습니다. 잠시 후 다시 시도하세요."); }
}
