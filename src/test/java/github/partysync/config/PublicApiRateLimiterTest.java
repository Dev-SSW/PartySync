package github.partysync.config;

import java.time.*;
import github.partysync.groupmember.auth.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class PublicApiRateLimiterTest {
    @Test void limitsEndpointsIndependentlyAndExpiresWindows() {
        Clock clock = mock(Clock.class);
        when(clock.millis()).thenReturn(1000L);
        var limiter = new PublicApiRateLimiter(clock, new MemberTokenService(new SecureCodeGenerator()), true, 1, 2, Duration.ofMinutes(1));
        assertThat(limiter.allow("192.0.2.1", "/api/groups")).isTrue();
        assertThat(limiter.allow("192.0.2.1", "/api/groups")).isFalse();
        assertThat(limiter.allow("192.0.2.2", "/api/groups")).isTrue();
        assertThat(limiter.allow("192.0.2.1", "/api/groups/join")).isTrue();
        assertThat(limiter.allow("192.0.2.1", "/api/groups/join")).isTrue();
        assertThat(limiter.allow("192.0.2.1", "/api/groups/join")).isFalse();
        when(clock.millis()).thenReturn(61000L);
        assertThat(limiter.allow("192.0.2.1", "/api/groups")).isTrue();
    }

    @Test void filterReturnsSanitized429BeforeReadingBodyAndIgnoresSpoofedForwarding() throws Exception {
        var limiter = new PublicApiRateLimiter(Clock.systemUTC(), new MemberTokenService(new SecureCodeGenerator()), true, 1, 2, Duration.ofMinutes(1));
        var filter = new PublicApiRateLimitFilter(limiter, new SecurityErrorWriter(new ObjectMapper()));
        var first = new MockHttpServletRequest("POST", "/api/groups"); first.setRemoteAddr("192.0.2.1");
        filter.doFilter(first, new MockHttpServletResponse(), new MockFilterChain());
        var second = new MockHttpServletRequest("POST", "/api/groups"); second.setRemoteAddr("192.0.2.1"); second.addHeader("X-Forwarded-For", "198.51.100.2");
        var response = new MockHttpServletResponse(); var chain = new MockFilterChain();
        filter.doFilter(second, response, chain);
        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getContentAsString()).contains("PUBLIC_API_RATE_LIMITED").doesNotContain("192.0.2.1");
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(chain.getRequest()).isNull();
    }

    @Test void encodedPublicPathCannotBypassTheSameLimit() throws Exception {
        var limiter = new PublicApiRateLimiter(Clock.systemUTC(), new MemberTokenService(new SecureCodeGenerator()), true, 1, 2, Duration.ofMinutes(1));
        var filter = new PublicApiRateLimitFilter(limiter, new SecurityErrorWriter(new ObjectMapper()));
        var first = new MockHttpServletRequest("POST", "/api/groups"); first.setRemoteAddr("192.0.2.1"); first.setServletPath("/api/groups");
        filter.doFilter(first, new MockHttpServletResponse(), new MockFilterChain());
        var encoded = new MockHttpServletRequest("POST", "/%61pi/groups"); encoded.setRemoteAddr("192.0.2.1"); encoded.setServletPath("/api/groups");
        var response = new MockHttpServletResponse();
        filter.doFilter(encoded, response, new MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(429);
    }
}
