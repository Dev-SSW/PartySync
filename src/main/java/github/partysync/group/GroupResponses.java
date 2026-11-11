package github.partysync.group;

import java.time.LocalDateTime;

import github.partysync.groupmember.MemberResponse;

/**
 * 엔티티와 분리된 그룹 응답 DTO
 * 인증 토큰은 생성·참여 응답에만 포함
 */
public final class GroupResponses {
    private GroupResponses() { }

    /**
     * 일반 그룹 응답
     * 초대 코드와 인증 정보는 제외
     */
    public record Details(Long groupId, String name, String description, long memberCount, LocalDateTime createdAt) {
        static Details from(Group group, long count) {
            return new Details(group.getId(), group.getName(), group.getDescription(), count, group.getCreatedAt());
        }
    }

    /**
     * OWNER에게 초대 코드와 최초 인증 토큰을 전달하는 생성 응답
     */
    public record Created(Details group, String inviteCode, MemberResponse member, String memberAccessToken) {
        @Override public String toString() { return "Created[groupId=" + group.groupId() + ", credentials=REDACTED]"; }
    }

    /**
     * 가입한 MEMBER에게 자신의 최초 인증 토큰을 전달하는 참여 응답
     */
    public record Joined(Details group, MemberResponse member, String memberAccessToken) {
        @Override public String toString() { return "Joined[groupId=" + group.groupId() + ", credentials=REDACTED]"; }
    }

    /**
     * 소속 그룹 OWNER만 조회할 수 있는 초대 정보
     */
    public record Invite(Long groupId, String inviteCode) { }
}
