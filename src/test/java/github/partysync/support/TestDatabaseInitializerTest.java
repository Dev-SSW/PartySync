package github.partysync.support;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Flyway나 데이터 삭제가 시작되기 전에 잘못된 DB 설정을 차단하는지 확인한다. */
class TestDatabaseInitializerTest {
    @ParameterizedTest
    @ValueSource(strings = {
            "jdbc:postgresql://localhost:5432/PartySync_Test",
            "jdbc:postgresql://localhost:5432/raidsync_test",
            "jdbc:postgresql://127.0.0.1:15432/raidsync_test",
            "jdbc:postgresql://[::1]:5432/raidsync_test"})
    void acceptsDedicatedLocalDatabase(String url) {
        assertThatCode(() -> TestDatabaseInitializer.validateUrl(url)).doesNotThrowAnyException();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "jdbc:postgresql://localhost:5432/PartySync",
            "jdbc:postgresql://localhost:5432/raidsync",
            "jdbc:postgresql://localhost:5432/postgres",
            "jdbc:postgresql://remote.example:5432/raidsync_test",
            "jdbc:postgresql://localhost:5432/raidsync_test?currentSchema=public",
            "jdbc:postgresql://user:secret@localhost:5432/raidsync_test",
            "jdbc:postgresql://localhost:5432/raidsync_test#fragment",
            "jdbc:postgresql://localhost:5432/%72aidsync_test",
            "not-a-jdbc-url"})
    void rejectsDevelopmentDatabaseAndAmbiguousTargets(String url) {
        assertThatThrownBy(() -> TestDatabaseInitializer.validateUrl(url))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsDifferentJpaAndFlywayTargets() {
        var environment = new MockEnvironment()
                .withProperty("spring.datasource.url", "jdbc:postgresql://localhost:5432/raidsync_test")
                .withProperty("spring.flyway.url", "jdbc:postgresql://localhost:15432/raidsync_test");
        try (var context = new GenericApplicationContext()) {
            context.setEnvironment(environment);
            assertThatThrownBy(() -> new TestDatabaseInitializer().initialize(context))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("same dedicated test database");
        }
    }

    @Test
    void rejectsSharingApplicationDatabase() {
        String url = "jdbc:postgresql://localhost:5432/raidsync_test";
        var environment = new MockEnvironment().withProperty("spring.datasource.url", url)
                .withProperty("spring.flyway.url", url).withProperty("DB_URL", url);
        try (var context = new GenericApplicationContext()) {
            context.setEnvironment(environment);
            assertThatThrownBy(() -> new TestDatabaseInitializer().initialize(context))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("different from application DB_URL");
        }
    }
}
