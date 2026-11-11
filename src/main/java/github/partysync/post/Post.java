package github.partysync.post;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import github.partysync.common.TimestampedEntity;
import github.partysync.group.Group;
import github.partysync.groupmember.GroupMember;
import github.partysync.category.GameCategory;

/**
 * 그룹 카테고리에 속하는 공략·정보 게시글
 * 작성자·카테고리의 그룹 일치는 DB 복합 외래키가 보장
 */
@Getter
@Entity
@Table(name = "post")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Post extends TimestampedEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_id", nullable = false)
    private Group group;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "game_category_id", nullable = false)
    private GameCategory gameCategory;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "author_id", nullable = false)
    private GroupMember author;

    @NotBlank
    @Size(max = 200)
    @Column(nullable = false, length = 200)
    private String title;

    @Column(columnDefinition = "text")
    private String content;

    public Post(Group group, GameCategory gameCategory, GroupMember author, String title, String content) {
        this.group = java.util.Objects.requireNonNull(group);
        this.gameCategory = java.util.Objects.requireNonNull(gameCategory);
        this.author = java.util.Objects.requireNonNull(author);
        this.title = title;
        this.content = content;
    }
}
