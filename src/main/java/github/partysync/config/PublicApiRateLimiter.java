package github.partysync.config;

import java.time.Clock;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import github.partysync.groupmember.auth.MemberTokenService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** 단일 운영 인스턴스의 공개 그룹 생성·가입을 주소별로 제한한다. */
@Component
public class PublicApiRateLimiter {
    private record Window(long startedAt, int count) { }
    private final Map<String, Window> windows = new HashMap<>();
    private final Clock clock;
    private final MemberTokenService tokens;
    private final boolean enabled;
    private final int createAttempts, joinAttempts;
    private final long windowMillis;

    public PublicApiRateLimiter(Clock clock, MemberTokenService tokens,
            @Value("${app.public-rate-limit.enabled:false}") boolean enabled,
            @Value("${app.public-rate-limit.create-attempts:10}") int createAttempts,
            @Value("${app.public-rate-limit.join-attempts:30}") int joinAttempts,
            @Value("${app.public-rate-limit.window:PT1M}") Duration window) {
        if (createAttempts < 1 || joinAttempts < 1 || window.toMillis() < 1) throw new IllegalArgumentException("Invalid public API rate limit");
        this.clock = clock; this.tokens = tokens; this.enabled = enabled;
        this.createAttempts = createAttempts; this.joinAttempts = joinAttempts; windowMillis = window.toMillis();
    }

    /** Tomcat이 신뢰된 프록시에 대해서만 복원한 remoteAddr를 사용한다. */
    public synchronized boolean allow(String address, String path) {
        if (!enabled) return true;
        long now = clock.millis();
        windows.entrySet().removeIf(e -> now - e.getValue().startedAt() >= windowMillis);
        String key = path + ':' + tokens.hash(address);
        Window previous = windows.get(key);
        int limit = path.equals("/api/groups") ? createAttempts : joinAttempts;
        if (previous == null && windows.size() >= 10000) return false;
        if (previous != null && previous.count() >= limit) return false;
        windows.put(key, new Window(previous == null ? now : previous.startedAt(), previous == null ? 1 : previous.count() + 1));
        return true;
    }
}
