package github.partysync.category;

import github.partysync.common.TextInput;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CategoryRequest(@NotBlank @Size(max = 100) String name, @Size(max = 2000) String description) {
    public CategoryRequest {
        name = TextInput.normalize(name);
        description = TextInput.normalize(description);
    }
}
