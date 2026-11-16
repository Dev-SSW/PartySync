package github.partysync.category;

import java.net.URI;
import java.util.List;
import github.partysync.groupmember.auth.MemberPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/groups/{groupId}/categories")
public class CategoryController {
    private final CategoryService categories;
    public CategoryController(CategoryService categories) { this.categories = categories; }

    /** 소속 그룹의 카테고리를 조회한다. */
    @GetMapping
    public List<CategoryResponse> list(@PathVariable Long groupId, @AuthenticationPrincipal MemberPrincipal principal) { return categories.list(groupId, principal); }

    /** OWNER가 카테고리를 생성한다. */
    @PostMapping
    public ResponseEntity<CategoryResponse> create(@PathVariable Long groupId, @AuthenticationPrincipal MemberPrincipal principal, @Valid @RequestBody CategoryRequest request) {
        var response = categories.create(groupId, principal, request);
        return ResponseEntity.created(URI.create("/api/groups/" + groupId + "/categories/" + response.categoryId())).body(response);
    }

    /** OWNER가 카테고리를 수정한다. */
    @PutMapping("/{categoryId}")
    public CategoryResponse update(@PathVariable Long groupId, @PathVariable Long categoryId, @AuthenticationPrincipal MemberPrincipal principal, @Valid @RequestBody CategoryRequest request) { return categories.update(groupId, categoryId, principal, request); }

    /** OWNER가 비어 있는 카테고리를 삭제한다. */
    @DeleteMapping("/{categoryId}")
    public ResponseEntity<Void> delete(@PathVariable Long groupId, @PathVariable Long categoryId, @AuthenticationPrincipal MemberPrincipal principal) { categories.delete(groupId, categoryId, principal); return ResponseEntity.noContent().build(); }
}
