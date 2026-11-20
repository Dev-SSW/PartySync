package github.partysync.notification;

import java.util.Base64;
import java.util.Map;
import java.util.List;
import github.partysync.group.*;
import github.partysync.support.TestDatabaseInitializer;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.*;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="app.push.dispatch-enabled=false")
@AutoConfigureMockMvc(print=MockMvcPrint.NONE)
@ActiveProfiles("test")
@ContextConfiguration(initializers=TestDatabaseInitializer.class)
class PushApiIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired GroupService groups;
    @MockitoBean PushGateway gateway;
    @Autowired SchedulePushNotifications notifications;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
    GroupResponses.Created owner;
    GroupResponses.Joined member;
    private static final String ENDPOINT="https://fcm.googleapis.com/fcm/send/device-member";
    private static final String AUTH=Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[16]);
    private static final String KEY;
    static { byte[] bytes=new byte[65]; bytes[0]=4; KEY=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }

    @BeforeEach void prepare() throws Exception {
        when(gateway.enabled()).thenReturn(true);
        when(gateway.publicKey()).thenReturn(KEY);
        when(gateway.send(anyString(),anyString(),anyString(),anyString())).thenReturn(201);
        owner=groups.create(new GroupRequests.Create("Raid",null,"Owner"));
        member=groups.join(new GroupRequests.Join(owner.inviteCode(),"Member"));
    }
    @AfterEach void cleanup() {
        jdbc.execute("truncate groups restart identity cascade");
        jdbc.execute("truncate user_account restart identity cascade");
    }

    @Test void subscriptionsAreAuthenticatedIdempotentAndScopedToTheCaller() throws Exception {
        mvc.perform(get("/api/members/me/push/configuration")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/members/me/push/configuration").header(HttpHeaders.AUTHORIZATION,bearer(member.memberAccessToken())))
                .andExpect(status().isOk()).andExpect(jsonPath("enabled").value(true)).andExpect(jsonPath("privateKey").doesNotExist());
        subscribe(member.memberAccessToken(),ENDPOINT); subscribe(member.memberAccessToken(),ENDPOINT);
        assertThat(count("push_subscription")).isEqualTo(1);
        mvc.perform(delete("/api/members/me/push/subscription").header(HttpHeaders.AUTHORIZATION,bearer(owner.memberAccessToken()))
                .contentType("application/json").content(json.writeValueAsString(Map.of("endpoint",ENDPOINT)))).andExpect(status().isNoContent());
        assertThat(count("push_subscription")).isEqualTo(1);
        for (String endpoint:List.of("http://localhost/private","https://127.0.0.1/path","https://fcm.googleapis.com.evil.example/push","https://fcm.googleapis.com:8443/path","https://user@fcm.googleapis.com/path","https://example.com/path")) {
            mvc.perform(put("/api/members/me/push/subscription").header(HttpHeaders.AUTHORIZATION,bearer(member.memberAccessToken()))
                    .contentType("application/json").content(json.writeValueAsString(Map.of("endpoint",endpoint,"keys",Map.of("p256dh",KEY,"auth",AUTH)))))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(put("/api/members/me/push/subscription").header(HttpHeaders.AUTHORIZATION,bearer(member.memberAccessToken()))
                .contentType("application/json").content(json.writeValueAsString(Map.of("endpoint",ENDPOINT,"keys",Map.of("p256dh","bad","auth",AUTH)))))
                .andExpect(status().isBadRequest());
        verify(gateway,never()).send(anyString(),anyString(),anyString(),anyString());
    }

    @Test void changesNotifyOnlyOtherPartyMembers_andAutosavesAreCoalescedAndNoOpsIgnored() throws Exception {
        subscribe(member.memberAccessToken(),ENDPOINT);
        subscribe(owner.memberAccessToken(),"https://fcm.googleapis.com/fcm/send/owner");
        var outsider=groups.create(new GroupRequests.Create("Other",null,"Outsider"));
        subscribe(outsider.memberAccessToken(),"https://fcm.googleapis.com/fcm/send/other");
        saveWeekly(60);
        assertThat(count("push_delivery")).isEqualTo(1);
        jdbc.update("update push_delivery set attempts=2");
        saveWeekly(60);
        assertThat(jdbc.queryForObject("select attempts from push_delivery",Integer.class)).isEqualTo(2);
        saveWeekly(120); saveWeekly(180);
        assertThat(count("push_delivery")).isEqualTo(1);
        assertThat(jdbc.queryForObject("select attempts from push_delivery",Integer.class)).isZero();
        notifications.dispatch(); verify(gateway,never()).send(anyString(),anyString(),anyString(),anyString());
        due(); notifications.dispatch();
        var payload=org.mockito.ArgumentCaptor.forClass(String.class);
        verify(gateway).send(eq(ENDPOINT),eq(KEY),eq(AUTH),payload.capture());
        assertThat(json.readTree(payload.getValue()).get("url").asText()).isEqualTo("/groups/"+owner.group().groupId());
        assertThat(json.readTree(payload.getValue()).get("body").asText()).contains("Owner");
        assertThat(count("push_delivery")).isZero();
    }

    @Test void overrideChangeAndDeletionNotifyButRepeatedIdenticalOrMissingDeletionDoNot() throws Exception {
        subscribe(member.memberAccessToken(),ENDPOINT);
        String url="/api/members/me/availability-overrides/2026-11-20";
        for (int attempt=0; attempt<2; attempt++) {
            mvc.perform(put(url).header(HttpHeaders.AUTHORIZATION,bearer(owner.memberAccessToken())).contentType("application/json").content("{\"slots\":[]}"))
                    .andExpect(status().isOk());
            if (attempt==0) { assertThat(count("push_delivery")).isEqualTo(1); jdbc.update("delete from push_delivery"); }
            else assertThat(count("push_delivery")).isZero();
        }
        mvc.perform(delete(url).header(HttpHeaders.AUTHORIZATION,bearer(owner.memberAccessToken()))).andExpect(status().isNoContent());
        assertThat(count("push_delivery")).isEqualTo(1);
        jdbc.update("delete from push_delivery");
        mvc.perform(delete(url).header(HttpHeaders.AUTHORIZATION,bearer(owner.memberAccessToken()))).andExpect(status().isNoContent());
        assertThat(count("push_delivery")).isZero();
    }

    @Test void failedScheduleTransactionRollsBackBothScheduleAndNotifications() throws Exception {
        subscribe(member.memberAccessToken(),ENDPOINT);
        new org.springframework.transaction.support.TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            try { saveWeekly(60); } catch (Exception error) { throw new IllegalStateException(error); }
            assertThat(count("weekly_availability")).isEqualTo(1);
            assertThat(count("push_delivery")).isEqualTo(1);
            status.setRollbackOnly();
        });
        assertThat(count("weekly_availability")).isZero();
        assertThat(count("push_delivery")).isZero();
        verify(gateway,never()).send(anyString(),anyString(),anyString(),anyString());
    }

    @Test void unsubscribeAndKickRemoveSubscriptionsAndPendingDeliveries() throws Exception {
        subscribe(member.memberAccessToken(),ENDPOINT); saveWeekly(60);
        mvc.perform(delete("/api/members/me/push/subscription").header(HttpHeaders.AUTHORIZATION,bearer(member.memberAccessToken()))
                .contentType("application/json").content(json.writeValueAsString(Map.of("endpoint",ENDPOINT)))).andExpect(status().isNoContent());
        assertThat(count("push_delivery")).isZero(); assertThat(count("push_subscription")).isZero();
        subscribe(member.memberAccessToken(),ENDPOINT); saveWeekly(120);
        mvc.perform(delete("/api/groups/"+owner.group().groupId()+"/members/"+member.member().memberId())
                .header(HttpHeaders.AUTHORIZATION,bearer(owner.memberAccessToken()))).andExpect(status().isNoContent());
        assertThat(count("push_subscription")).isZero(); assertThat(count("push_delivery")).isZero();
    }

    @Test void goneEndpointsAreRemovedAndTransientFailuresHaveBoundedRetries() throws Exception {
        subscribe(member.memberAccessToken(),ENDPOINT); saveWeekly(60);
        when(gateway.send(anyString(),anyString(),anyString(),anyString())).thenReturn(503);
        for (int attempt=1;attempt<=3;attempt++) {
            due(); notifications.dispatch();
            assertThat(count("push_delivery")).isEqualTo(attempt<3 ? 1 : 0);
        }
        saveWeekly(120); due();
        when(gateway.send(anyString(),anyString(),anyString(),anyString())).thenReturn(410);
        notifications.dispatch();
        assertThat(count("push_subscription")).isZero(); assertThat(count("push_delivery")).isZero();
    }

    @Test void newChangeDuringDeliveryIsNotLost() throws Exception {
        subscribe(member.memberAccessToken(),ENDPOINT); saveWeekly(60); due();
        when(gateway.send(anyString(),anyString(),anyString(),anyString())).thenAnswer(invocation -> { saveWeekly(120); return 201; });
        notifications.dispatch();
        assertThat(count("push_delivery")).isEqualTo(1);
        when(gateway.send(anyString(),anyString(),anyString(),anyString())).thenReturn(201);
        due(); notifications.dispatch();
        assertThat(count("push_delivery")).isZero();
    }

    @Test void accountLogoutStopsPendingAndFutureDelivery() throws Exception {
        // 비회원 때 켠 알림도 계정 연결 후 로그아웃하면 중단된다.
        subscribe(member.memberAccessToken(),ENDPOINT);
        var registered=mvc.perform(post("/api/auth/register").header("X-PartySync-Client","web").contentType("application/json")
                .content("{\"loginId\":\"pushuser\",\"password\":\"Safe-password-123!\"}")).andExpect(status().isCreated()).andReturn();
        String account=json.readTree(registered.getResponse().getContentAsByteArray()).get("accountAccessToken").asText();
        var claimed=mvc.perform(post("/api/account/memberships/claim").header(HttpHeaders.AUTHORIZATION,bearer(account)).contentType("application/json")
                .content(json.writeValueAsString(Map.of("memberAccessToken",member.memberAccessToken())))).andExpect(status().isOk()).andReturn();
        String linked=json.readTree(claimed.getResponse().getContentAsByteArray()).get("memberAccessToken").asText();
        assertThat(jdbc.queryForObject("select user_session_id from push_subscription",Long.class)).isNotNull();
        mvc.perform(post("/api/members/me/push/status").header(HttpHeaders.AUTHORIZATION,bearer(linked)).contentType("application/json")
                .content(json.writeValueAsString(Map.of("endpoint",ENDPOINT)))).andExpect(status().isOk()).andExpect(jsonPath("subscribed").value(true));
        saveWeekly(60);
        mvc.perform(post("/api/auth/logout").header("X-PartySync-Client","web").header(HttpHeaders.AUTHORIZATION,bearer(account))).andExpect(status().isNoContent());
        due(); notifications.dispatch(); saveWeekly(120);
        assertThat(count("push_delivery")).isZero();
        verify(gateway,never()).send(anyString(),anyString(),anyString(),anyString());
    }

    private void subscribe(String token,String endpoint) throws Exception {
        mvc.perform(put("/api/members/me/push/subscription").header(HttpHeaders.AUTHORIZATION,bearer(token)).contentType("application/json")
                .content(json.writeValueAsString(Map.of("endpoint",endpoint,"keys",Map.of("p256dh",KEY,"auth",AUTH))))).andExpect(status().isNoContent());
    }
    private void saveWeekly(int end) throws Exception {
        mvc.perform(put("/api/members/me/weekly-availability").header(HttpHeaders.AUTHORIZATION,bearer(owner.memberAccessToken())).contentType("application/json").content(weekly(end)))
                .andExpect(status().isOk());
    }
    private String weekly(int end) { return "{\"slots\":[{\"dayOfWeek\":\"MONDAY\",\"startMinute\":0,\"endMinute\":"+end+"}]}"; }
    private long count(String table) { return jdbc.queryForObject("select count(*) from "+table,Long.class); }
    private void due() { jdbc.update("update push_delivery set due_at=now()-interval '1 second'"); }
    private static String bearer(String token) { return "Bearer "+token; }
}
