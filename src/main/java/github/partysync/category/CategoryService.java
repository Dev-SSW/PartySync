package github.partysync.category;

import java.util.List;
import github.partysync.common.ApiException;
import github.partysync.group.Group;
import github.partysync.group.GroupService;
import github.partysync.groupmember.GroupRole;
import github.partysync.groupmember.auth.MemberPrincipal;
import github.partysync.post.PostRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CategoryService {
    private final GroupService groups;
    private final GameCategoryRepository categories;
    private final PostRepository posts;

    public CategoryService(GroupService groups, GameCategoryRepository categories, PostRepository posts) {
        this.groups = groups; this.categories = categories; this.posts = posts;
    }

    /** 소속 그룹의 카테고리를 생성 순서로 조회한다. */
    @Transactional(readOnly = true)
    public List<CategoryResponse> list(Long groupId, MemberPrincipal principal) {
        groups.requireGroupMember(groupId, principal);
        return categories.findAllByGroupIdOrderByIdAsc(groupId).stream().map(CategoryResponse::from).toList();
    }

    /** OWNER가 그룹 카테고리를 생성한다. */
    @Transactional
    public CategoryResponse create(Long groupId, MemberPrincipal principal, CategoryRequest request) {
        Group group = requireOwner(groupId, principal);
        checkName(groupId, request.name(), -1L);
        // 사전 검사 이후 동시 생성은 기존 UNIQUE 제약조건으로 방어한다.
        return CategoryResponse.from(categories.saveAndFlush(new GameCategory(group, request.name(), request.description())));
    }

    /** OWNER가 이름·설명만 수정한다. 연결된 게시글은 유지한다. */
    @Transactional
    public CategoryResponse update(Long groupId, Long categoryId, MemberPrincipal principal, CategoryRequest request) {
        requireOwner(groupId, principal);
        GameCategory category = requireCategory(groupId, categoryId);
        checkName(groupId, request.name(), categoryId);
        category.update(request.name(), request.description());
        categories.flush();
        return CategoryResponse.from(category);
    }

    /** OWNER가 게시글이 없는 카테고리를 삭제한다. */
    @Transactional
    public void delete(Long groupId, Long categoryId, MemberPrincipal principal) {
        requireOwner(groupId, principal);
        GameCategory category = requireCategory(groupId, categoryId);
        if (posts.existsByGameCategoryId(categoryId)) throw new ApiException(HttpStatus.CONFLICT, "CATEGORY_IN_USE", "게시글을 먼저 정리해 주세요.");
        // 검사 직후 게시글이 생겨도 FK의 NO ACTION 정책이 삭제·유실을 막는다.
        categories.delete(category);
        categories.flush();
    }

    private Group requireOwner(Long groupId, MemberPrincipal principal) {
        Group group = groups.requireGroupMember(groupId, principal);
        if (principal.role() != GroupRole.OWNER) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "접근 권한이 없습니다.");
        return group;
    }

    private GameCategory requireCategory(Long groupId, Long categoryId) {
        return categories.findByIdAndGroupId(categoryId, groupId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CATEGORY_NOT_FOUND", "카테고리를 찾을 수 없습니다."));
    }

    private void checkName(Long groupId, String name, Long exceptId) {
        if (categories.existsByGroupIdAndNameAndIdNot(groupId, name, exceptId)) throw new ApiException(HttpStatus.CONFLICT, "CATEGORY_NAME_CONFLICT", "이미 사용 중인 카테고리 이름입니다.");
    }
}
