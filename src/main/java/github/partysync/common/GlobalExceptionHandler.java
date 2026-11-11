package github.partysync.common;

import jakarta.validation.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Controller 예외를 공통 JSON 오류로 변환
 * 필터 단계 오류는 SecurityErrorWriter가 처리
 */
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiError> handleApi(ApiException error) {
        return error(error.getStatus(), error.getCode(), error.getMessage());
    }

    @ExceptionHandler({
            MethodArgumentNotValidException.class,
            HttpMessageNotReadableException.class,
            HandlerMethodValidationException.class,
            MethodArgumentTypeMismatchException.class,
            ConstraintViolationException.class})
    ResponseEntity<ApiError> handleBadInput(Exception ignored) {
        // 검증 실패한 입력에 인증 정보가 있을 수 있으므로 원래 값은 응답에 포함하지 않는다.
        return error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "요청 입력값을 확인하세요.");
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiError> handleIntegrity(DataIntegrityViolationException exception) {
        if (DatabaseConstraints.isViolation(exception, "uk_member_group_nickname")) {
            return error(HttpStatus.CONFLICT, "NICKNAME_CONFLICT", "그룹에서 이미 사용 중인 닉네임입니다.");
        }
        return handleUnexpected(exception);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiError> handleNotFound(Exception ignored) {
        return error(HttpStatus.NOT_FOUND, "NOT_FOUND", "요청한 리소스가 없습니다.");
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiError> handleMethod(Exception ignored) {
        return error(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "지원하지 않는 HTTP 메서드입니다.");
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ApiError> handleMedia(Exception ignored) {
        return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "JSON 요청을 사용하세요.");
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception ignored) {
        // 예외 내용·SQL 파라미터·인증 헤더·요청 본문을 응답이나 로그에 노출하지 않는다.
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "요청 처리 중 오류가 발생했습니다.");
    }

    private ResponseEntity<ApiError> error(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(new ApiError(status.value(), code, message));
    }
}
