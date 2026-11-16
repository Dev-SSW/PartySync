package github.partysync;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import github.partysync.account.*;
import github.partysync.group.*;
import github.partysync.support.TestDatabaseInitializer;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.*;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.*;
import tools.jackson.databind.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import static org.mockito.Mockito.*;

@SpringBootTest(properties = {"app.auth.rate-limit.ip-attempts=10000", "app.auth.rate-limit.login-attempts=10"})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@ActiveProfiles("test")
@ContextConfiguration(initializers = TestDatabaseInitializer.class)
class AccountApiIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired GroupService groups;
    @Autowired PasswordEncoder passwords;
    @MockitoSpyBean MemberSessionRepository memberSessions;
    private final List<Long> userIds = new ArrayList<>(), groupIds = new ArrayList<>();
    private static final String PASSWORD = "Safe-password-123!";
    private record Login(Long userId, String id, String token) { @Override public String toString() { return "Login[REDACTED]"; } }

    @AfterEach void cleanup() {
        for (Long id : userIds) {
            jdbc.update("delete from member_session where user_session_id in (select id from user_session where user_id=?)", id);
            jdbc.update("delete from user_session where user_id=?", id);
        }
        for (Long id : groupIds) {
            jdbc.update("delete from post where group_id=?", id);
            jdbc.update("delete from game_category where group_id=?", id);
            jdbc.update("delete from weekly_availability where group_member_id in (select id from group_member where group_id=?)", id);
            jdbc.update("delete from availability_override where group_member_id in (select id from group_member where group_id=?)", id);
            jdbc.update("delete from group_member where group_id=?", id);
            jdbc.update("delete from groups where id=?", id);
        }
        for (Long id : userIds) jdbc.update("delete from user_account where id=?", id);
    }

    @Test void registration_normalizesId_hashesPassword_and_rejectsDuplicates() throws Exception {
        Login login = register();
        String hash = jdbc.queryForObject("select password_hash from user_account where id=?", String.class, login.userId);
        assertThat(hash).isNotEqualTo(PASSWORD);
        assertThat(passwords.matches(PASSWORD, hash)).isTrue();
        send("/auth/register", null, Map.of("loginId", " " + login.id.toUpperCase(Locale.ROOT) + " ", "password", PASSWORD)).andExpect(status().isConflict());
        mvc.perform(get("/api/account/me").header(HttpHeaders.AUTHORIZATION, bearer(login.token)))
                .andExpect(status().isOk()).andExpect(jsonPath("loginId").value(login.id)).andExpect(jsonPath("passwordHash").doesNotExist())
                .andExpect(jsonPath("accountAccessToken").doesNotExist()).andExpect(header().string("Cache-Control", "no-store"));
        assertThat(jdbc.queryForObject("select token_hash from user_session where user_id=?", String.class, login.userId)).hasSize(64).isNotEqualTo(login.token);
    }

    @Test void loginFailsUniformly_andIsRateLimited() throws Exception {
        Login login = register();
        JsonNode wrong = node(send("/auth/login", null, Map.of("loginId", login.id, "password", "Wrong-password-123" )).andExpect(status().isUnauthorized()).andReturn());
        String missing = newId();
        JsonNode absent = node(send("/auth/login", null, Map.of("loginId", missing, "password", PASSWORD)).andExpect(status().isUnauthorized()).andReturn());
        assertThat(wrong).isEqualTo(absent);
        for (int i = 1; i < 10; i++) send("/auth/login", null, Map.of("loginId", missing, "password", PASSWORD)).andExpect(status().isUnauthorized());
        send("/auth/login", null, Map.of("loginId", missing, "password", PASSWORD)).andExpect(status().isTooManyRequests());
    }

    @Test void claimPreservesIdNicknameRoleScheduleAndPosts_andRevokesGuestToken() throws Exception {
        Login login = register(); var guest = guest(); Long groupId = guest.group().groupId();
        jdbc.update("insert into weekly_availability(group_member_id,day_of_week,start_minute,end_minute) values(?,'MONDAY',1140,1200)", guest.member().memberId());
        Long cat = jdbc.queryForObject("insert into game_category(group_id,name,created_at) values(?,'Game',localtimestamp) returning id", Long.class, groupId);
        jdbc.update("insert into post(group_id,game_category_id,author_id,title,content,created_at,updated_at) values(?,?,?,'Guide','Content',localtimestamp,localtimestamp)", groupId, cat, guest.member().memberId());
        JsonNode result = claim(login, guest.memberAccessToken());
        String token = result.get("memberAccessToken").asText();
        assertThat(token).startsWith("m_").hasSize(45);
        assertThat(result.at("/member/memberId").asLong()).isEqualTo(guest.member().memberId());
        assertThat(result.at("/member/nickname").asText()).isEqualTo("Owner");
        assertThat(result.at("/member/role").asText()).isEqualTo("OWNER");
        assertThat(jdbc.queryForObject("select access_token_hash from group_member where id=?", String.class, guest.member().memberId())).isNull();
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(guest.memberAccessToken()))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/members/me/weekly-availability").header(HttpHeaders.AUTHORIZATION, bearer(token))).andExpect(status().isOk()).andExpect(jsonPath("slots[0].startMinute").value(1140));
        mvc.perform(get("/api/groups/" + groupId + "/posts").header(HttpHeaders.AUTHORIZATION, bearer(token))).andExpect(status().isOk()).andExpect(jsonPath("content[0].authorId").value(guest.member().memberId()));
        send("/account/memberships/claim", login.token, Map.of("memberAccessToken", guest.memberAccessToken())).andExpect(status().isConflict());
    }

    @Test void crossDeviceLogin_restoresSameMember_andLogoutOnlyRevokesCurrentDevice() throws Exception {
        Login a = register(); var guest = guest(); String memberA = claim(a, guest.memberAccessToken()).get("memberAccessToken").asText();
        String accountB = login(a.id);
        JsonNode restored = node(send("/account/groups/" + guest.group().groupId() + "/session", accountB, null).andExpect(status().isOk()).andReturn());
        String memberB = restored.get("memberAccessToken").asText();
        assertThat(memberB).isNotEqualTo(memberA);
        assertThat(restored.at("/member/memberId").asLong()).isEqualTo(guest.member().memberId());
        send("/auth/logout", a.token, null).andExpect(status().isNoContent());
        mvc.perform(get("/api/account/me").header(HttpHeaders.AUTHORIZATION, bearer(a.token))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(memberA))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(memberB))).andExpect(status().isOk());
        send("/members/me/session/logout", memberB, null).andExpect(status().isNoContent());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(memberB))).andExpect(status().isUnauthorized());
        send("/account/groups/" + guest.group().groupId() + "/session", accountB, null).andExpect(status().isOk());
        assertThat(jdbc.queryForObject("select count(*) from group_member where group_id=?", Long.class, guest.group().groupId())).isEqualTo(1);
    }

    @Test void accountAndMemberTokens_cannotSubstituteEachOther_orAccessForeignMemberships() throws Exception {
        Login a = register(); var guest = guest();
        mvc.perform(get("/api/account/groups").header(HttpHeaders.AUTHORIZATION, bearer(guest.memberAccessToken()))).andExpect(status().isForbidden());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(a.token))).andExpect(status().isForbidden());
        send("/account/groups/" + guest.group().groupId() + "/session", a.token, null).andExpect(status().isForbidden());
        send("/members/me/session/logout", guest.memberAccessToken(), null).andExpect(status().isConflict());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(guest.memberAccessToken()))).andExpect(status().isOk());
        String member = claim(a, guest.memberAccessToken()).get("memberAccessToken").asText();
        var foreign = guest();
        mvc.perform(get("/api/groups/" + foreign.group().groupId()).header(HttpHeaders.AUTHORIZATION, bearer(member))).andExpect(status().isForbidden());
        Login b = register();
        send("/account/memberships/claim", b.token, Map.of("memberAccessToken", guest.memberAccessToken())).andExpect(status().isConflict());
        mvc.perform(get("/api/account/groups").header(HttpHeaders.AUTHORIZATION, bearer(b.token))).andExpect(status().isOk()).andExpect(content().json("[]"));
    }

    @Test void multipleGroups_andDuplicateGroupClaim_leaveGuestUsableOnFailure() throws Exception {
        Login a = register(); var first = guest(); var second = guest();
        claim(a, first.memberAccessToken()); claim(a, second.memberAccessToken());
        mvc.perform(get("/api/account/groups").header(HttpHeaders.AUTHORIZATION, bearer(a.token))).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2));
        var duplicate = groups.join(new GroupRequests.Join(first.inviteCode(), "Another"));
        send("/account/memberships/claim", a.token, Map.of("memberAccessToken", duplicate.memberAccessToken())).andExpect(status().isConflict());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(duplicate.memberAccessToken()))).andExpect(status().isOk());
    }

    @Test void expiredAndRevokedSessions_areDenied_includingExpiredParent() throws Exception {
        Login a = register(); var guest = guest(); String member = claim(a, guest.memberAccessToken()).get("memberAccessToken").asText();
        jdbc.update("update member_session set created_at=now()-interval '2 days', expires_at=now()-interval '1 second' where group_member_id=?", guest.member().memberId());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(member))).andExpect(status().isUnauthorized());
        String fresh = node(send("/account/groups/" + guest.group().groupId() + "/session", a.token, null).andExpect(status().isOk()).andReturn()).get("memberAccessToken").asText();
        jdbc.update("update user_session set created_at=now()-interval '9 days', expires_at=now()-interval '1 second' where user_id=?", a.userId);
        mvc.perform(get("/api/account/me").header(HttpHeaders.AUTHORIZATION, bearer(a.token))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(fresh))).andExpect(status().isUnauthorized());
        assertThat(login(a.id)).startsWith("u_");
    }

    @Test void concurrentClaims_haveOneWinner_andNoExtraMember() throws Exception {
        Login a = register(), b = register(); var guest = guest(); var barrier = new CyclicBarrier(2);
        try (var pool = Executors.newFixedThreadPool(2)) {
            List<Future<Integer>> requests = new ArrayList<>();
            for (Login user : List.of(a, b)) requests.add(pool.submit(() -> { barrier.await(5, TimeUnit.SECONDS); return send("/account/memberships/claim", user.token, Map.of("memberAccessToken", guest.memberAccessToken())).andReturn().getResponse().getStatus(); }));
            assertThat(List.of(requests.get(0).get(15, TimeUnit.SECONDS), requests.get(1).get(15, TimeUnit.SECONDS))).containsExactlyInAnyOrder(200, 409);
        }
        assertThat(jdbc.queryForObject("select count(*) from member_session where group_member_id=?", Long.class, guest.member().memberId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from group_member where group_id=?", Long.class, guest.group().groupId())).isEqualTo(1);
    }

    @Test void failedSessionIssuance_rollsBackClaimAndKeepsGuestTokenValid() throws Exception {
        Login user = register(); var guest = guest();
        doThrow(new org.springframework.dao.DataIntegrityViolationException("simulated persistence failure"))
                .when(memberSessions).saveAndFlush(org.mockito.ArgumentMatchers.any(MemberSession.class));
        send("/account/memberships/claim", user.token, Map.of("memberAccessToken", guest.memberAccessToken())).andExpect(status().isInternalServerError());
        assertThat(jdbc.queryForObject("select user_id from group_member where id=?", Long.class, guest.member().memberId())).isNull();
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(guest.memberAccessToken()))).andExpect(status().isOk());
        assertThat(jdbc.queryForObject("select count(*) from member_session where group_member_id=?", Long.class, guest.member().memberId())).isZero();
    }

    @Test void invalidInputsAndUnownedTokens_areRejected_withoutSecretEcho() throws Exception {
        for (var body : List.of(Map.of("loginId", "bad id", "password", PASSWORD), Map.of("loginId", newId(), "password", "short"), Map.of("loginId", newId(), "password", "가".repeat(25))))
            send("/auth/register", null, body).andExpect(status().isBadRequest()).andExpect(jsonPath("password").doesNotExist());
        Login user = register();
        send("/account/memberships/claim", user.token, Map.of("memberAccessToken", "x".repeat(43))).andExpect(status().isConflict());
        send("/account/memberships/claim", user.token, Map.of("groupId", 1, "nickname", "Owner")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/account/me")).andExpect(status().isUnauthorized());
    }

    @Test void legacyGuestTokenStartingWithAccountPrefix_stillAuthenticates() throws Exception {
        var guest = guest();
        String legacy = "u_" + "A".repeat(41);
        var hash = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(legacy.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        jdbc.update("update group_member set access_token_hash=? where id=?", hash, guest.member().memberId());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION, bearer(legacy))).andExpect(status().isOk()).andExpect(jsonPath("memberId").value(guest.member().memberId()));
        Login user = register();
        claim(user, legacy);
    }

    private Login register() throws Exception {
        String id = newId();
        JsonNode response = node(send("/auth/register", null, Map.of("loginId", id, "password", PASSWORD)).andExpect(status().isCreated()).andExpect(header().string("Cache-Control", "no-store")).andReturn());
        Long userId = response.at("/user/userId").asLong(); userIds.add(userId);
        return new Login(userId, id, response.get("accountAccessToken").asText());
    }
    private String login(String id) throws Exception { return node(send("/auth/login", null, Map.of("loginId", id, "password", PASSWORD)).andExpect(status().isOk()).andReturn()).get("accountAccessToken").asText(); }
    private GroupResponses.Created guest() { var group = groups.create(new GroupRequests.Create("Account test", null, "Owner")); groupIds.add(group.group().groupId()); return group; }
    private JsonNode claim(Login user, String token) throws Exception { return node(send("/account/memberships/claim", user.token, Map.of("memberAccessToken", token)).andExpect(status().isOk()).andReturn()); }
    private ResultActions send(String path, String token, Object body) throws Exception {
        var request = post("/api" + path); if (token != null) request.header(HttpHeaders.AUTHORIZATION, bearer(token));
        if (body != null) request.contentType("application/json").content(json.writeValueAsString(body));
        return mvc.perform(request);
    }
    private JsonNode node(MvcResult result) { return json.readTree(result.getResponse().getContentAsByteArray()); }
    private static String newId() { return "u" + UUID.randomUUID().toString().replace("-", "").substring(0, 20); }
    private static String bearer(String token) { return "Bearer " + token; }
}
