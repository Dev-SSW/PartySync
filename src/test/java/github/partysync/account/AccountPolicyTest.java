package github.partysync.account;

import java.time.*;
import github.partysync.common.ApiException;
import github.partysync.groupmember.auth.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class AccountPolicyTest {
    @Test void identifiersAndPasswordByteLimits() {
        assertThat(AccountInput.loginId("  RAID_Master  ")).isEqualTo("raid_master");
        AccountInput.validatePassword("가".repeat(24));
        AccountInput.validatePassword("a".repeat(72));
        assertThatThrownBy(() -> AccountInput.validatePassword("가".repeat(25))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> AccountInput.validatePassword("short")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> AccountInput.validatePassword("a".repeat(12) + '\0')).isInstanceOf(ApiException.class);
        assertThat(new AccountRequests.Credentials("test", "secret-value-123").toString()).doesNotContain("secret-value");
    }
    @Test void expiryBoundaryAndRevocation() {
        Instant now = Instant.parse("2026-11-15T00:00:00Z");
        var session = new UserSession(new UserAccount("test", "hash"), "hash", now, now.plusSeconds(10));
        assertThat(session.active(now.plusSeconds(9))).isTrue();
        assertThat(session.active(now.plusSeconds(10))).isFalse();
        session.revoke(now.plusSeconds(1)); session.revoke(now.plusSeconds(2));
        assertThat(session.getRevokedAt()).isEqualTo(now.plusSeconds(1));
        assertThat(session.active(now.plusSeconds(3))).isFalse();
    }
    @Test void limitsArePerAddressAndPerId_andResetWithTime() {
        Clock clock = mock(Clock.class);
        when(clock.millis()).thenReturn(1000L);
        var tokens = new MemberTokenService(new SecureCodeGenerator());
        var limiter = new AuthRateLimiter(clock, tokens, 2, 1, Duration.ofMinutes(5));
        limiter.check("127.0.0.1", "user1");
        assertThatThrownBy(() -> limiter.check("127.0.0.2", "user1")).isInstanceOf(ApiException.class);
        limiter.check("127.0.0.1", "user2");
        assertThatThrownBy(() -> limiter.check("127.0.0.1", "user3")).isInstanceOf(ApiException.class);
        when(clock.millis()).thenReturn(301000L);
        limiter.check("127.0.0.1", "user1");
    }
}
