package github.partysync.category;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import github.partysync.common.CreatedEntity;
import github.partysync.group.Group;

/**
 * 그룹 안의 단일 단계 게시글 분류
 * 이름은 같은 그룹 안에서만 고유함
 */
@Getter
@Entity
@Table(name = "game_category", uniqueConstraints = {
        @UniqueConstraint(name = "uk_category_group_name", columnNames = {"group_id", "name"}),
        @UniqueConstraint(name = "uk_category_id_group", columnNames = {"id", "group_id"})})
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class GameCategory extends CreatedEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_id", nullable = false)
    private Group group;

    @NotBlank
    @Size(max = 100)
    @Column(nullable = false, length = 100)
    private String name;

    @Column(columnDefinition = "text")
    private String description;

    public GameCategory(Group group, String name, String description) {
        this.group = java.util.Objects.requireNonNull(group);
        this.name = name;
        this.description = description;
    }
}
