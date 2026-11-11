package github.partysync.common;

import org.hibernate.exception.ConstraintViolationException;

/**
 * Spring/JPA가 감싼 예외에서 DB 제약조건 이름을 확인해 닉네임 중복과 난수 충돌을 구별
 */
public final class DatabaseConstraints {
    private DatabaseConstraints() { }

    /**
     * 예외의 원인 체인 전체에서 지정한 이름의 제약조건 위반을 찾음
     * Hibernate 예외이며 입력값 검증용 jakarta.validation 예외와는 구분
     * @param error Spring 또는 JPA가 감싸 전달한 예외
     * @param name Flyway SQL에 정의한 제약조건 이름
     * @return 해당 제약조건 위반이 있으면 true
     */
    public static boolean isViolation(Throwable error, String name) {
        // 최상위 Spring 예외만 확인하면 내부 Hibernate 예외의 제약조건 이름을 놓칠 수 있음
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException violation && name.equals(violation.getConstraintName())) {
                return true;
            }
        }
        // 다른 제약조건 위반이나 일반 DB 오류의 처리는 호출자에게 맡긴다.
        return false;
    }
}
