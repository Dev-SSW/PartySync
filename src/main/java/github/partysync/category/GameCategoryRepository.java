package github.partysync.category;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface GameCategoryRepository extends JpaRepository<GameCategory, Long> {
    /**
     * 특정 그룹이 사용하는 카테고리 목록을 조회
     */
    List<GameCategory> findAllByGroupId(Long groupId);
}
