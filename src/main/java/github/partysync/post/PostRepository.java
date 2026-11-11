package github.partysync.post;

import org.springframework.data.jpa.repository.JpaRepository;


public interface PostRepository extends JpaRepository<Post, Long> {
    /**
     * 특정 그룹의 게시글을 페이지 단위로 조회
     * 그룹 접근 권한은 호출하는 상위 계층에서 검증
     */
    org.springframework.data.domain.Page<Post> findAllByGroupId(Long groupId, org.springframework.data.domain.Pageable pageable);
}
