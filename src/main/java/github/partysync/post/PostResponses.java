package github.partysync.post;

import java.time.LocalDateTime;
import java.util.List;

public final class PostResponses {
    private PostResponses() { }
    public record Created(Long postId) { }
    public record Summary(Long postId, String title, Long categoryId, String categoryName, Long authorId, String authorNickname, LocalDateTime createdAt, LocalDateTime updatedAt) {
        static Summary from(PostSummaryView post) { return new Summary(post.getPostId(), post.getTitle(), post.getCategoryId(), post.getCategoryName(), post.getAuthorId(), post.getAuthorNickname(), post.getCreatedAt(), post.getUpdatedAt()); }
    }
    public record Page(List<Summary> content, int page, int size, long totalElements, int totalPages, boolean hasNext) { }
    public record Details(Long postId, Long groupId, Long categoryId, String categoryName, Long authorId, String authorNickname, String title, String content, LocalDateTime createdAt, LocalDateTime updatedAt) {
        static Details from(Post post) { return new Details(post.getId(), post.getGroup().getId(), post.getGameCategory().getId(), post.getGameCategory().getName(), post.getAuthor().getId(), post.getAuthor().getNickname(), post.getTitle(), post.getContent(), post.getCreatedAt(), post.getUpdatedAt()); }
    }
}
