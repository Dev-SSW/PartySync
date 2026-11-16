package github.partysync.account;

import java.time.Instant;
import github.partysync.groupmember.GroupMember;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Entity
@Table(name = "member_session")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MemberSession {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_member_id", nullable = false)
    private GroupMember groupMember;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_session_id", nullable = false)
    private UserSession userSession;
    @Column(name = "token_hash", nullable = false, length = 64, unique = true)
    private String tokenHash;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;
    @Column(name = "revoked_at")
    private Instant revokedAt;

    public MemberSession(GroupMember member, UserSession parent, String hash, Instant now, Instant expiry) {
        groupMember = member; userSession = parent; tokenHash = hash; createdAt = now; expiresAt = expiry;
    }
    public void revoke(Instant now) { if (revokedAt == null) revokedAt = now; }
}
