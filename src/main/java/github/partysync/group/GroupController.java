package github.partysync.group;

import java.net.URI;
import java.util.List;

import github.partysync.groupmember.MemberResponse;
import github.partysync.groupmember.auth.MemberPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 그룹 API의 입력 검증과 HTTP 응답을 담당
 * 비즈니스 트랜잭션과 권한 검증은 Service에 위임
 */
@RestController
@RequestMapping("/api/groups")
public class GroupController {
    private final GroupService groups;

    public GroupController(GroupService groups) { this.groups = groups; }

    /**
     * 공개 생성 API
     * 생성된 그룹 주소와 인증 정보의 캐시 금지 헤더를 반환
     */
    @PostMapping
    public ResponseEntity<GroupResponses.Created> create(@Valid @RequestBody GroupRequests.Create request) {
        var response = groups.create(request);
        return ResponseEntity.created(URI.create("/api/groups/" + response.group().groupId()))
                .cacheControl(CacheControl.noStore()).body(response);
    }

    /**
     * 공개 참여 API
     * 인증 토큰을 포함하므로 응답 캐시를 금지
     */
    @PostMapping("/join")
    public ResponseEntity<GroupResponses.Joined> join(@Valid @RequestBody GroupRequests.Join request) {
        var response = groups.join(request);
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore()).body(response);
    }

    /**
     * 인증된 요청자의 그룹 소속은 Service에서 검증
     */
    @GetMapping("/{groupId}")
    public GroupResponses.Details get(@PathVariable @Positive Long groupId,
                                      @AuthenticationPrincipal MemberPrincipal principal) {
        return groups.get(groupId, principal);
    }

    /**
     * 멤버 목록은 인증 정보가 제외된 DTO로 반환
     */
    @GetMapping("/{groupId}/members")
    public List<MemberResponse> members(@PathVariable @Positive Long groupId,
                                        @AuthenticationPrincipal MemberPrincipal principal) {
        return groups.listMembers(groupId, principal);
    }

    /**
     * 초대 정보를 일반 조회와 분리하고 OWNER 권한을 검증
     */
    @GetMapping("/{groupId}/invite")
    public ResponseEntity<GroupResponses.Invite> invite(@PathVariable @Positive Long groupId,
                                                       @AuthenticationPrincipal MemberPrincipal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(groups.invite(groupId, principal));
    }
}
