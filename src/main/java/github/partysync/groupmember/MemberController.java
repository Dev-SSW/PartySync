package github.partysync.groupmember;

import github.partysync.groupmember.auth.MemberPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 토큰으로 인증된 현재 멤버의 정보를 제공
 * 클라이언트가 전달한 멤버 ID를 신뢰하지 않음
 */
@RestController
@RequestMapping("/api/members")
public class MemberController {
    /**
     * 임의의 멤버 ID 대신 인증이 완료된 Principal을 사용
     */
    @GetMapping("/me")
    public MemberResponse.Me me(@AuthenticationPrincipal MemberPrincipal principal) {
        return MemberResponse.Me.from(principal);
    }
}
