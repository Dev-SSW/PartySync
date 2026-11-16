package github.partysync.category;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface GameCategoryRepository extends JpaRepository<GameCategory, Long> {
    /** 그룹에 속한 카테고리만 조회한다. */
    java.util.Optional<GameCategory> findByIdAndGroupId(Long id, Long groupId);

    /** 생성 순서로 그룹 카테고리를 조회한다. */
    List<GameCategory> findAllByGroupIdOrderByIdAsc(Long groupId);

    /** 같은 그룹에서 다른 카테고리가 이름을 사용 중인지 확인한다. */
    boolean existsByGroupIdAndNameAndIdNot(Long groupId, String name, Long id);
    /**
     * 특정 그룹이 사용하는 카테고리 목록을 조회
     */
    List<GameCategory> findAllByGroupId(Long groupId);
}
