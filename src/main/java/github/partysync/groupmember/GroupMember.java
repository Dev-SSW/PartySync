package github.partysync.groupmember;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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

import github.partysync.group.Group;
import java.time.LocalDateTime;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

/**
 * 특정 그룹에 참여한 멤버
 * 닉네임은 그룹 안에서 고유하며 인증 토큰은 원문 대신 해시만 저장
 */
@Getter
@Entity
@Table(name = "group_member", uniqueConstraints = {
        @UniqueConstraint(name = "uk_member_group_nickname", columnNames = {"group_id", "nickname"}),
        @UniqueConstraint(name = "uk_member_token_hash", columnNames = "access_token_hash"),
        @UniqueConstraint(name = "uk_member_id_group", columnNames = {"id", "group_id"})})
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@EntityListeners(AuditingEntityListener.class)
public class GroupMember {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_id", nullable = false)
    private Group group;

    @NotBlank
    @Size(max = 50)
    @Column(nullable = false, length = 50)
    private String nickname;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private GroupRole role;

    @NotBlank
    @Size(max = 255)
    @Column(name = "access_token_hash", nullable = false, length = 255)
    private String accessTokenHash;

    @CreatedDate
    @Column(name = "joined_at", nullable = false, updatable = false)
    private LocalDateTime joinedAt;

    public GroupMember(Group group, String nickname, GroupRole role, String accessTokenHash) {
        this.group = java.util.Objects.requireNonNull(group);
        this.nickname = nickname;
        this.role = java.util.Objects.requireNonNull(role);
        this.accessTokenHash = accessTokenHash;
    }
}
