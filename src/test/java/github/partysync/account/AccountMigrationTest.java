package github.partysync.account;

import java.util.UUID;
import javax.sql.DataSource;
import github.partysync.support.TestDatabaseInitializer;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
@ContextConfiguration(initializers = TestDatabaseInitializer.class)
class AccountMigrationTest {
    @Autowired DataSource dataSource;

    @Test void v2GuestsAndTheirDataSurviveV3() {
        String schema = "phase6_migration_" + UUID.randomUUID().toString().replace("-", "");
        var jdbc = new JdbcTemplate(dataSource);
        try {
            // 전용 테스트 DB 안에 독립 스키마를 만들어 V2 당시 데이터를 재현한다.
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target(MigrationVersion.fromVersion("2")).load().migrate();
            Long group = jdbc.queryForObject("insert into " + schema + ".groups(name,invite_code,created_at,updated_at) values('Legacy','legacy',localtimestamp,localtimestamp) returning id", Long.class);
            Long member = jdbc.queryForObject("insert into " + schema + ".group_member(group_id,nickname,role,access_token_hash,joined_at) values(?,'LegacyOwner','OWNER',?,localtimestamp) returning id", Long.class, group, "a".repeat(64));
            jdbc.update("insert into " + schema + ".weekly_availability(group_member_id,day_of_week,start_minute,end_minute) values(?,'MONDAY',0,1440)", member);
            Long category = jdbc.queryForObject("insert into " + schema + ".game_category(group_id,name,created_at) values(?,'Game',localtimestamp) returning id", Long.class, group);
            jdbc.update("insert into " + schema + ".post(group_id,game_category_id,author_id,title,content,created_at,updated_at) values(?,?,?,'Legacy guide','Content',localtimestamp,localtimestamp)", group, category, member);
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load().migrate();
            assertThat(jdbc.queryForObject("select access_token_hash from " + schema + ".group_member where id=?", String.class, member)).isEqualTo("a".repeat(64));
            assertThat(jdbc.queryForObject("select user_id from " + schema + ".group_member where id=?", Long.class, member)).isNull();
            assertThat(jdbc.queryForObject("select active from " + schema + ".group_member where id=?", Boolean.class, member)).isTrue();
            assertThat(jdbc.queryForObject("select count(*) from " + schema + ".account_refresh_token", Long.class)).isZero();
            assertThat(jdbc.queryForObject("select author_id from " + schema + ".post", Long.class)).isEqualTo(member);
            assertThat(jdbc.queryForObject("select end_minute from " + schema + ".weekly_availability", Integer.class)).isEqualTo(1440);
        } finally {
            // 생성한 임시 스키마만 제거한다. public 및 실제 개발 DB는 대상이 아니다.
            if (!schema.matches("phase6_migration_[a-f0-9]{32}")) throw new IllegalStateException("Invalid test schema");
            jdbc.execute("drop schema if exists " + schema + " cascade");
        }
    }
}
