package github.partysync.groupmember.auth;

import java.io.IOException;

import github.partysync.common.ApiError;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * ControllerAdvice에 도달하지 않는 보안 필터·CORS 오류를 공통 JSON 형식으로 직접 작성
 */
@Component
public class SecurityErrorWriter {
    private final ObjectMapper mapper;

    public SecurityErrorWriter(ObjectMapper mapper) { this.mapper = mapper; }

    /**
     * 기본 CORS 텍스트 오류 대신 공통 형식의 JSON 403을 반환
     */
    public void rejectCors(ServerHttpResponse response) throws IOException {
        response.setStatusCode(HttpStatus.FORBIDDEN);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        response.getHeaders().setCacheControl("no-store");
        mapper.writeValue(response.getBody(), new ApiError(403, "FORBIDDEN", "접근 권한이 없습니다."));
        response.flush();
    }

    /**
     * 401에는 Bearer 인증 안내 헤더를 추가하고 내부 인증 실패 원인은 숨김
     */
    public void write(HttpServletResponse response, int status) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        if (status == 401) {
            response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
        }
        String code = status == 401 ? "UNAUTHORIZED" : status == 403 ? "FORBIDDEN" : "INTERNAL_ERROR";
        String message = status == 401 ? "유효한 멤버 인증이 필요합니다." : status == 403 ? "접근 권한이 없습니다." : "요청 처리 중 오류가 발생했습니다.";
        mapper.writeValue(response.getOutputStream(), new ApiError(status, code, message));
    }
}
