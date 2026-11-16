package github.partysync.account;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserAccountRepository extends JpaRepository<UserAccount, Long> {
    /** 정규화된 로그인 ID로 계정을 조회한다. */
    Optional<UserAccount> findByLoginId(String loginId);
}
