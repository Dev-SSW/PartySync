package github.partysync.post;

import github.partysync.category.GameCategory;
import github.partysync.category.GameCategoryRepository;
import github.partysync.common.ApiException;
import github.partysync.group.GroupService;
import github.partysync.groupmember.GroupMemberRepository;
import github.partysync.groupmember.GroupRole;
import github.partysync.groupmember.auth.MemberPrincipal;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PostService {
    private final GroupService groups;
    private final GameCategoryRepository categories;
    private final GroupMemberRepository members;
    private final PostRepository posts;
    public PostService(GroupService groups, GameCategoryRepository categories, GroupMemberRepository members, PostRepository posts) {
        this.groups = groups; this.categories = categories; this.members = members; this.posts = posts;
    }

    /** 토큰의 멤버를 작성자로 지정해 게시글을 생성한다. */
    @Transactional
    public PostResponses.Created create(Long groupId, MemberPrincipal principal, PostRequest request) {
        var group = groups.requireGroupMember(groupId, principal);
        var category = requireCategory(groupId, request.categoryId());
        // 작성자는 요청 필드가 아니라 인증 주체에서만 결정한다.
        var author = members.getReferenceById(principal.groupMemberId());
        var post = posts.saveAndFlush(new Post(group, category, author, request.title(), request.content()));
        return new PostResponses.Created(post.getId());
    }

    /** 본문을 제외한 최신순 목록을 카테고리 조건과 함께 페이지 조회한다. */
    @Transactional(readOnly = true)
    public PostResponses.Page list(Long groupId, MemberPrincipal principal, int page, int size, Long categoryId) {
        groups.requireGroupMember(groupId, principal);
        if (page < 0 || size < 1 || size > 50 || (long) page * size > Integer.MAX_VALUE || (categoryId != null && categoryId < 1)) throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "페이지와 조회 개수를 확인하세요.");
        if (categoryId != null) requireCategory(groupId, categoryId);
        var result = posts.findSummaries(groupId, categoryId, PageRequest.of(page, size, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
        return new PostResponses.Page(result.getContent().stream().map(PostResponses.Summary::from).toList(), page, size, result.getTotalElements(), result.getTotalPages(), result.hasNext());
    }

    /** 그룹 경계를 포함해 상세를 조회한다. */
    @Transactional(readOnly = true)
    public PostResponses.Details get(Long groupId, Long postId, MemberPrincipal principal) {
        groups.requireGroupMember(groupId, principal);
        return PostResponses.Details.from(requirePost(groupId, postId));
    }

    /** 작성자만 분류·제목·본문을 수정한다. */
    @Transactional
    public PostResponses.Details update(Long groupId, Long postId, MemberPrincipal principal, PostRequest request) {
        groups.requireGroupMember(groupId, principal);
        Post post = requirePost(groupId, postId);
        if (!post.getAuthor().getId().equals(principal.groupMemberId())) throw forbidden();
        // 권한을 먼저 검사한 뒤 대상 카테고리를 확인한다.
        post.update(requireCategory(groupId, request.categoryId()), request.title(), request.content());
        posts.flush();
        return PostResponses.Details.from(post);
    }

    /** 작성자 또는 소속 그룹 OWNER가 삭제한다. */
    @Transactional
    public void delete(Long groupId, Long postId, MemberPrincipal principal) {
        groups.requireGroupMember(groupId, principal);
        Post post = requirePost(groupId, postId);
        if (!post.getAuthor().getId().equals(principal.groupMemberId()) && principal.role() != GroupRole.OWNER) throw forbidden();
        posts.delete(post);
        posts.flush();
    }

    private Post requirePost(Long groupId, Long postId) {
        return posts.findDetails(postId, groupId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다."));
    }
    private GameCategory requireCategory(Long groupId, Long categoryId) {
        return categories.findByIdAndGroupId(categoryId, groupId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CATEGORY_NOT_FOUND", "카테고리를 찾을 수 없습니다."));
    }
    private ApiException forbidden() { return new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "접근 권한이 없습니다."); }
}
