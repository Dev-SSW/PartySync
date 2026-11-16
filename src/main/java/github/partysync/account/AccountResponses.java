package github.partysync.account;

import java.time.Instant;
import java.time.LocalDateTime;
import github.partysync.group.GroupResponses;
import github.partysync.groupmember.GroupRole;
import github.partysync.groupmember.MemberResponse;

public final class AccountResponses {
    private AccountResponses() { }
    public record Me(Long userId, String loginId, LocalDateTime createdAt) {
        static Me from(UserAccount user) { return new Me(user.getId(), user.getLoginId(), user.getCreatedAt()); }
    }
    public record SignedIn(Me user, String accountAccessToken, Instant expiresAt) {
        @Override public String toString() { return "SignedIn[REDACTED]"; }
    }
    public record Group(Long groupId, String groupName, Long memberId, String nickname, GroupRole role, LocalDateTime joinedAt) { }
    public record Membership(GroupResponses.Details group, MemberResponse member, String memberAccessToken, Instant expiresAt) {
        @Override public String toString() { return "Membership[REDACTED]"; }
    }
}
