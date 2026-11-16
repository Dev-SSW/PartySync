package github.partysync.account;

/** 계정 관리 API의 인증 주체. 특정 그룹 권한을 부여하지 않는다. */
public record AccountPrincipal(Long userId, Long userSessionId, String loginId) { }
