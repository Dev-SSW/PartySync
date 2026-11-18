package github.partysync.config;

import java.util.Arrays;
import java.util.List;
import java.io.IOException;

import github.partysync.groupmember.auth.MemberAuthenticationFilter;
import github.partysync.groupmember.auth.MemberAuthenticationService;
import github.partysync.groupmember.auth.SecurityErrorWriter;
import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.cors.DefaultCorsProcessor;
import org.springframework.web.filter.CorsFilter;
import org.springframework.http.server.ServerHttpResponse;

/**
 * 공개 경로·Bearer 인증·stateless 정책·CORS를 설정
 * 그룹 소속과 OWNER 권한은 Service에서도 검증
 */
@Configuration
public class SecurityConfig {
    /**
     * CORS를 인증보다 먼저 검사
     * 필터 오류도 공통 JSON 형식으로 응답
     */
    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            MemberAuthenticationService authentication,
            SecurityErrorWriter errors,
            github.partysync.account.AccountService accounts,
            PublicApiRateLimiter publicLimits,
            @Qualifier("corsConfigurationSource") CorsConfigurationSource corsSource
    ) throws Exception {
        CorsFilter corsFilter = new CorsFilter(corsSource);
        corsFilter.setCorsProcessor(new DefaultCorsProcessor() {
            @Override
            protected void rejectRequest(ServerHttpResponse response) throws IOException {errors.rejectCors(response);}
        });
        return http
                .cors(AbstractHttpConfigurer::disable)
                // API는 Bearer 인증. 복원 쿠키 변경은 컨트롤러의 Origin/커스텀 헤더 검사로 보호한다.
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                // 운영 TLS와 HSTS는 Caddy에서 관리하며 HTTPS 검증 후 명시적으로 활성화한다.
                .headers(headers -> headers.httpStrictTransportSecurity(hsts -> hsts.disable()))
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint((request, response, exception) -> errors.write(response, 401))
                        .accessDeniedHandler((request, response, exception) -> errors.write(response, 403)))
                .authorizeHttpRequests(requests -> requests
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.POST, "/api/groups", "/api/groups/join", "/api/auth/register", "/api/auth/login", "/api/auth/refresh", "/api/auth/forget").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/actuator/health").permitAll()
                        .requestMatchers("/actuator/**").denyAll()
                        .requestMatchers("/api/account/**", "/api/auth/logout").hasRole("ACCOUNT")
                        .requestMatchers("/api/groups/**", "/api/members/**").hasAnyRole("OWNER", "MEMBER")
                        .anyRequest().authenticated())
                .addFilterBefore(new MemberAuthenticationFilter(authentication, errors, accounts),
                        UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(new PublicApiRateLimitFilter(publicLimits, errors), MemberAuthenticationFilter.class)
                .addFilterBefore(corsFilter, PublicApiRateLimitFilter.class)
                .build();
    }

    /**
     * 설정된 Origin만 허용
     * 빈 목록은 교차 Origin 접근을 거절하며 쿠키 credentials도 허용하지 않음
     */
    @Bean
    CorsConfigurationSource corsConfigurationSource(@Value("${app.security.allowed-origins:}") String origins) {
        List<String> allowed = Arrays.stream(origins.split(",")).map(String::strip)
                .filter(origin -> !origin.isEmpty()).toList();
        if (allowed.stream().anyMatch(origin -> origin.contains("*") || origin.equals("null"))) {
            throw new IllegalArgumentException("CORS origins must be explicit origins; wildcard/null is forbidden");
        }
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(allowed);
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "X-PartySync-Client"));
        cors.setExposedHeaders(List.of("Location"));
        cors.setAllowCredentials(false);
        cors.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cors);
        return source;
    }
}
