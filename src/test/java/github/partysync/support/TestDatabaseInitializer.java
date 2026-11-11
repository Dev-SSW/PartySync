package github.partysync.support;

import java.net.URI;

import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * 테스트 데이터 정리가 개발 DB를 건드리지 않도록 Flyway와 DataSource 생성 전에 연결 대상을 확인한다.
 * 접속 정보 자체는 application-test.yml에서 관리하며 이 클래스는 연결을 생성하지 않는다.
 */
public class TestDatabaseInitializer implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    @Override
    public void initialize(ConfigurableApplicationContext context) {
        var environment = context.getEnvironment();
        String jdbcUrl = environment.getRequiredProperty("spring.datasource.url");
        String flywayUrl = environment.getRequiredProperty("spring.flyway.url");
        validateUrl(jdbcUrl);
        validateUrl(flywayUrl);
        if (!jdbcUrl.equals(flywayUrl)) {
            throw new IllegalArgumentException("JPA and Flyway must use the same dedicated test database");
        }
        if (jdbcUrl.equals(environment.getProperty("DB_URL"))) {
            throw new IllegalArgumentException("TEST_DB_URL must be different from application DB_URL");
        }
    }

    static void validateUrl(String url) {
        boolean valid = false;
        try {
            if (url != null && url.startsWith("jdbc:postgresql://")) {
                URI uri = URI.create(url.substring("jdbc:".length()));
                String host = uri.getHost();
                valid = ("localhost".equals(host) || "127.0.0.1".equals(host) || "[::1]".equals(host))
                        && uri.getRawPath() != null && uri.getRawPath().matches("(?i)/[a-z0-9_]+_test")
                        && uri.getRawUserInfo() == null && uri.getRawQuery() == null && uri.getRawFragment() == null;
            }
        } catch (IllegalArgumentException ignored) {
            // URL에 인증 정보가 잘못 들어 있어도 예외 메시지로 원문을 노출하지 않는다.
        }
        if (!valid) {
            throw new IllegalArgumentException(
                    "Tests require a local PostgreSQL database ending in _test without URL parameters");
        }
    }
}
