package github.partysync.config;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Optional;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.auditing.DateTimeProvider;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

/**
 * 운영체제의 기본 타임존과 무관하게 엔티티 감사 시간을 Asia/Seoul 기준으로 고정
 */
@Configuration
@EnableJpaAuditing(dateTimeProviderRef = "seoulDateTimeProvider")
public class JpaAuditingConfig {
    /**
     * JPA의 @CreatedDate와 @LastModifiedDate에 서울 기준 현재 시각을 제공
     */
    @Bean
    DateTimeProvider seoulDateTimeProvider() {
        return () -> Optional.of(LocalDateTime.now(ZoneId.of("Asia/Seoul")));
    }
}
