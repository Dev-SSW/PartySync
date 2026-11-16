package github.partysync.account;

import github.partysync.common.TimestampedEntity;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Entity
@Table(name = "user_account", uniqueConstraints = @UniqueConstraint(name = "uk_user_login_id", columnNames = "login_id"))
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserAccount extends TimestampedEntity {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "login_id", nullable = false, length = 32)
    private String loginId;
    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    public UserAccount(String loginId, String passwordHash) {
        this.loginId = loginId;
        this.passwordHash = passwordHash;
    }
}
