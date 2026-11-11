package github.partysync.common;

import org.springframework.http.HttpStatus;

/**
 * 비즈니스 오류의 HTTP 상태와 공개 오류 코드를 전달
 * 메시지는 응답에 쓰이므로 비밀 값을 담지 않음
 */
public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() { return status; }
    public String getCode() { return code; }
}
