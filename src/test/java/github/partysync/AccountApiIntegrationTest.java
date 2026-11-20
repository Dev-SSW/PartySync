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
            jdbc.update("delete from account_refresh_token where user_session_id in (select id from user_session where user_id=?)", id);
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

    @Test void rememberCookieRotates_replayRevokesFamily_andOriginIsProtected() throws Exception {
        Login user=register();
        var login=send("/auth/login",null,Map.of("loginId",user.id,"password",PASSWORD)).andExpect(status().isOk()).andReturn();
        String header=login.getResponse().getHeader("Set-Cookie");
        assertThat(header).contains("HttpOnly","Secure","SameSite=Strict","Max-Age=");
        var cookie=cookieFrom(login);
        mvc.perform(post("/api/auth/refresh").cookie(cookie)).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/refresh").cookie(cookie).header("X-PartySync-Client","web").header("Origin","https://evil.example")).andExpect(status().isForbidden());
        var refreshed=mvc.perform(post("/api/auth/refresh").cookie(cookie).header("X-PartySync-Client","web")).andExpect(status().isOk()).andReturn();
        String access=node(refreshed).get("accountAccessToken").asText();
        assertThat(access).isNotEqualTo(node(login).get("accountAccessToken").asText());
        mvc.perform(post("/api/auth/refresh").cookie(cookie).header("X-PartySync-Client","web")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/account/me").header(HttpHeaders.AUTHORIZATION,bearer(access))).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/refresh").cookie(cookieFrom(refreshed)).header("X-PartySync-Client","web")).andExpect(status().isUnauthorized());
    }

    @Test void sessionCookieExpiryAndLogoutRevokeRefresh() throws Exception {
        Login user=register();
        var login=send("/auth/login?rememberMe=false",null,Map.of("loginId",user.id,"password",PASSWORD)).andExpect(status().isOk()).andReturn();
        assertThat(login.getResponse().getHeader("Set-Cookie")).doesNotContain("Max-Age=");
        var cookie=cookieFrom(login);
        mvc.perform(post("/api/auth/forget").cookie(cookie).header("X-PartySync-Client","web")).andExpect(status().isNoContent()).andExpect(header().string("Set-Cookie",org.hamcrest.Matchers.containsString("Max-Age=0")));
        mvc.perform(post("/api/auth/refresh").cookie(cookie).header("X-PartySync-Client","web")).andExpect(status().isUnauthorized());
        var next=send("/auth/login",null,Map.of("loginId",user.id,"password",PASSWORD)).andReturn();
        jdbc.update("update account_refresh_token set expires_at=now()-interval '1 second' where user_session_id in (select id from user_session where user_id=?)",user.userId);
        mvc.perform(post("/api/auth/refresh").cookie(cookieFrom(next)).header("X-PartySync-Client","web")).andExpect(status().isUnauthorized());
    }

    @Test void accountJoinIsLinkedImmediately_andRepeatedJoinResumesTheSameMember() throws Exception {
        var party=guest(); Login user=register();
        Map<String,String> request=Map.of("inviteCode",party.inviteCode(),"nickname","AccountMember");
        send("/account/groups/join",null,request).andExpect(status().isUnauthorized());
        send("/account/groups/join",party.memberAccessToken(),request).andExpect(status().isForbidden());
        send("/account/groups/join",user.token,Map.of("inviteCode","missing","nickname","AccountMember")).andExpect(status().isNotFound());
        send("/account/groups/join",user.token,Map.of("inviteCode",party.inviteCode(),"nickname","Owner")).andExpect(status().isConflict());
        var first=node(send("/account/groups/join",user.token,request).andExpect(status().isCreated()).andReturn());
        Long memberId=first.at("/member/memberId").asLong();
        assertThat(jdbc.queryForObject("select user_id from group_member where id=?",Long.class,memberId)).isEqualTo(user.userId);
        assertThat(jdbc.queryForObject("select access_token_hash from group_member where id=?",String.class,memberId)).isNull();
        assertThat(first.get("memberAccessToken").asText()).startsWith("m_");
        var again=node(send("/account/groups/join",user.token,Map.of("inviteCode",party.inviteCode(),"nickname","Different")).andExpect(status().isCreated()).andReturn());
        assertThat(again.at("/member/memberId").asLong()).isEqualTo(memberId);
        assertThat(again.at("/member/nickname").asText()).isEqualTo("AccountMember");
        assertThat(jdbc.queryForObject("select count(*) from group_member where group_id=?",Long.class,party.group().groupId())).isEqualTo(2);
    }

    @Test void failedAccountJoinSessionIssuance_rollsBackTheNewMembership() throws Exception {
        var party=guest(); Login user=register();
        doThrow(new org.springframework.dao.DataIntegrityViolationException("simulated persistence failure"))
                .when(memberSessions).saveAndFlush(org.mockito.ArgumentMatchers.any(MemberSession.class));
        send("/account/groups/join",user.token,Map.of("inviteCode",party.inviteCode(),"nickname","AccountMember")).andExpect(status().isInternalServerError());
        assertThat(jdbc.queryForObject("select count(*) from group_member where group_id=?",Long.class,party.group().groupId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from group_member where user_id=?",Long.class,user.userId)).isZero();
    }

    @Test void ownerRemovalKeepsOnlyPosts_andAllowsSameNicknameAndAccountToRejoin() throws Exception {
        var party=guest(); Long gid=party.group().groupId();
        var member=groups.join(new GroupRequests.Join(party.inviteCode(),"Participant"));
        send("/groups/"+gid+"/invite/check",member.memberAccessToken(),Map.of("inviteCode",party.inviteCode())).andExpect(status().isOk()).andExpect(jsonPath("matches").value(true));
        send("/groups/"+gid+"/invite/check",member.memberAccessToken(),Map.of("inviteCode","wrong")).andExpect(status().isOk()).andExpect(jsonPath("matches").value(false));
        var foreign=guest();
        String path="/api/groups/"+gid+"/members/";
        mvc.perform(delete(path+party.member().memberId()).header(HttpHeaders.AUTHORIZATION,bearer(member.memberAccessToken()))).andExpect(status().isForbidden());
        mvc.perform(delete(path+party.member().memberId()).header(HttpHeaders.AUTHORIZATION,bearer(party.memberAccessToken()))).andExpect(status().isForbidden());
        mvc.perform(delete(path+foreign.member().memberId()).header(HttpHeaders.AUTHORIZATION,bearer(party.memberAccessToken()))).andExpect(status().isForbidden());
        jdbc.update("update group_member set role='OWNER' where id=?",member.member().memberId());
        mvc.perform(delete(path+member.member().memberId()).header(HttpHeaders.AUTHORIZATION,bearer(party.memberAccessToken()))).andExpect(status().isForbidden());
        jdbc.update("update group_member set role='MEMBER' where id=?",member.member().memberId());
        jdbc.update("insert into weekly_availability(group_member_id,day_of_week,start_minute,end_minute) values(?,'MONDAY',0,60)",member.member().memberId());
        Long overrideId=jdbc.queryForObject("insert into availability_override(group_member_id,target_date,created_at) values(?,'2026-11-16',localtimestamp) returning id",Long.class,member.member().memberId());
        jdbc.update("insert into availability_override_slot(availability_override_id,start_minute,end_minute) values(?,120,180)",overrideId);
        Long cat=jdbc.queryForObject("insert into game_category(group_id,name,created_at) values(?,'Preserved',localtimestamp) returning id",Long.class,gid);
        jdbc.update("insert into post(group_id,game_category_id,author_id,title,created_at,updated_at) values(?,?,?,'History',localtimestamp,localtimestamp)",gid,cat,member.member().memberId());
        Login user=register(); String linked=claim(user,member.memberAccessToken()).get("memberAccessToken").asText();
        send("/account/invite/session",user.token,Map.of("inviteCode",party.inviteCode())).andExpect(status().isOk()).andExpect(jsonPath("member.memberId").value(member.member().memberId()));
        mvc.perform(delete(path+member.member().memberId()).header(HttpHeaders.AUTHORIZATION,bearer(party.memberAccessToken()))).andExpect(status().isNoContent());
        for (String token:List.of(member.memberAccessToken(),linked)) mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION,bearer(token))).andExpect(status().isUnauthorized());
        send("/account/groups/"+gid+"/session",user.token,null).andExpect(status().isForbidden());
        mvc.perform(get("/api/groups/"+gid).header(HttpHeaders.AUTHORIZATION,bearer(party.memberAccessToken()))).andExpect(jsonPath("memberCount").value(1));
        mvc.perform(get("/api/groups/"+gid+"/availability?from=2026-11-16&to=2026-11-16").header(HttpHeaders.AUTHORIZATION,bearer(party.memberAccessToken()))).andExpect(status().isOk()).andExpect(jsonPath("days[0].members.length()").value(1));
        assertThat(jdbc.queryForObject("select count(*) from post where author_id=?",Long.class,member.member().memberId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from weekly_availability where group_member_id=?",Long.class,member.member().memberId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from availability_override where group_member_id=?",Long.class,member.member().memberId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from availability_override_slot where availability_override_id=?",Long.class,overrideId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from member_session where group_member_id=?",Long.class,member.member().memberId())).isZero();
        assertThat(jdbc.queryForObject("select user_id from group_member where id=?",Long.class,member.member().memberId())).isNull();
        assertThat(jdbc.queryForObject("select access_token_hash from group_member where id=?",String.class,member.member().memberId())).isNull();
        assertThat(jdbc.queryForObject("select nickname from group_member where id=?",String.class,member.member().memberId())).isEqualTo("탈퇴한 사용자");
        var rejoined=node(send("/account/groups/join",user.token,Map.of("inviteCode",party.inviteCode(),"nickname","Participant")).andExpect(status().isCreated()).andReturn());
        assertThat(rejoined.at("/member/memberId").asLong()).isNotEqualTo(member.member().memberId());
        assertThat(rejoined.at("/member/nickname").asText()).isEqualTo("Participant");
        String newToken=rejoined.get("memberAccessToken").asText();
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION,bearer(newToken))).andExpect(status().isOk());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION,bearer(linked))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/groups/"+gid+"/posts").header(HttpHeaders.AUTHORIZATION,bearer(newToken))).andExpect(status().isOk()).andExpect(jsonPath("content[0].authorNickname").value("탈퇴한 사용자"));
        // 계정에 연결하지 않은 비회원 토큰도 강퇴 후 사용할 수 없어야 한다.
        var guest=groups.join(new GroupRequests.Join(party.inviteCode(),"Guest"));
        mvc.perform(delete(path+guest.member().memberId()).header(HttpHeaders.AUTHORIZATION,bearer(party.memberAccessToken()))).andExpect(status().isNoContent());
        mvc.perform(get("/api/members/me").header(HttpHeaders.AUTHORIZATION,bearer(guest.memberAccessToken()))).andExpect(status().isUnauthorized());
        send("/groups/join",null,Map.of("inviteCode",party.inviteCode(),"nickname","Guest")).andExpect(status().isCreated());
        send("/groups/join",null,Map.of("inviteCode",party.inviteCode(),"nickname","NewGuest")).andExpect(status().isCreated());
    }

    private jakarta.servlet.http.Cookie cookieFrom(MvcResult result) {
        String pair=result.getResponse().getHeader("Set-Cookie").split(";",2)[0];
        return new jakarta.servlet.http.Cookie("partysync_remember",pair.substring(pair.indexOf('=')+1));
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
        var request = post("/api" + path).header("X-PartySync-Client", "web"); if (token != null) request.header(HttpHeaders.AUTHORIZATION, bearer(token));
        if (body != null) request.contentType("application/json").content(json.writeValueAsString(body));
        return mvc.perform(request);
    }
    private JsonNode node(MvcResult result) { return json.readTree(result.getResponse().getContentAsByteArray()); }
    private static String newId() { return "u" + UUID.randomUUID().toString().replace("-", "").substring(0, 20); }
    private static String bearer(String token) { return "Bearer " + token; }
}
