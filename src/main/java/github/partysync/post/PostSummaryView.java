package github.partysync.post;

import java.time.LocalDateTime;

/** 본문·인증 정보를 가져오지 않는 목록 projection. */
public interface PostSummaryView {
    Long getPostId();
    String getTitle();
    Long getCategoryId();
    String getCategoryName();
    Long getAuthorId();
    String getAuthorNickname();
    LocalDateTime getCreatedAt();
    LocalDateTime getUpdatedAt();
}
