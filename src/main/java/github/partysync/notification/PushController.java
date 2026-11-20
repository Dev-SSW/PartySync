package github.partysync.notification;

import github.partysync.groupmember.auth.MemberPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/members/me/push")
public class PushController {
    private final PushSubscriptions subscriptions;
    public PushController(PushSubscriptions subscriptions) { this.subscriptions = subscriptions; }
    public record Subscription(@NotBlank @Size(max=2048) String endpoint, @Valid Keys keys) {
        @Override public String toString() { return "Subscription[REDACTED]"; }
    }
    public record Keys(@NotBlank @Size(max=128) String p256dh, @NotBlank @Size(max=64) String auth) {
        @Override public String toString() { return "Keys[REDACTED]"; }
    }
    public record Endpoint(@NotBlank @Size(max=2048) String endpoint) {
        @Override public String toString() { return "Endpoint[REDACTED]"; }
    }
    public record Status(boolean subscribed) { }

    @GetMapping("/configuration")
    public PushSubscriptions.Configuration configuration() { return subscriptions.configuration(); }
    @PostMapping("/status")
    public Status status(@AuthenticationPrincipal MemberPrincipal member, @Valid @RequestBody Endpoint request) {
        return new Status(subscriptions.subscribed(member, request.endpoint()));
    }
    @PutMapping("/subscription")
    public ResponseEntity<Void> subscribe(@AuthenticationPrincipal MemberPrincipal member, @RequestHeader("Authorization") String authorization, @Valid @RequestBody Subscription request) {
        if (request.keys() == null) throw new github.partysync.common.ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_PUSH_SUBSCRIPTION", "알림 구독 정보를 확인하세요.");
        subscriptions.subscribe(member, authorization.substring(7), request.endpoint(), request.keys().p256dh(), request.keys().auth());
        return ResponseEntity.noContent().build();
    }
    @DeleteMapping("/subscription")
    public ResponseEntity<Void> unsubscribe(@AuthenticationPrincipal MemberPrincipal member, @Valid @RequestBody Endpoint request) {
        subscriptions.unsubscribe(member, request.endpoint());
        return ResponseEntity.noContent().build();
    }
}
