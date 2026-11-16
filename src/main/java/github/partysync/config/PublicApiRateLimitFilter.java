package github.partysync.config;

import java.io.IOException;
import github.partysync.groupmember.auth.SecurityErrorWriter;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.web.filter.OncePerRequestFilter;

/** 요청 본문 파싱·DB 쓰기 전에 공개 API의 과도한 요청을 거절한다. */
public class PublicApiRateLimitFilter extends OncePerRequestFilter {
    private final PublicApiRateLimiter limiter;
    private final SecurityErrorWriter errors;
    public PublicApiRateLimitFilter(PublicApiRateLimiter limiter, SecurityErrorWriter errors) { this.limiter = limiter; this.errors = errors; }
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        // Servlet 경로는 Tomcat이 디코딩한 값이므로 /%61pi/... 형태로 제한을 우회할 수 없다.
        String path = request.getServletPath();
        if (path.isEmpty()) path = request.getRequestURI();
        if (request.getMethod().equals("POST") && (path.equals("/api/groups") || path.equals("/api/groups/join")) && !limiter.allow(request.getRemoteAddr(), path)) {
            response.setHeader("Retry-After", "60");
            errors.write(response, 429);
            return;
        }
        chain.doFilter(request, response);
    }
}
