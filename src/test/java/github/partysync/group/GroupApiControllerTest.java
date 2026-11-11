package github.partysync.group;

import java.time.LocalDateTime;
import java.util.List;

import github.partysync.common.ApiException;
import github.partysync.common.GlobalExceptionHandler;
import github.partysync.config.SecurityConfig;
import github.partysync.groupmember.GroupRole;
import github.partysync.groupmember.MemberController;
import github.partysync.groupmember.MemberResponse;
import github.partysync.groupmember.auth.MemberAuthenticationService;
import github.partysync.groupmember.auth.MemberPrincipal;
import github.partysync.groupmember.auth.SecurityErrorWriter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * DB 없이 HTTP 요청 검증·응답 형식·보안 필터·예외 처리를 검증한다.
 * Service와 토큰 조회만 대체하며 실제 저장·권한·트랜잭션은 GroupApiIntegrationTest가 검증한다.
 */
@WebMvcTest(controllers = {GroupController.class, MemberController.class},
        properties = "app.security.allowed-origins=http://localhost:5173")
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@Import({SecurityConfig.class, SecurityErrorWriter.class, GlobalExceptionHandler.class})
class GroupApiControllerTest {
    private static final LocalDateTime CREATED_AT = LocalDateTime.of(2026, 11, 11, 18, 0);
    private static final MemberPrincipal OWNER = new MemberPrincipal(10L, 1L, "Owner", GroupRole.OWNER);
    private static final MemberPrincipal MEMBER = new MemberPrincipal(11L, 1L, "Member", GroupRole.MEMBER);

    @Autowired MockMvc mvc;
    @MockitoBean GroupService groups;
    @MockitoBean MemberAuthenticationService memberAuthentication;

    @Test
    @DisplayName("인증 없이 그룹을 생성하면 201·Location·캐시 금지와 생성 응답을 반환한다")
    void creationReturnsCreatedResourceAndCredentialsWithoutRequiringAuthentication() throws Exception {
        var response = new GroupResponses.Created(details(1), "invite",
                new MemberResponse(10L, "Owner", GroupRole.OWNER, CREATED_AT), "A".repeat(43));
        given(groups.create(any())).willReturn(response);

        mvc.perform(post("/api/groups").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Group\",\"ownerNickname\":\"Owner\"}"))
                .andExpect(status().isCreated())
                .andExpect(header().string(HttpHeaders.LOCATION, "/api/groups/1"))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.group.groupId").value(1))
                .andExpect(jsonPath("$.group.memberCount").value(1))
                .andExpect(jsonPath("$.member.role").value("OWNER"))
                .andExpect(jsonPath("$.memberAccessToken").value("A".repeat(43)))
                .andExpect(jsonPath("$.member.accessTokenHash").doesNotExist());
        verify(groups).create(new GroupRequests.Create("Group", null, "Owner"));
        verifyNoInteractions(memberAuthentication);
    }

    @Test
    @DisplayName("초대 참여는 인증 없이 가능하고 새 멤버의 인증 정보만 응답한다")
    void joiningReturnsMemberCredentialsAndDoesNotExposeInviteInResponse() throws Exception {
        given(groups.join(any())).willReturn(new GroupResponses.Joined(details(2),
                new MemberResponse(11L, "Member", GroupRole.MEMBER, CREATED_AT), "B".repeat(43)));

        mvc.perform(post("/api/groups/join").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"inviteCode\":\"invite\",\"nickname\":\"Member\"}"))
                .andExpect(status().isCreated())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.member.memberId").value(11))
                .andExpect(jsonPath("$.member.role").value("MEMBER"))
                .andExpect(jsonPath("$.memberAccessToken").value("B".repeat(43)))
                .andExpect(jsonPath("$.inviteCode").doesNotExist());
        verify(groups).join(new GroupRequests.Join("invite", "Member"));
    }

    @Test
    @DisplayName("그룹 조회는 인증된 요청자를 Service에 전달하고 공개 필드만 반환한다")
    void groupLookupForwardsAuthenticatedPrincipal() throws Exception {
        given(groups.get(1L, OWNER)).willReturn(details(2));
        mvc.perform(get("/api/groups/1").with(as(OWNER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Group"))
                .andExpect(jsonPath("$.description").value("Description"))
                .andExpect(jsonPath("$.memberCount").value(2))
                .andExpect(jsonPath("$.createdAt").exists())
                .andExpect(jsonPath("$.inviteCode").doesNotExist());
        verify(groups).get(1L, OWNER);
    }

    @Test
    @DisplayName("멤버 목록은 토큰과 해시를 제외한 배열로 반환한다")
    void memberListReturnsOnlyPublicMemberFields() throws Exception {
        given(groups.listMembers(1L, MEMBER)).willReturn(List.of(
                new MemberResponse(10L, "Owner", GroupRole.OWNER, CREATED_AT),
                new MemberResponse(11L, "Member", GroupRole.MEMBER, CREATED_AT)));
        mvc.perform(get("/api/groups/1/members").with(as(MEMBER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].memberId").value(10))
                .andExpect(jsonPath("$[1].role").value("MEMBER"))
                .andExpect(jsonPath("$[0].accessTokenHash").doesNotExist())
                .andExpect(jsonPath("$[1].memberAccessToken").doesNotExist());
        verify(groups).listMembers(1L, MEMBER);
    }

    @Test
    @DisplayName("내 정보는 임의의 memberId 입력을 무시하고 인증된 멤버를 반환한다")
    void myInfoIsDerivedFromAuthenticationRatherThanRequestParameters() throws Exception {
        mvc.perform(get("/api/members/me").param("memberId", "10").with(as(MEMBER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memberId").value(11))
                .andExpect(jsonPath("$.groupId").value(1))
                .andExpect(jsonPath("$.nickname").value("Member"))
                .andExpect(jsonPath("$.role").value("MEMBER"));
        verifyNoInteractions(groups);
    }

    @Test
    @DisplayName("보호된 API는 인증이 없으면 비즈니스 로직 실행 전에 JSON 401로 거절한다")
    void protectedEndpointsRejectMissingAuthenticationBeforeCallingService() throws Exception {
        for (String path : List.of("/api/groups/1", "/api/groups/1/members",
                "/api/groups/1/invite", "/api/members/me")) {
            mvc.perform(get(path))
                    .andExpect(status().isUnauthorized())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        }
        verifyNoInteractions(groups);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"name\":\" \",\"ownerNickname\":\"Owner\"}",
            "{\"name\":\"Group\",\"ownerNickname\":\" \"}"})
    @DisplayName("필수 입력이 잘못되면 Service를 호출하지 않고 400을 반환한다")
    void invalidRequestsNeverReachBusinessService(String body) throws Exception {
        mvc.perform(post("/api/groups").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(groups);
    }

    @Test
    @DisplayName("비즈니스 닉네임 충돌은 공통 오류 형식의 409로 변환한다")
    void businessConflictIsMappedTo409() throws Exception {
        given(groups.join(any())).willThrow(new ApiException(
                HttpStatus.CONFLICT, "NICKNAME_CONFLICT", "이미 사용 중인 닉네임입니다."));
        mvc.perform(post("/api/groups/join").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"inviteCode\":\"invite\",\"nickname\":\"Member\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.code").value("NICKNAME_CONFLICT"));
    }

    @Test
    @DisplayName("예상하지 못한 서버 오류는 내부 예외 내용을 응답에 노출하지 않는다")
    void unexpectedFailureDoesNotExposeInternalDetails() throws Exception {
        given(groups.create(any())).willThrow(new IllegalStateException("internal-db-credential-details"));
        mvc.perform(post("/api/groups").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Group\",\"ownerNickname\":\"Owner\"}"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(content().string(not(containsString("internal-db-credential-details"))));
    }

    private GroupResponses.Details details(long count) {
        return new GroupResponses.Details(1L, "Group", "Description", count, CREATED_AT);
    }

    private RequestPostProcessor as(MemberPrincipal principal) {
        return authentication(UsernamePasswordAuthenticationToken.authenticated(principal, null,
                List.of(new SimpleGrantedAuthority("ROLE_" + principal.role().name()))));
    }
}
