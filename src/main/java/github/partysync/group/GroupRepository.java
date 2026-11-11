package github.partysync.group;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 그룹을 저장하고 초대 코드로 조회
 * 조회 실패 시의 HTTP 오류는 Service에서 결정
 */
public interface GroupRepository extends JpaRepository<Group, Long> {
    Optional<Group> findByInviteCode(String inviteCode);
}
