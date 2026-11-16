package github.partysync.post;

import java.net.URI;
import github.partysync.groupmember.auth.MemberPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/groups/{groupId}/posts")
public class PostController {
    private final PostService posts;
    public PostController(PostService posts) { this.posts = posts; }

    /** 인증된 멤버의 게시글을 작성한다. */
    @PostMapping
    public ResponseEntity<PostResponses.Created> create(@PathVariable Long groupId, @AuthenticationPrincipal MemberPrincipal principal, @Valid @RequestBody PostRequest request) {
        var created = posts.create(groupId, principal, request);
        return ResponseEntity.created(URI.create("/api/groups/" + groupId + "/posts/" + created.postId())).body(created);
    }
    /** 카테고리 필터를 적용한 최신순 페이지를 조회한다. */
    @GetMapping
    public PostResponses.Page list(@PathVariable Long groupId, @AuthenticationPrincipal MemberPrincipal principal, @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size, @RequestParam(required = false) Long categoryId) { return posts.list(groupId, principal, page, size, categoryId); }
    /** 소속 그룹 게시글 상세를 조회한다. */
    @GetMapping("/{postId}")
    public PostResponses.Details get(@PathVariable Long groupId, @PathVariable Long postId, @AuthenticationPrincipal MemberPrincipal principal) { return posts.get(groupId, postId, principal); }
    /** 작성자가 게시글을 수정한다. */
    @PutMapping("/{postId}")
    public PostResponses.Details update(@PathVariable Long groupId, @PathVariable Long postId, @AuthenticationPrincipal MemberPrincipal principal, @Valid @RequestBody PostRequest request) { return posts.update(groupId, postId, principal, request); }
    /** 작성자 또는 OWNER가 게시글을 삭제한다. */
    @DeleteMapping("/{postId}")
    public ResponseEntity<Void> delete(@PathVariable Long groupId, @PathVariable Long postId, @AuthenticationPrincipal MemberPrincipal principal) { posts.delete(groupId, postId, principal); return ResponseEntity.noContent().build(); }
}
