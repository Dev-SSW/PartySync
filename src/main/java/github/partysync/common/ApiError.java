package github.partysync.common;

/**
 * Controller와 보안 필터의 공통 JSON 오류 응답
 * 내부 예외·SQL·인증 정보를 포함하지 않음
 */
public record ApiError(int status, String code, String message) {
}
