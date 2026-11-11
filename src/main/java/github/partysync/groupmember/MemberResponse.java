package github.partysync.groupmember;

import java.time.LocalDateTime;

import github.partysync.groupmember.auth.MemberPrincipal;

/**
 * 외부에 공개할 멤버 정보만 담음
 * 토큰 원문과 해시는 포함하지 않음
 */
public record MemberResponse(Long memberId, String nickname, GroupRole role, LocalDateTime joinedAt) {
    public static MemberResponse from(GroupMember member) {
        return new MemberResponse(member.getId(), member.getNickname(), member.getRole(), member.getJoinedAt());
    }

    /**
     * 토큰으로 확인한 현재 멤버의 그룹 ID도 포함하는 내 정보 응답
     */
    public record Me(Long memberId, Long groupId, String nickname, GroupRole role) {
        public static Me from(MemberPrincipal principal) {
            return new Me(principal.groupMemberId(), principal.groupId(), principal.nickname(), principal.role());
        }
    }
}
