package github.partysync.groupmember.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

/**
 * 고엔트로피 멤버 토큰을 발급하고 SHA-256 해시로 변환
 * 원문은 최초 응답에만 사용
 */
@Service
public class MemberTokenService {
    private static final Pattern TOKEN_FORMAT = Pattern.compile("[A-Za-z0-9_-]{43}");
    private final SecureCodeGenerator codes;

    public MemberTokenService(SecureCodeGenerator codes) {
        this.codes = codes;
    }

    /**
     * 최초 응답용 원문과 DB 저장용 해시를 분리해 생성
     */
    public IssuedToken issue() {
        String raw = codes.generate();
        return new IssuedToken(raw, hash(raw));
    }

    /**
     * DB 조회 전에 URL-safe 문자 집합과 43자 고정 길이를 검사
     */
    public boolean hasValidFormat(String raw) {
        return raw != null && TOKEN_FORMAT.matcher(raw).matches();
    }

    /**
     * 동일 토큰에서 동일한 64자 소문자 hex 해시를 만들어 DB 검색에 사용
     */
    public String hash(String raw) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable");
        }
    }

    /**
     * 원문과 저장용 해시를 전달하는 내부 객체
     * toString은 비밀 값이 로그에 섞이지 않도록 숨김
     */
    public record IssuedToken(String raw, String hash) {
        @Override
        public String toString() { return "IssuedToken[REDACTED]"; }
    }
}
