package github.partysync.availability;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import github.partysync.group.GroupRequests;
import github.partysync.group.GroupResponses;
import github.partysync.group.GroupService;
import github.partysync.support.TestDatabaseInitializer;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import tools.jackson.databind.ObjectMapper;

import static github.partysync.availability.AvailabilityRequests.*;
import static github.partysync.availability.AvailabilityResponses.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** TEST_DB_*의 전용 PostgreSQL에서 실제 인증·잠금·교체·조회·계산을 검증한다. */
@SpringBootTest(properties = "app.security.allowed-origins=http://localhost:5173")
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@ActiveProfiles("test")
@ContextConfiguration(initializers = TestDatabaseInitializer.class)
class AvailabilityApiIntegrationTest {
    private static final LocalDate MONDAY = LocalDate.of(2026, 11, 16);
    private static final String WEEKLY = "/api/members/me/weekly-availability";
    private static final String OVERRIDES = "/api/members/me/availability-overrides";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired GroupService groups;
    @Autowired EntityManagerFactory entityManagerFactory;
    @MockitoSpyBean WeeklyAvailabilityRepository weekly;
    @MockitoSpyBean AvailabilityOverrideSlotRepository overrideSlots;

    GroupResponses.Created owner;
    GroupResponses.Joined member;
    GroupResponses.Created outsider;

    @BeforeEach
    void setUp() {
        owner = groups.create(new GroupRequests.Create("Raid", "Schedule", "Owner"));
        member = groups.join(new GroupRequests.Join(owner.inviteCode(), "Member"));
        outsider = groups.create(new GroupRequests.Create("Other", null, "Outsider"));
    }

    @AfterEach
    void cleanDatabase() {
        jdbc.execute("TRUNCATE TABLE groups RESTART IDENTITY CASCADE");
    }

    @Test
    void weeklyReplacementSortsDaysAndMergesAdjacentSlotsAndEmptyArrayClearsAll() throws Exception {
        putWeekly(owner.memberAccessToken(), List.of(weeklySlot(DayOfWeek.TUESDAY, 1200, 1380),
                weeklySlot(DayOfWeek.MONDAY, 1320, 1440), weeklySlot(DayOfWeek.MONDAY, 1140, 1200),
                weeklySlot(DayOfWeek.MONDAY, 1200, 1260)));
        assertThat(getWeekly(owner.memberAccessToken()).slots()).containsExactly(
                new AvailabilityResponses.WeeklySlot(DayOfWeek.MONDAY, 1140, 1260),
                new AvailabilityResponses.WeeklySlot(DayOfWeek.MONDAY, 1320, 1440),
                new AvailabilityResponses.WeeklySlot(DayOfWeek.TUESDAY, 1200, 1380));
        putWeekly(owner.memberAccessToken(), List.of(weeklySlot(DayOfWeek.SUNDAY, 0, 60)));
        assertThat(getWeekly(owner.memberAccessToken()).slots()).containsExactly(
                new AvailabilityResponses.WeeklySlot(DayOfWeek.SUNDAY, 0, 60));
        assertThat(jdbc.queryForObject("select count(*) from weekly_availability", Long.class)).isEqualTo(1);
        putWeekly(owner.memberAccessToken(), List.of());
        assertThat(getWeekly(owner.memberAccessToken()).slots()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "{}", "{\"slots\":null}", "{\"slots\":[null]}",
            "{\"slots\":[{\"dayOfWeek\":\"HOLIDAY\",\"startMinute\":0,\"endMinute\":60}]}",
            "{\"slots\":[{\"dayOfWeek\":\"MONDAY\",\"startMinute\":60,\"endMinute\":60}]}",
            "{\"slots\":[{\"dayOfWeek\":\"MONDAY\",\"startMinute\":-30,\"endMinute\":60}]}",
            "{\"slots\":[{\"dayOfWeek\":\"MONDAY\",\"startMinute\":0,\"endMinute\":1470}]}",
            "{\"slots\":[{\"dayOfWeek\":\"MONDAY\",\"startMinute\":15,\"endMinute\":60}]}",
            "{\"slots\":[{\"dayOfWeek\":\"MONDAY\",\"startMinute\":30.5,\"endMinute\":60}]}",
            "{\"slots\":[{\"dayOfWeek\":\"MONDAY\",\"startMinute\":0,\"endMinute\":90},{\"dayOfWeek\":\"MONDAY\",\"startMinute\":60,\"endMinute\":120}]}"})
    void invalidWeeklyInputNeverDeletesExistingSchedule(String body) throws Exception {
        putWeekly(owner.memberAccessToken(), List.of(weeklySlot(DayOfWeek.MONDAY, 1140, 1380)));
        mvc.perform(put(WEEKLY).header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken()))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());
        assertThat(getWeekly(owner.memberAccessToken()).slots()).containsExactly(
                new AvailabilityResponses.WeeklySlot(DayOfWeek.MONDAY, 1140, 1380));
    }

    @Test
    void weeklySaveFailureRollsBackPriorBulkDelete() throws Exception {
        putWeekly(owner.memberAccessToken(), List.of(weeklySlot(DayOfWeek.MONDAY, 1140, 1380)));
        doThrow(new IllegalStateException("forced save failure")).when(weekly).saveAllAndFlush(any());
        mvc.perform(put(WEEKLY).header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(new WeeklyUpdate(
                                List.of(weeklySlot(DayOfWeek.TUESDAY, 600, 660))))))
                .andExpect(status().isInternalServerError());
        assertThat(getWeekly(owner.memberAccessToken()).slots()).containsExactly(
                new AvailabilityResponses.WeeklySlot(DayOfWeek.MONDAY, 1140, 1380));
    }

    @Test
    void overrideReplacesWeeklyPreservesParentOnUpdateAndDeletionRestoresWeekly() throws Exception {
        putWeekly(owner.memberAccessToken(), List.of(weeklySlot(DayOfWeek.MONDAY, 1140, 1380)));
        putOverride(owner.memberAccessToken(), MONDAY, List.of(inputSlot(1260, 1320), inputSlot(1320, 1380)));
        Long originalId = jdbc.queryForObject("select id from availability_override", Long.class);
        assertThat(ownerOn(MONDAY).source()).isEqualTo(Source.OVERRIDE);
        assertThat(ownerOn(MONDAY).slots()).containsExactly(slot(1260, 1380));
        assertThat(ownerOn(MONDAY.plusWeeks(1)).source()).isEqualTo(Source.WEEKLY);
        assertThat(ownerOn(MONDAY.plusWeeks(1)).slots()).containsExactly(slot(1140, 1380));

        putOverride(owner.memberAccessToken(), MONDAY, List.of(inputSlot(0, 60), inputSlot(120, 180)));
        assertThat(jdbc.queryForObject("select id from availability_override", Long.class)).isEqualTo(originalId);
        assertThat(ownerOn(MONDAY).slots()).containsExactly(slot(0, 60), slot(120, 180));
        putOverride(owner.memberAccessToken(), MONDAY, List.of());
        assertThat(ownerOn(MONDAY).source()).isEqualTo(Source.OVERRIDE);
        assertThat(ownerOn(MONDAY).slots()).isEmpty();
        mvc.perform(delete(OVERRIDES + "/" + MONDAY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken())))
                .andExpect(status().isNoContent());
        mvc.perform(delete(OVERRIDES + "/" + MONDAY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken())))
                .andExpect(status().isNoContent());
        assertThat(ownerOn(MONDAY).source()).isEqualTo(Source.WEEKLY);
        assertThat(ownerOn(MONDAY).slots()).containsExactly(slot(1140, 1380));
        assertThat(jdbc.queryForObject("select count(*) from availability_override_slot", Long.class)).isZero();
    }

    @Test
    void overrideListIncludesEmptyOverridesAndInclusiveDateBoundaries() throws Exception {
        putOverride(owner.memberAccessToken(), MONDAY.plusDays(1), List.of(inputSlot(0, 1440)));
        putOverride(owner.memberAccessToken(), MONDAY, List.of());
        putOverride(owner.memberAccessToken(), MONDAY.plusDays(2), List.of(inputSlot(600, 660)));
        mvc.perform(get(OVERRIDES).param("from", MONDAY.toString()).param("to", MONDAY.plusDays(1).toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].date").value(MONDAY.toString()))
                .andExpect(jsonPath("$[0].slots").isEmpty())
                .andExpect(jsonPath("$[1].date").value(MONDAY.plusDays(1).toString()))
                .andExpect(jsonPath("$[1].slots[0].endMinute").value(1440));
    }

    @Test
    void deletingPopulatedOverrideRemovesSlotsAndRestoresBaseline() throws Exception {
        putWeekly(owner.memberAccessToken(), List.of(weeklySlot(DayOfWeek.MONDAY, 1140, 1380)));
        putOverride(owner.memberAccessToken(), MONDAY, List.of(inputSlot(1260, 1380)));
        assertThat(jdbc.queryForObject("select count(*) from availability_override_slot", Long.class)).isEqualTo(1);
        mvc.perform(delete(OVERRIDES + "/" + MONDAY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken())))
                .andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("select count(*) from availability_override_slot", Long.class)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from availability_override", Long.class)).isZero();
        assertThat(ownerOn(MONDAY).slots()).containsExactly(slot(1140, 1380));
        assertThat(ownerOn(MONDAY).source()).isEqualTo(Source.WEEKLY);
    }

    @Test
    void replacingWeeklyScheduleDoesNotEraseDateOverrides() throws Exception {
        putOverride(owner.memberAccessToken(), MONDAY, List.of(inputSlot(1260, 1380)));
        putWeekly(owner.memberAccessToken(), List.of(weeklySlot(DayOfWeek.MONDAY, 0, 1440)));
        assertThat(ownerOn(MONDAY).source()).isEqualTo(Source.OVERRIDE);
        assertThat(ownerOn(MONDAY).slots()).containsExactly(slot(1260, 1380));
        putWeekly(owner.memberAccessToken(), List.of());
        assertThat(ownerOn(MONDAY).slots()).containsExactly(slot(1260, 1380));
        assertThat(ownerOn(MONDAY.plusWeeks(1)).slots()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"slots\":null}", "{\"slots\":[null]}",
            "{\"slots\":[{\"startMinute\":0,\"endMinute\":60.5}]}",
            "{\"slots\":[{\"startMinute\":120,\"endMinute\":60}]}",
            "{\"slots\":[{\"startMinute\":0,\"endMinute\":45}]}",
            "{\"slots\":[{\"startMinute\":0,\"endMinute\":90},{\"startMinute\":60,\"endMinute\":120}]}"})
    void invalidOverrideInputPreservesPreviousSlots(String body) throws Exception {
        putOverride(owner.memberAccessToken(), MONDAY, List.of(inputSlot(600, 660)));
        mvc.perform(put(OVERRIDES + "/" + MONDAY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken()))
                        .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        assertThat(ownerOn(MONDAY).slots()).containsExactly(slot(600, 660));
    }

    @Test
    void slotSaveFailureRollsBackNewParentAndExistingSlotDeletion() throws Exception {
        putOverride(owner.memberAccessToken(), MONDAY, List.of(inputSlot(600, 660)));
        doThrow(new IllegalStateException("forced slot failure")).when(overrideSlots).saveAllAndFlush(any());
        for (LocalDate date : List.of(MONDAY, MONDAY.plusDays(1))) {
            mvc.perform(put(OVERRIDES + "/" + date)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken()))
                            .contentType(MediaType.APPLICATION_JSON).content("{\"slots\":[{\"startMinute\":120,\"endMinute\":180}]}"))
                    .andExpect(status().isInternalServerError());
        }
        assertThat(jdbc.queryForObject("select count(*) from availability_override", Long.class)).isEqualTo(1);
        assertThat(ownerOn(MONDAY).slots()).containsExactly(slot(600, 660));
    }

    @Test
    void memberIdInBodyCannotModifyOtherMembersEvenForOwner() throws Exception {
        mvc.perform(put(WEEKLY).header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken()))
                        .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of(
                                "memberId", member.member().memberId(), "slots",
                                List.of(weeklySlot(DayOfWeek.MONDAY, 600, 660))))))
                .andExpect(status().isOk());
        assertThat(getWeekly(owner.memberAccessToken()).slots()).hasSize(1);
        assertThat(getWeekly(member.memberAccessToken()).slots()).isEmpty();
        mvc.perform(put(OVERRIDES + "/" + MONDAY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken()))
                        .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of(
                                "memberId", member.member().memberId(), "slots", List.of(inputSlot(600, 660))))))
                .andExpect(status().isOk());
        mvc.perform(get(OVERRIDES).param("from", MONDAY.toString()).param("to", MONDAY.toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(member.memberAccessToken())))
                .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
    }

    @Test
    void groupProjectionAndCommonCountsUseOverridePriorityAndSortedMemberIds() throws Exception {
        putWeekly(owner.memberAccessToken(), List.of(weeklySlot(DayOfWeek.MONDAY, 1140, 1380)));
        putWeekly(member.memberAccessToken(), List.of(weeklySlot(DayOfWeek.MONDAY, 1200, 1320)));
        putOverride(owner.memberAccessToken(), MONDAY, List.of(inputSlot(1260, 1380)));
        var projection = groupAvailability(MONDAY, MONDAY.plusDays(1));
        assertThat(projection.days()).hasSize(2);
        assertThat(projection.days().getFirst().members().stream().map(MemberAvailability::memberId))
                .containsExactly(owner.member().memberId(), member.member().memberId());
        assertThat(projection.days().getLast().members()).allSatisfy(value -> {
            assertThat(value.source()).isEqualTo(Source.WEEKLY);
            assertThat(value.slots()).isEmpty();
        });
        GroupCommonAvailability common = commonAvailability(MONDAY, MONDAY);
        assertThat(common.days().getFirst().totalMembers()).isEqualTo(2);
        assertThat(common.days().getFirst().timeSlots().stream().filter(CountedSlot::allAvailable))
                .containsExactly(new CountedSlot(1260, 1320, 2,
                        List.of(owner.member().memberId(), member.member().memberId()), true));
        putOverride(owner.memberAccessToken(), MONDAY, List.of());
        assertThat(commonAvailability(MONDAY, MONDAY).days().getFirst().timeSlots()).noneMatch(CountedSlot::allAvailable);
    }

    @ParameterizedTest
    @CsvSource({"PUT,/api/members/me/weekly-availability", "GET,/api/members/me/weekly-availability",
            "PUT,/api/members/me/availability-overrides/2026-11-16",
            "DELETE,/api/members/me/availability-overrides/2026-11-16",
            "GET,/api/members/me/availability-overrides",
            "GET,/api/groups/1/availability", "GET,/api/groups/1/common-availability"})
    void everyScheduleEndpointRequiresAuthentication(String method, String path) throws Exception {
        mvc.perform(MockMvcRequestBuilders.request(org.springframework.http.HttpMethod.valueOf(method), path)
                        .param("from", MONDAY.toString()).param("to", MONDAY.toString())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"slots\":[]}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void otherGroupsAreForbiddenAndMissingGroupsFollowExisting404Policy() throws Exception {
        for (String endpoint : List.of("availability", "common-availability")) {
            mvc.perform(get("/api/groups/" + owner.group().groupId() + "/" + endpoint)
                            .param("from", MONDAY.toString()).param("to", MONDAY.toString())
                            .header(HttpHeaders.AUTHORIZATION, bearer(outsider.memberAccessToken())))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/api/groups/999999/" + endpoint)
                            .param("from", MONDAY.toString()).param("to", MONDAY.toString())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken())))
                    .andExpect(status().isNotFound());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"?from=2026-11-17&to=2026-11-16", "?from=2026-11-01&to=2026-12-02",
            "?from=invalid&to=2026-11-16", "?from=2026-11-16", "?to=2026-11-16"})
    void invalidOrMissingDateRangeIs400(String query) throws Exception {
        for (String path : List.of(OVERRIDES, "/api/groups/" + owner.group().groupId() + "/availability",
                "/api/groups/" + owner.group().groupId() + "/common-availability")) {
            mvc.perform(get(path + query).header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken())))
                    .andExpect(status().isBadRequest());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"2026-02-30", "not-a-date"})
    void invalidOverridePathDateIs400(String date) throws Exception {
        mvc.perform(put(OVERRIDES + "/" + date).contentType(MediaType.APPLICATION_JSON).content("{\"slots\":[]}")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken())))
                .andExpect(status().isBadRequest());
        mvc.perform(delete(OVERRIDES + "/" + date)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void excessiveInputSizeIsRejectedBeforeAnyWrite() throws Exception {
        mvc.perform(put(WEEKLY).header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken()))
                        .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(
                                new WeeklyUpdate(Collections.nCopies(337, weeklySlot(DayOfWeek.MONDAY, 0, 30))))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        mvc.perform(put(OVERRIDES + "/" + MONDAY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken()))
                        .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(
                                new OverrideUpdate(Collections.nCopies(49, inputSlot(0, 30))))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        assertThat(jdbc.queryForObject("select count(*) from weekly_availability", Long.class)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from availability_override", Long.class)).isZero();
    }

    @Test
    void concurrentOverrideWritesLeaveExactlyOneParentAndOneWholePayload() throws Exception {
        List<AvailabilityRequests.Slot> first = List.of(inputSlot(0, 60), inputSlot(120, 180));
        List<AvailabilityRequests.Slot> second = List.of(inputSlot(600, 660));
        runConcurrently(
                () -> rawPut(OVERRIDES + "/" + MONDAY, new OverrideUpdate(first)),
                () -> rawPut(OVERRIDES + "/" + MONDAY, new OverrideUpdate(second)));
        assertThat(jdbc.queryForObject("select count(*) from availability_override", Long.class)).isEqualTo(1);
        assertThat(List.of(List.of(slot(0, 60), slot(120, 180)), List.of(slot(600, 660))))
                .contains(ownerOn(MONDAY).slots());
    }

    @Test
    void concurrentWeeklyReplacementNeverMixesTwoPayloads() throws Exception {
        var first = List.of(weeklySlot(DayOfWeek.MONDAY, 0, 60), weeklySlot(DayOfWeek.TUESDAY, 120, 180));
        var second = List.of(weeklySlot(DayOfWeek.WEDNESDAY, 600, 660), weeklySlot(DayOfWeek.FRIDAY, 900, 960));
        runConcurrently(() -> rawPut(WEEKLY, new WeeklyUpdate(first)),
                () -> rawPut(WEEKLY, new WeeklyUpdate(second)));
        var expectedFirst = List.of(new AvailabilityResponses.WeeklySlot(DayOfWeek.MONDAY, 0, 60),
                new AvailabilityResponses.WeeklySlot(DayOfWeek.TUESDAY, 120, 180));
        var expectedSecond = List.of(new AvailabilityResponses.WeeklySlot(DayOfWeek.WEDNESDAY, 600, 660),
                new AvailabilityResponses.WeeklySlot(DayOfWeek.FRIDAY, 900, 960));
        assertThat(List.of(expectedFirst, expectedSecond)).contains(getWeekly(owner.memberAccessToken()).slots());
    }

    @Test
    void queryCountDoesNotGrowWithDateRangeAndThirtyOneDaysAreAllowed() throws Exception {
        putWeekly(owner.memberAccessToken(), List.of(weeklySlot(DayOfWeek.MONDAY, 0, 1440)));
        putOverride(owner.memberAccessToken(), MONDAY, List.of(inputSlot(600, 660)));
        var statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        boolean wasEnabled = statistics.isStatisticsEnabled();
        statistics.setStatisticsEnabled(true);
        try {
            statistics.clear();
            groupAvailability(MONDAY, MONDAY);
            long shortRangeQueries = statistics.getPrepareStatementCount();
            statistics.clear();
            assertThat(groupAvailability(MONDAY, MONDAY.plusDays(30)).days()).hasSize(31);
            assertThat(statistics.getPrepareStatementCount()).isEqualTo(shortRangeQueries).isLessThanOrEqualTo(8);
        } finally {
            statistics.setStatisticsEnabled(wasEnabled);
        }
    }

    @Test
    void corsPreflightAllowsWeeklyPutAndOverrideDelete() throws Exception {
        for (String method : List.of("PUT", "DELETE")) {
            mvc.perform(options(OVERRIDES + "/" + MONDAY)
                            .header(HttpHeaders.ORIGIN, "http://localhost:5173")
                            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, method)
                            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "authorization,content-type"))
                    .andExpect(status().isOk())
                    .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS,
                            org.hamcrest.Matchers.containsString(method)));
        }
    }

    private AvailabilityRequests.WeeklySlot weeklySlot(DayOfWeek day, int start, int end) {
        return new AvailabilityRequests.WeeklySlot(day, start, end);
    }
    private AvailabilityRequests.Slot inputSlot(int start, int end) { return new AvailabilityRequests.Slot(start, end); }
    private AvailabilityResponses.Slot slot(int start, int end) { return new AvailabilityResponses.Slot(start, end); }
    private String bearer(String token) { return "Bearer " + token; }

    private MvcResult putWeekly(String token, List<AvailabilityRequests.WeeklySlot> values) throws Exception {
        return mvc.perform(put(WEEKLY).header(HttpHeaders.AUTHORIZATION, bearer(token))
                        .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(new WeeklyUpdate(values))))
                .andExpect(status().isOk()).andReturn();
    }
    private void putOverride(String token, LocalDate date, List<AvailabilityRequests.Slot> values) throws Exception {
        mvc.perform(put(OVERRIDES + "/" + date).header(HttpHeaders.AUTHORIZATION, bearer(token))
                        .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(new OverrideUpdate(values))))
                .andExpect(status().isOk());
    }
    private WeeklySchedule getWeekly(String token) throws Exception {
        String body = mvc.perform(get(WEEKLY).header(HttpHeaders.AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return mapper.readValue(body, WeeklySchedule.class);
    }
    private GroupAvailability groupAvailability(LocalDate from, LocalDate to) throws Exception {
        String body = mvc.perform(get("/api/groups/" + owner.group().groupId() + "/availability")
                        .param("from", from.toString()).param("to", to.toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken())))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return mapper.readValue(body, GroupAvailability.class);
    }
    private MemberAvailability ownerOn(LocalDate date) throws Exception {
        return groupAvailability(date, date).days().getFirst().members().getFirst();
    }
    private GroupCommonAvailability commonAvailability(LocalDate from, LocalDate to) throws Exception {
        String body = mvc.perform(get("/api/groups/" + owner.group().groupId() + "/common-availability")
                        .param("from", from.toString()).param("to", to.toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken())))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return mapper.readValue(body, GroupCommonAvailability.class);
    }
    private int rawPut(String path, Object payload) throws Exception {
        return mvc.perform(put(path).header(HttpHeaders.AUTHORIZATION, bearer(owner.memberAccessToken()))
                        .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(payload)))
                .andReturn().getResponse().getStatus();
    }
    private void runConcurrently(Callable<Integer> first, Callable<Integer> second) throws Exception {
        CyclicBarrier start = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var a = executor.submit(() -> { start.await(10, TimeUnit.SECONDS); return first.call(); });
            var b = executor.submit(() -> { start.await(10, TimeUnit.SECONDS); return second.call(); });
            assertThat(List.of(a.get(30, TimeUnit.SECONDS), b.get(30, TimeUnit.SECONDS))).containsOnly(200);
        }
    }
}
