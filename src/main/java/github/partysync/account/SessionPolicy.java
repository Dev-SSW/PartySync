package github.partysync.account;

import java.time.Clock;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class SessionPolicy {
    final Duration accountTtl;
    final Duration memberTtl;
    public SessionPolicy(@Value("${app.auth.account-ttl:PT15M}") Duration accountTtl,
                         @Value("${app.auth.member-ttl:PT12H}") Duration memberTtl) {
        if (accountTtl.isNegative() || accountTtl.isZero() || memberTtl.isNegative() || memberTtl.isZero()) throw new IllegalArgumentException("Session TTL must be positive");
        this.accountTtl = accountTtl; this.memberTtl = memberTtl;
    }
    @Bean Clock authClock() { return Clock.systemUTC(); }
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(12); }
}
