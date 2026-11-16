package github.partysync.post;

import org.springframework.data.jpa.repository.JpaRepository;


public interface PostRepository extends JpaRepository<Post, Long> {
    /** 카테고리 삭제 전 사용 여부를 확인한다. 최종 방어는 DB FK가 담당한다. */
    boolean existsByGameCategoryId(Long categoryId);

    /** 상세·수정·삭제에 필요한 공개 연관정보를 한 번에 조회한다. */
    @org.springframework.data.jpa.repository.Query("select p from Post p join fetch p.gameCategory join fetch p.author where p.id = :id and p.group.id = :groupId")
    java.util.Optional<Post> findDetails(@org.springframework.data.repository.query.Param("id") Long id,
                                       @org.springframework.data.repository.query.Param("groupId") Long groupId);

    /** 본문을 제외하고 작성자·카테고리 정보를 JOIN하여 페이지 조회한다. */
    @org.springframework.data.jpa.repository.Query(value = """
            select p.id as postId, p.title as title, c.id as categoryId, c.name as categoryName,
                   a.id as authorId, a.nickname as authorNickname, p.createdAt as createdAt, p.updatedAt as updatedAt
            from Post p join p.gameCategory c join p.author a
            where p.group.id = :groupId and (:categoryId is null or c.id = :categoryId)
            """, countQuery = "select count(p) from Post p where p.group.id = :groupId and (:categoryId is null or p.gameCategory.id = :categoryId)")
    org.springframework.data.domain.Page<PostSummaryView> findSummaries(
            @org.springframework.data.repository.query.Param("groupId") Long groupId,
            @org.springframework.data.repository.query.Param("categoryId") Long categoryId,
            org.springframework.data.domain.Pageable pageable);
    /**
     * 특정 그룹의 게시글을 페이지 단위로 조회
     * 그룹 접근 권한은 호출하는 상위 계층에서 검증
     */
    org.springframework.data.domain.Page<Post> findAllByGroupId(Long groupId, org.springframework.data.domain.Pageable pageable);
}
