package github.partysync.notification;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.Security;
import java.time.Duration;
import nl.martijndwars.webpush.Encoding;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** 라이브러리의 암호화·VAPID 서명을 사용하고 HTTPS 전송에는 시간 제한을 적용한다. */
@Component
public class PushGateway {
    private final String publicKey;
    private final PreparedPushService service;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER).build();

    public PushGateway(@Value("${app.push.public-key:}") String publicKey,
                       @Value("${app.push.private-key:}") String privateKey,
                       @Value("${app.push.subject:}") String subject) {
        Security.addProvider(new BouncyCastleProvider());
        this.publicKey = publicKey;
        if (publicKey.isBlank() && privateKey.isBlank() && subject.isBlank()) { service = null; return; }
        if (publicKey.isBlank() || privateKey.isBlank() || !(subject.startsWith("mailto:") || subject.startsWith("https://")))
            throw new IllegalArgumentException("Configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT together");
        try {
            service = new PreparedPushService(publicKey, privateKey, subject);
            if (!nl.martijndwars.webpush.Utils.verifyKeyPair(service.getPrivateKey(), service.getPublicKey()))
                throw new IllegalArgumentException();
        }
        catch (Exception invalid) { throw new IllegalArgumentException("Invalid VAPID key configuration"); }
    }

    public boolean enabled() { return service != null; }
    public String publicKey() { return enabled() ? publicKey : ""; }

    public int send(String endpoint, String p256dh, String auth, String payload) throws Exception {
        var prepared = prepare(endpoint, p256dh, auth, payload);
        var request = HttpRequest.newBuilder(URI.create(prepared.getUrl())).timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofByteArray(prepared.getBody()));
        prepared.getHeaders().forEach(request::header);
        return client.send(request.build(), HttpResponse.BodyHandlers.discarding()).statusCode();
    }

    nl.martijndwars.webpush.HttpRequest prepare(String endpoint, String p256dh, String auth, String payload) throws Exception {
        if (!enabled()) throw new IllegalStateException("Web Push is disabled");
        PushEndpoint.validate(endpoint);
        var notification = new Notification(endpoint, p256dh, auth, payload.getBytes(StandardCharsets.UTF_8), 3600);
        return service.prepare(notification);
    }

    private static class PreparedPushService extends PushService {
        PreparedPushService(String publicKey, String privateKey, String subject) throws java.security.GeneralSecurityException {
            super(publicKey, privateKey, subject);
        }
        nl.martijndwars.webpush.HttpRequest prepare(Notification notification) throws Exception {
            return prepareRequest(notification, Encoding.AES128GCM);
        }
    }
}
