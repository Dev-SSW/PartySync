package github.partysync.groupmember.auth;

import java.util.Base64;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 256비트 토큰 형식과 문자열 마스킹, SHA-256 표준 벡터를 DB 없이 검증한다.
 */
class MemberTokenServiceTest {
    private final MemberTokenService tokens = new MemberTokenService(new SecureCodeGenerator());

    @Test
    void issues256BitUrlSafeTokensAndKeepsCredentialsOutOfToString() {
        var first = tokens.issue();
        var second = tokens.issue();
        assertThat(Base64.getUrlDecoder().decode(first.raw())).hasSize(32);
        assertThat(tokens.hasValidFormat(first.raw())).isTrue();
        assertThat(first.raw()).isNotEqualTo(second.raw());
        assertThat(first.hash()).hasSize(64).isEqualTo(tokens.hash(first.raw())).isNotEqualTo(first.raw());
        assertThat(first.toString()).doesNotContain(first.raw(), first.hash());
    }

    @Test
    void sha256MatchesKnownVectorAndRejectsInvalidFormats() {
        assertThat(tokens.hash("abc")).isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assertThat(tokens.hasValidFormat(null)).isFalse();
        assertThat(tokens.hasValidFormat("")).isFalse();
        assertThat(tokens.hasValidFormat("x".repeat(42))).isFalse();
        assertThat(tokens.hasValidFormat("x".repeat(44))).isFalse();
        assertThat(tokens.hasValidFormat("/".repeat(43))).isFalse();
    }
}
