package github.partysync.group;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import github.partysync.common.TimestampedEntity;


/**
 * 일정·멤버·게시글을 묶는 최상위 그룹
 * OWNER는 멤버로 관리하고 인원 수는 COUNT로 계산
 */
@Getter
@Entity
@Table(name = "groups", uniqueConstraints = @UniqueConstraint(name = "uk_groups_invite_code", columnNames = "invite_code"))
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Group extends TimestampedEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank
    @Size(max = 100)
    @Column(nullable = false, length = 100)
    private String name;

    @Column(columnDefinition = "text")
    private String description;

    @NotBlank
    @Size(max = 128)
    @Column(name = "invite_code", nullable = false, length = 128, updatable = false)
    private String inviteCode;

    public Group(String name, String description, String inviteCode) {
        this.name = name;
        this.description = description;
        this.inviteCode = inviteCode;
    }
}
