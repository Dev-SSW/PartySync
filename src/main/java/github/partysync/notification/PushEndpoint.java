package github.partysync.notification;

import java.net.URI;
import java.util.Base64;
import github.partysync.common.ApiException;
import org.springframework.http.HttpStatus;

/** 클라이언트가 제공한 주소로 내부 서버에 요청하는 것을 방지한다. */
public final class PushEndpoint {
    private PushEndpoint() { }

    public static void validate(String endpoint) {
        try {
            URI uri = URI.create(endpoint);
            String host = uri.getHost();
            boolean trusted = "fcm.googleapis.com".equals(host) || "updates.push.services.mozilla.com".equals(host)
                    || (host != null && (host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com")));
            if (endpoint.length() > 2048 || !"https".equals(uri.getScheme()) || !trusted || uri.getRawUserInfo() != null
                    || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getRawFragment() != null
                    || uri.getRawPath() == null || uri.getRawPath().length() < 2) throw new IllegalArgumentException();
        } catch (IllegalArgumentException | NullPointerException invalid) { throw invalid(); }
    }

    public static void validateKeys(String p256dh, String auth) {
        try {
            if (p256dh == null || auth == null || !p256dh.matches("[A-Za-z0-9_-]{87}={0,1}") || !auth.matches("[A-Za-z0-9_-]{22}={0,2}")) throw new IllegalArgumentException();
            byte[] key = Base64.getUrlDecoder().decode(p256dh);
            if (key.length != 65 || key[0] != 4 || Base64.getUrlDecoder().decode(auth).length != 16) throw new IllegalArgumentException();
        } catch (IllegalArgumentException invalid) { throw invalid(); }
    }

    private static ApiException invalid() { return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PUSH_SUBSCRIPTION", "알림 구독 정보를 확인하세요."); }
}
