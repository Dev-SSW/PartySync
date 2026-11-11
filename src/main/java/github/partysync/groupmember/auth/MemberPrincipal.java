package github.partysync.groupmember.auth;

import github.partysync.groupmember.GroupRole;

/**
 * 인증된 요청자의 멤버 ID·그룹 ID·닉네임·역할
 * 토큰 원문이나 해시는 보관하지 않음
 */
public record MemberPrincipal(Long groupMemberId, Long groupId, String nickname, GroupRole role) {
}
