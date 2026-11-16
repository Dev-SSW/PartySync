package github.partysync.account;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import github.partysync.common.ApiException;
import org.springframework.http.HttpStatus;

public final class AccountInput {
    private AccountInput() { }
    public static String loginId(String raw) {
        return raw == null ? null : raw.strip().toLowerCase(Locale.ROOT);
    }
    /** 비밀번호 공백·Unicode를 임의 변환하지 않으며 BCrypt의 바이트 상한을 지킨다. */
    public static void validatePassword(String password) {
        if (password == null || password.isBlank() || password.length() < 12 || password.indexOf('\0') >= 0 || password.getBytes(StandardCharsets.UTF_8).length > 72)
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PASSWORD", "비밀번호는 12자 이상, UTF-8 72바이트 이하여야 합니다.");
    }
}
