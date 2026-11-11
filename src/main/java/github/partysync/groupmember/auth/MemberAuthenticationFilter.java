package github.partysync.groupmember.auth;

import java.io.IOException;
import java.util.Collections;
import java.util.List;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Bearer 토큰을 검증해 요청 단위 인증 정보를 구성
 * SecurityFilterChain 안에서만 생성해 중복 등록을 피함
 */
public class MemberAuthenticationFilter extends OncePerRequestFilter {
    private final MemberAuthenticationService authentication;
    private final SecurityErrorWriter errors;

    public MemberAuthenticationFilter(MemberAuthenticationService authentication, SecurityErrorWriter errors) {
        this.authentication = authentication;
        this.errors = errors;
    }

    /**
     * Bearer 헤더가 있으면 인증
     * 헤더가 없으면 공개/보호 경로 판단을 다음 보안 필터에 맡김
     */
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        List<String> headers = Collections.list(request.getHeaders(HttpHeaders.AUTHORIZATION));
        if (!headers.isEmpty()) {
            String header = headers.getFirst();
            if (headers.size() != 1 || header.length() > 128 || !header.regionMatches(true, 0, "Bearer ", 0, 7)) {
                errors.write(response, 401);
                return;
            }
            MemberPrincipal principal;
            try {
                principal = authentication.authenticate(header.substring(7)).orElse(null);
            // DB 장애는 잘못된 토큰(401)과 구분해 서버 오류(500)로 처리
            } catch (DataAccessException unavailable) {
                errors.write(response, 500);
                return;
            }
            if (principal == null) {
                errors.write(response, 401);
                return;
            }
            // DB에서 확인한 역할만 신뢰하며 인증 객체의 credentials에는 토큰 원문을 남기지 않음
            var context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null,
                    List.of(new SimpleGrantedAuthority("ROLE_" + principal.role().name()))));
            SecurityContextHolder.setContext(context);
        }
        chain.doFilter(request, response);
    }
}
