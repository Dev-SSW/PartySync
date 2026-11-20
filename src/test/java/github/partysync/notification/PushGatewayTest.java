package github.partysync.notification;

import java.math.BigInteger;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class PushGatewayTest {
    private record Keys(String publicKey, String privateKey) { }
    private static Keys keys() throws Exception {
        var generator=KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        var pair=generator.generateKeyPair();
        var point=((ECPublicKey)pair.getPublic()).getW();
        byte[] raw=new byte[65]; raw[0]=4;
        System.arraycopy(scalar(point.getAffineX()),0,raw,1,32);
        System.arraycopy(scalar(point.getAffineY()),0,raw,33,32);
        var encoder=Base64.getUrlEncoder().withoutPadding();
        return new Keys(encoder.encodeToString(raw),encoder.encodeToString(scalar(((ECPrivateKey)pair.getPrivate()).getS())));
    }
    private static byte[] scalar(BigInteger number) {
        byte[] signed=number.toByteArray(), unsigned=new byte[32];
        int length=Math.min(32,signed.length);
        System.arraycopy(signed,signed.length-length,unsigned,32-length,length);
        return unsigned;
    }

    @Test void encryptsPayloadAndSignsVapidWithoutMakingNetworkRequests() throws Exception {
        var server=keys(); var receiver=keys();
        var gateway=new PushGateway(server.publicKey(),server.privateKey(),"mailto:test@example.com");
        var prepared=gateway.prepare("https://fcm.googleapis.com/fcm/send/device",receiver.publicKey(),Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[16]),"{\"body\":\"private schedule\"}");
        assertThat(prepared.getHeaders()).containsEntry("Content-Encoding","aes128gcm").containsEntry("TTL","3600");
        assertThat(prepared.getHeaders().get("Authorization")).startsWith("vapid t=").contains("k="+server.publicKey()).doesNotContain(server.privateKey());
        assertThat(prepared.getBody()).isNotEmpty();
        assertThat(new String(prepared.getBody(),java.nio.charset.StandardCharsets.UTF_8)).doesNotContain("private schedule");
        assertThat(prepared.getUrl()).startsWith("https://fcm.googleapis.com/wp/");
    }
    @Test void disabledAndMisconfiguredKeysDoNotExposeSecrets() throws Exception {
        assertThat(new PushGateway("","","").enabled()).isFalse();
        var a=keys(); var b=keys();
        assertThatThrownBy(() -> new PushGateway(a.publicKey(),b.privateKey(),"mailto:test@example.com"))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("Invalid VAPID key configuration");
        assertThatThrownBy(() -> new PushGateway(a.publicKey(),"",""))
                .isInstanceOf(IllegalArgumentException.class).hasMessageNotContaining(a.publicKey());
    }
}
