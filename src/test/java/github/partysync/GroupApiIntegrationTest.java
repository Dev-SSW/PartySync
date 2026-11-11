package github.partysync;

import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import github.partysync.groupmember.GroupMember;
import github.partysync.groupmember.GroupMemberRepository;
import github.partysync.groupmember.auth.MemberTokenService;
import github.partysync.groupmember.auth.SecureCodeGenerator;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import github.partysync.support.PostgresTestConfig;
import org.springframework.context.annotation.Import;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 실제 PostgreSQL과 보안 필터로 API·권한·경쟁 상태·롤백을 검증한다. 각 테스트 후 전용 DB를 정리한다.
 */
@SpringBootTest(properties = "app.security.allowed-origins=http://localhost:5173")
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@Import(PostgresTestConfig.class)
class GroupApiIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired MemberTokenService tokens;
    @MockitoSpyBean SecureCodeGenerator codes;
    @MockitoSpyBean GroupMemberRepository members;

    @AfterEach
    void cleanDatabase() {
        // API는 실제로 커밋하므로 테스트 종료 시 격리된 컨테이너 또는 전용 raidsync_test DB만 정리한다.
        jdbc.execute("TRUNCATE TABLE groups RESTART IDENTITY CASCADE");
    }

    @Test
    void createsGroupAndOwnerAndStoresOnlyTokenHash() throws Exception {
        Access owner = create("Evening", "Owner");
        assertThat(jdbc.queryForObject("select count(*) from groups", Long.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select role from group_member where id = ?", String.class, owner.memberId()))
                .isEqualTo("OWNER");
        assertThat(jdbc.queryForObject("select access_token_hash from group_member where id = ?",
                String.class, owner.memberId())).isEqualTo(tokens.hash(owner.token()));
        assertThat(owner.token()).hasSize(43).isNotEqualTo(owner.invite());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(owner.token())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.memberId").value(owner.memberId()))
                .andExpect(jsonPath("$.groupId").value(owner.groupId()))
                .andExpect(jsonPath("$.role").value("OWNER"))
                .andExpect(jsonPath("$.accessTokenHash").doesNotExist())
                .andExpect(jsonPath("$.memberAccessToken").doesNotExist());
    }

    @Test
    void joinsAndListsMembersAndCountsThemWithoutLeakingCredentials() throws Exception {
        Access owner = create("Group", "Owner");
        Access member = join(owner, "Member");
        mvc.perform(get("/api/groups/" + owner.groupId()).header(HttpHeaders.AUTHORIZATION, bearer(member.token())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.memberCount").value(2))
                .andExpect(jsonPath("$.inviteCode").doesNotExist())
                .andExpect(jsonPath("$.accessTokenHash").doesNotExist());
        String body = mvc.perform(get("/api/groups/" + owner.groupId() + "/members")
                        .header(HttpHeaders.AUTHORIZATION, bearer(member.token())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].memberId").value(owner.memberId()))
                .andExpect(jsonPath("$[0].role").value("OWNER"))
                .andExpect(jsonPath("$[1].memberId").value(member.memberId()))
                .andExpect(jsonPath("$[1].role").value("MEMBER"))
                .andExpect(jsonPath("$[1].joinedAt").exists())
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("accessTokenHash", "memberAccessToken", owner.token(), member.token(),
                tokens.hash(owner.token()), tokens.hash(member.token()));
        mvc.perform(get("/api/members/me").param("memberId", owner.memberId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(member.token())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.memberId").value(member.memberId()))
                .andExpect(jsonPath("$.role").value("MEMBER"));
    }

    @Test
    void onlyOwnerMayReadInviteAndOtherGroupsAreForbidden() throws Exception {
        Access owner = create("First", "Owner");
        Access member = join(owner, "Member");
        Access other = create("Second", "Owner");
        mvc.perform(get("/api/groups/" + owner.groupId() + "/invite")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.token())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.inviteCode").value(owner.invite()))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
        for (String path : List.of("", "/members", "/invite")) {
            mvc.perform(get("/api/groups/" + owner.groupId() + path)
                            .header(HttpHeaders.AUTHORIZATION, bearer(other.token())))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
        }
        mvc.perform(get("/api/groups/" + owner.groupId() + "/invite")
                        .header(HttpHeaders.AUTHORIZATION, bearer(member.token())))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.status").value(403));
    }

    @Test
    void missingTokenReturnsJson401AndDoesNotRevealGroupExistence() throws Exception {
        for (String path : List.of("/api/members/me", "/api/groups/999999", "/api/groups/999999/members")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
                    .andExpect(header().string(HttpHeaders.WWW_AUTHENTICATE, "Bearer"));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"Basic abc", "Bearer invalid", "Bearer ", "Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
    void invalidAuthenticationAlwaysReturns401(String header) throws Exception {
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, header))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.status").value(401));
    }

    @Test
    void inviteCodeIsNotAnAuthenticationTokenAndDuplicateHeadersAreRejected() throws Exception {
        Access owner = create("Group", "Owner");
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(owner.invite())))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION,
                        bearer(owner.token()), bearer(owner.token())))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/members/me").param("access_token", owner.token()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void validAuthenticationDoesNotCreateOrReuseASession() throws Exception {
        Access owner = create("Group", "Owner");
        MvcResult authenticated = mvc.perform(get("/api/members/me")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.token())))
                .andExpect(status().isOk()).andExpect(cookie().doesNotExist("JSESSIONID")).andReturn();
        assertThat(authenticated.getRequest().getSession(false)).isNull();
        mvc.perform(get("/api/members/me")).andExpect(status().isUnauthorized());
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"name\":\" \",\"ownerNickname\":\"Owner\"}",
            "{\"name\":\"Group\",\"ownerNickname\":\" \"}", "{\"name\":null,\"ownerNickname\":\"Owner\"}",
            "{", "null"})
    void invalidCreationInputIs400AndWritesNothing(String json) throws Exception {
        mvc.perform(post("/api/groups").contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        assertThat(jdbc.queryForObject("select count(*) from groups", Long.class)).isZero();
    }

    @Test
    void rejectsOverlongNameAndNickname() throws Exception {
        mvc.perform(post("/api/groups").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(java.util.Map.of("name", "a".repeat(101), "ownerNickname", "Owner"))))
                .andExpect(status().isBadRequest());
        Access owner = create("Group", "Owner");
        mvc.perform(post("/api/groups/join").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(java.util.Map.of("inviteCode", owner.invite(), "nickname", "x".repeat(51)))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void invalidInviteIs404AndBlankNicknameIs400() throws Exception {
        mvc.perform(post("/api/groups/join").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"inviteCode\":\"missing\",\"nickname\":\"Member\"}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("INVITE_NOT_FOUND"));
        mvc.perform(post("/api/groups/join").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"inviteCode\":\"missing\",\"nickname\":\" \"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void duplicateNicknameReturns409ButSameNicknameInOtherGroupIsAllowed() throws Exception {
        Access first = create("First", "Owner");
        Access second = create("Second", "Other");
        mvc.perform(post("/api/groups/join").contentType(MediaType.APPLICATION_JSON)
                        .content(joinJson(first.invite(), " Owner ")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("NICKNAME_CONFLICT"));
        join(second, "Owner");
    }

    @Test
    void concurrentJoinsAreResolvedByUniqueConstraintAs201And409() throws Exception {
        Access owner = create("Group", "Owner");
        // 두 요청을 사전 검사 이후로 보내 실제 DB UNIQUE 충돌의 409 처리를 검증한다.
        doReturn(false).when(members).existsByGroupIdAndNickname(owner.groupId(), "Race");
        CyclicBarrier start = new CyclicBarrier(2);
        Callable<Integer> attempt = () -> {
            start.await(10, TimeUnit.SECONDS);
            return mvc.perform(post("/api/groups/join").contentType(MediaType.APPLICATION_JSON)
                    .content(joinJson(owner.invite(), "Race"))).andReturn().getResponse().getStatus();
        };
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(attempt);
            var second = executor.submit(attempt);
            assertThat(List.of(first.get(30, TimeUnit.SECONDS), second.get(30, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(201, 409);
        }
        assertThat(jdbc.queryForObject("select count(*) from group_member where group_id = ? and nickname = 'Race'",
                Long.class, owner.groupId())).isEqualTo(1);
    }

    @Test
    void ownerFailureRollsBackGroupAndReturnsSanitized500() throws Exception {
        doThrow(new IllegalStateException("forced internal failure")).when(members).saveAndFlush(any(GroupMember.class));
        mvc.perform(post("/api/groups").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Group\",\"ownerNickname\":\"Owner\"}"))
                .andExpect(status().isInternalServerError()).andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("forced"))));
        assertThat(jdbc.queryForObject("select count(*) from groups", Long.class)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from group_member", Long.class)).isZero();
    }

    @Test
    void inviteCollisionRetriesInANewTransaction() throws Exception {
        Access existing = create("First", "Owner");
        String nextInvite = "B".repeat(43);
        doReturn(existing.invite(), nextInvite, "C".repeat(43)).when(codes).generate();
        Access created = create("Second", "Owner");
        assertThat(created.invite()).isEqualTo(nextInvite);
        assertThat(jdbc.queryForObject("select count(*) from groups", Long.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("select count(*) from group_member", Long.class)).isEqualTo(2);
    }

    @Test
    void persistentInviteCollisionFailsAfterBoundedRetriesWithoutPartialWrites() throws Exception {
        Access existing = create("First", "Owner");
        doReturn(existing.invite()).when(codes).generate();
        mvc.perform(post("/api/groups").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Second\",\"ownerNickname\":\"Owner\"}"))
                .andExpect(status().isInternalServerError()).andExpect(jsonPath("$.code").value("GENERATION_FAILED"));
        assertThat(jdbc.queryForObject("select count(*) from groups", Long.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from group_member", Long.class)).isEqualTo(1);
    }

    @Test
    void tokenHashCollisionAlsoRollsBackAndRetriesWholeCreation() throws Exception {
        Access existing = create("First", "Owner");
        doReturn("D".repeat(43), existing.token(), "E".repeat(43), "F".repeat(43)).when(codes).generate();
        Access created = create("Second", "Owner");
        assertThat(created.invite()).isEqualTo("E".repeat(43));
        assertThat(jdbc.queryForObject("select count(*) from groups", Long.class)).isEqualTo(2);
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(created.token())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.groupId").value(created.groupId()));
    }

    @Test
    void joiningWithTokenHashCollisionRetriesWithoutLeavingDuplicateMembers() throws Exception {
        Access owner = create("Group", "Owner");
        doReturn(owner.token(), "G".repeat(43)).when(codes).generate();
        Access member = join(owner, "Member");
        assertThat(member.token()).isEqualTo("G".repeat(43));
        assertThat(jdbc.queryForObject("select count(*) from group_member", Long.class)).isEqualTo(2);
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(member.token())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.memberId").value(member.memberId()));
    }

    @Test
    void authenticatedMissingGroupIs404AndInvalidPathIs400() throws Exception {
        Access owner = create("Group", "Owner");
        mvc.perform(get("/api/groups/999999").header(HttpHeaders.AUTHORIZATION, bearer(owner.token())))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
        mvc.perform(get("/api/groups/-1").header(HttpHeaders.AUTHORIZATION, bearer(owner.token())))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/groups/not-a-number").header(HttpHeaders.AUTHORIZATION, bearer(owner.token())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void corsAllowsConfiguredOriginAndRejectsUnlistedOrigin() throws Exception {
        mvc.perform(options("/api/groups/1").header(HttpHeaders.ORIGIN, "http://localhost:5173")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "authorization"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:5173"))
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS));
        mvc.perform(options("/api/groups/1").header(HttpHeaders.ORIGIN, "https://untrusted.example")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    private Access create(String name, String ownerNickname) throws Exception {
        MvcResult result = mvc.perform(post("/api/groups").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(java.util.Map.of("name", name, "ownerNickname", ownerNickname))))
                .andExpect(status().isCreated()).andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.member.role").value("OWNER"))
                .andExpect(jsonPath("$.member.accessTokenHash").doesNotExist()).andReturn();
        JsonNode json = mapper.readTree(result.getResponse().getContentAsString());
        return new Access(json.path("group").path("groupId").asLong(), json.path("member").path("memberId").asLong(),
                json.path("inviteCode").asString(), json.path("memberAccessToken").asString());
    }

    private Access join(Access owner, String nickname) throws Exception {
        MvcResult result = mvc.perform(post("/api/groups/join").contentType(MediaType.APPLICATION_JSON)
                        .content(joinJson(owner.invite(), nickname)))
                .andExpect(status().isCreated()).andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.member.role").value("MEMBER"))
                .andExpect(jsonPath("$.member.accessTokenHash").doesNotExist()).andReturn();
        JsonNode json = mapper.readTree(result.getResponse().getContentAsString());
        return new Access(json.path("group").path("groupId").asLong(), json.path("member").path("memberId").asLong(),
                owner.invite(), json.path("memberAccessToken").asString());
    }

    private String joinJson(String invite, String nickname) {
        return mapper.writeValueAsString(java.util.Map.of("inviteCode", invite, "nickname", nickname));
    }

    private String bearer(String token) { return "Bearer " + token; }

    private record Access(Long groupId, Long memberId, String invite, String token) {
        @Override public String toString() { return "Access[credentials=REDACTED]"; }
    }
}
