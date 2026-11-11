package github.partysync.group;

import java.util.List;

import github.partysync.common.ApiException;
import github.partysync.common.DatabaseConstraints;
import github.partysync.groupmember.GroupMember;
import github.partysync.groupmember.GroupMemberRepository;
import github.partysync.groupmember.GroupRole;
import github.partysync.groupmember.MemberResponse;
import github.partysync.groupmember.auth.MemberPrincipal;
import github.partysync.groupmember.auth.MemberTokenService;
import github.partysync.groupmember.auth.SecureCodeGenerator;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 그룹 생성·참여의 원자성과 그룹 조회 권한을 보장
 * 난수 충돌은 새 트랜잭션에서 재시도
 */
@Service
public class GroupService {
    private static final int MAX_ATTEMPTS = 3;
    private final GroupRepository groups;
    private final GroupMemberRepository members;
    private final SecureCodeGenerator codes;
    private final MemberTokenService tokens;
    private final TransactionTemplate writes;

    public GroupService(GroupRepository groups, GroupMemberRepository members, SecureCodeGenerator codes,
                        MemberTokenService tokens, PlatformTransactionManager transactionManager) {
        this.groups = groups;
        this.members = members;
        this.codes = codes;
        this.tokens = tokens;
        writes = new TransactionTemplate(transactionManager);
        // UNIQUE 위반으로 실패한 PostgreSQL 트랜잭션은 재사용할 수 없으므로 새 트랜잭션으로 재시도
        writes.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * 그룹과 OWNER를 함께 저장하고 커밋까지 성공한 뒤 최초 인증 토큰을 반환
     * 초대 코드·토큰 해시 충돌만 재시도하며 다른 저장 실패는 그대로 전파
     */
    public GroupResponses.Created create(GroupRequests.Create request) {
        for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
                return writes.execute(status -> {
                    // flush로 현재 시도 안에서 제약조건 위반을 확인
                    // 이후 OWNER 저장 실패 시 그룹도 롤백된다.
                    Group group = groups.saveAndFlush(new Group(request.name(), request.description(), codes.generate()));
                    var token = tokens.issue();
                    GroupMember owner = members.saveAndFlush(new GroupMember(
                            group, request.ownerNickname(), GroupRole.OWNER, token.hash()));
                    return new GroupResponses.Created(GroupResponses.Details.from(group, 1),
                            group.getInviteCode(), MemberResponse.from(owner), token.raw());
                });
            // execute 밖에서 잡으므로 실패한 트랜잭션의 롤백이 끝난 뒤 다음 시도를 시작
            } catch (DataIntegrityViolationException conflict) {
                if (!DatabaseConstraints.isViolation(conflict, "uk_groups_invite_code")
                        && !DatabaseConstraints.isViolation(conflict, "uk_member_token_hash")) {
                    throw conflict;
                }
            }
        }
        throw generationFailed();
    }

    /**
     * 초대 코드로 MEMBER를 등록
     * 사전 닉네임 검사 이후의 경쟁 상태는 DB UNIQUE로 방어
     */
    public GroupResponses.Joined join(GroupRequests.Join request) {
        for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
                return writes.execute(status -> {
                    Group group = groups.findByInviteCode(request.inviteCode()).orElseThrow(() ->
                            new ApiException(HttpStatus.NOT_FOUND, "INVITE_NOT_FOUND", "유효한 초대 코드를 찾을 수 없습니다."));
                    // 빠른 안내용 사전 검사
                    // 동시 요청의 최종 중복 방지는 DB UNIQUE가 담당
                    if (members.existsByGroupIdAndNickname(group.getId(), request.nickname())) {
                        throw nicknameConflict();
                    }
                    var token = tokens.issue();
                    GroupMember member = members.saveAndFlush(
                            new GroupMember(group, request.nickname(), GroupRole.MEMBER, token.hash()));
                    return new GroupResponses.Joined(
                            GroupResponses.Details.from(group, members.countByGroupId(group.getId())),
                            MemberResponse.from(member), token.raw());
                });
            } catch (DataIntegrityViolationException conflict) {
                if (DatabaseConstraints.isViolation(conflict, "uk_member_group_nickname")) {
                    throw nicknameConflict();
                }
                if (!DatabaseConstraints.isViolation(conflict, "uk_member_token_hash")) {
                    throw conflict;
                }
            }
        }
        throw generationFailed();
    }

    /**
     * 그룹 소속을 확인한 뒤 저장 컬럼 대신 COUNT로 현재 인원 수를 계산
     */
    @Transactional(readOnly = true)
    public GroupResponses.Details get(Long groupId, MemberPrincipal principal) {
        Group group = requireGroupMember(groupId, principal);
        return GroupResponses.Details.from(group, members.countByGroupId(groupId));
    }

    /**
     * 그룹 소속 확인 후 멤버를 ID 오름차순으로 조회하고 공개 정보만 응답
     */
    @Transactional(readOnly = true)
    public List<MemberResponse> listMembers(Long groupId, MemberPrincipal principal) {
        requireGroupMember(groupId, principal);
        return members.findAllByGroupIdOrderByIdAsc(groupId).stream().map(MemberResponse::from).toList();
    }

    /**
     * 같은 그룹의 OWNER에게만 초대 코드를 공개
     * 다른 그룹의 OWNER는 접근할 수 없음
     */
    @Transactional(readOnly = true)
    public GroupResponses.Invite invite(Long groupId, MemberPrincipal principal) {
        Group group = requireGroupMember(groupId, principal);
        if (principal.role() != GroupRole.OWNER) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "접근 권한이 없습니다.");
        }
        return new GroupResponses.Invite(group.getId(), group.getInviteCode());
    }

    /**
     * 그룹이 없으면 404, 다른 그룹 소속이면 403을 반환
     * 토큰 인증은 필터에서 먼저 완료됨
     */
    private Group requireGroupMember(Long groupId, MemberPrincipal principal) {
        Group group = groups.findById(groupId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "GROUP_NOT_FOUND", "그룹을 찾을 수 없습니다."));
        if (!groupId.equals(principal.groupId())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "접근 권한이 없습니다.");
        }
        return group;
    }

    private ApiException nicknameConflict() {
        return new ApiException(HttpStatus.CONFLICT, "NICKNAME_CONFLICT", "그룹에서 이미 사용 중인 닉네임입니다.");
    }

    private ApiException generationFailed() {
        return new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "GENERATION_FAILED", "요청 처리 중 오류가 발생했습니다.");
    }
}
