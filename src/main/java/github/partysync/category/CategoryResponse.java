package github.partysync.category;

import java.time.LocalDateTime;

public record CategoryResponse(Long categoryId, String name, String description, LocalDateTime createdAt) {
    static CategoryResponse from(GameCategory category) {
        return new CategoryResponse(category.getId(), category.getName(), category.getDescription(), category.getCreatedAt());
    }
}
