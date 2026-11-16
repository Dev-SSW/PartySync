package github.partysync.post;

import github.partysync.common.TextInput;
import jakarta.validation.constraints.*;

public record PostRequest(@NotNull @Positive Long categoryId, @NotBlank @Size(max = 200) String title, @NotBlank @Size(max = 20000) String content) {
    public PostRequest {
        title = TextInput.normalize(title);
        content = TextInput.normalize(content);
    }
}
