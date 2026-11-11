package github.partysync.groupmember.auth;

import java.security.SecureRandom;
import java.util.Base64;

import org.springframework.stereotype.Component;

/**
 * 32바이트 암호학적 난수를 URL-safe Base64로 인코딩
 * 결과는 256비트 엔트로피의 43자 문자열
 */
@Component
public class SecureCodeGenerator {
    private final SecureRandom random = new SecureRandom();

    /**
     * padding 없는 URL-safe 문자열을 생성하며 호출할 때마다 새로운 난수를 사용
     */
    public String generate() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
