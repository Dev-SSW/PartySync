package github.partysync.common;

import java.text.Normalizer;

/**
 * 앞뒤 공백 제거와 Unicode NFC 정규화로 입력 표현을 통일
 * 대소문자는 변경하지 않음
 */
public final class TextInput {
    private TextInput() { }

    /**
     * null은 보존
     * 공백 제거와 NFC 정규화 후 빈 값·길이 검증은 DTO에서 담당
     */
    public static String normalize(String value) {
        return value == null ? null : Normalizer.normalize(value.strip(), Normalizer.Form.NFC);
    }
}
