package github.partysync.account;

import jakarta.validation.constraints.*;

public final class AccountRequests {
    private AccountRequests() { }
    public record Credentials(@NotNull @Pattern(regexp = "[a-z0-9][a-z0-9_]{3,31}") String loginId,
                              @NotNull @Size(min = 12, max = 72) String password) {
        public Credentials { loginId = AccountInput.loginId(loginId); }
        @Override public String toString() { return "Credentials[REDACTED]"; }
    }
    public record Claim(@NotNull @Pattern(regexp = "[A-Za-z0-9_-]{43}") String memberAccessToken) {
        @Override public String toString() { return "Claim[REDACTED]"; }
    }
}
