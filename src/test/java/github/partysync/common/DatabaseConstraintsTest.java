package github.partysync.common;

import java.sql.SQLException;

import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.Test;
import org.postgresql.util.PSQLException;
import org.postgresql.util.PSQLState;
import org.postgresql.util.ServerErrorMessage;
import org.springframework.dao.DataIntegrityViolationException;

import static org.assertj.core.api.Assertions.assertThat;

/** PostgreSQL 오류 메시지의 언어와 무관하게 실제 제약조건을 판별하는지 검증한다. */
class DatabaseConstraintsTest {
    private static final String NICKNAME = "uk_member_group_nickname";

    @Test
    void matchesHibernateConstraintName() {
        var exception = new ConstraintViolationException("duplicate", new SQLException("duplicate", "23505"), NICKNAME);
        assertThat(DatabaseConstraints.isViolation(exception, NICKNAME)).isTrue();
    }

    @Test
    void matchesPostgresMetadataWhenHibernateCannotParseLocalizedMessage() {
        var postgres = postgresError(NICKNAME, "중복된 키 값이 고유 제약 조건을 위반함");
        var hibernate = new ConstraintViolationException("localized", postgres, null);
        var wrapped = new DataIntegrityViolationException("wrapped", hibernate);
        assertThat(hibernate.getConstraintName()).isNull();
        assertThat(DatabaseConstraints.isViolation(wrapped, NICKNAME)).isTrue();
    }

    @Test
    void doesNotTrustConstraintNamesMentionedOnlyInMessageText() {
        var postgres = postgresError("another_constraint", "입력값에 " + NICKNAME + " 문자가 포함됨");
        assertThat(DatabaseConstraints.isViolation(postgres, NICKNAME)).isFalse();
    }

    @Test
    void handlesMissingServerMetadataWithoutThrowing() {
        var postgres = new PSQLException("no server metadata", PSQLState.UNIQUE_VIOLATION);
        assertThat(DatabaseConstraints.isViolation(postgres, NICKNAME)).isFalse();
        assertThat(DatabaseConstraints.isViolation(new IllegalStateException("not a DB error"), NICKNAME)).isFalse();
    }

    private PSQLException postgresError(String constraint, String message) {
        // PostgreSQL 오류 응답의 C 필드는 SQLState, n 필드는 제약조건 이름, M 필드는 번역 가능한 메시지다.
        return new PSQLException(new ServerErrorMessage(
                "SERROR\0C23505\0n" + constraint + "\0M" + message + "\0\0"));
    }
}
