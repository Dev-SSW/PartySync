package github.partysync.groupmember.auth;

import java.util.Optional;

import github.partysync.groupmember.GroupMemberRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 토큰 형식을 확인하고 해시로 요청자를 조회
 * 인증 실패는 빈 결과로 반환
 */
@Service
public class MemberAuthenticationService {
    private final MemberTokenService tokens;
    private final GroupMemberRepository members;
    private final github.partysync.account.MemberSessionRepository sessions;
    private final java.time.Clock clock;

    public MemberAuthenticationService(MemberTokenService tokens, GroupMemberRepository members,
                                       github.partysync.account.MemberSessionRepository sessions, java.time.Clock clock) {
        this.tokens = tokens;
        this.members = members;
        this.sessions = sessions;
        this.clock = clock;
    }

    /**
     * 올바른 형식의 토큰만 해시로 변환하고 UNIQUE 인덱스로 필요한 인증 정보를 조회
     */
    @Transactional(readOnly = true)
    public Optional<MemberPrincipal> authenticate(String raw) {
        if (raw != null && raw.startsWith("m_") && tokens.hasValidFormat(raw.substring(2))) {
            return sessions.authenticate(tokens.hash(raw), clock.instant());
        }
        if (!tokens.hasValidFormat(raw)) {
            return Optional.empty();
        }
        return members.findPrincipalByTokenHash(tokens.hash(raw));
    }
}
