package github.partysync.group;

import github.partysync.common.TextInput;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 그룹 생성·참여 요청 DTO
 * 문자열 정규화 후 Bean Validation으로 필수값과 길이를 검사
 */
public final class GroupRequests {
    private GroupRequests() { }

    /**
     * 정규화된 그룹명과 생성자 닉네임을 검증하는 생성 요청
     */
    public record Create(@NotBlank @Size(max = 100) String name,
                         @Size(max = 2000) String description,
                         @NotBlank @Size(max = 50) String ownerNickname) {
        public Create {
            name = TextInput.normalize(name);
            description = TextInput.normalize(description);
            ownerNickname = TextInput.normalize(ownerNickname);
        }
    }

    /**
     * 초대 코드는 대소문자를 유지하고 닉네임에는 공통 문자열 정규화를 적용
     */
    public record Join(@NotBlank @Size(max = 128) String inviteCode,
                       @NotBlank @Size(max = 50) String nickname) {
        public Join {
            inviteCode = inviteCode == null ? null : inviteCode.strip();
            nickname = TextInput.normalize(nickname);
        }
    }
}
