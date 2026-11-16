package github.partysync;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import github.partysync.group.GroupRequests;
import github.partysync.group.GroupResponses;
import github.partysync.group.GroupService;
import github.partysync.post.PostRepository;
import github.partysync.support.TestDatabaseInitializer;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = "spring.jpa.properties.hibernate.generate_statistics=true")
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@ActiveProfiles("test")
@ContextConfiguration(initializers = TestDatabaseInitializer.class)
class BoardApiIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired GroupService groups;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManagerFactory emf;
    @MockitoSpyBean PostRepository posts;
    private final List<Long> createdGroups = new ArrayList<>();
    private Access owner, author, other, foreign;

    @BeforeEach void setup() {
        var created = groups.create(new GroupRequests.Create("Board test", null, "Owner"));
        createdGroups.add(created.group().groupId());
        owner = access(created);
        var joined = groups.join(new GroupRequests.Join(created.inviteCode(), "Author"));
        author = new Access(owner.groupId, joined.member().memberId(), joined.memberAccessToken());
        var another = groups.join(new GroupRequests.Join(created.inviteCode(), "Other"));
        other = new Access(owner.groupId, another.member().memberId(), another.memberAccessToken());
        var outside = groups.create(new GroupRequests.Create("Outside test", null, "Outside"));
        createdGroups.add(outside.group().groupId()); foreign = access(outside);
    }

    @AfterEach void cleanup() {
        // 이번 테스트가 만든 그룹의 행만 정리한다. 스키마·Flyway·다른 DB는 변경하지 않는다.
        for (Long id : createdGroups) {
            jdbc.update("delete from post where group_id=?", id);
            jdbc.update("delete from game_category where group_id=?", id);
            jdbc.update("delete from group_member where group_id=?", id);
            jdbc.update("delete from groups where id=?", id);
        }
        createdGroups.clear();
    }

    @Test void ownerCategoryCrudNormalizesAndKeepsPosts() throws Exception {
        long category = category(owner, "  cafe\u0301  ");
        mvc.perform(auth(get(base(owner) + "/categories"), author)).andExpect(status().isOk()).andExpect(jsonPath("$[0].name").value("café"));
        long post = createPost(author, category, "Guide");
        mvc.perform(body(auth(put(base(owner) + "/categories/" + category), owner), Map.of("name", "Renamed", "description", "New description")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.description").value("New description"));
        mvc.perform(auth(get(base(owner) + "/posts/" + post), author)).andExpect(status().isOk()).andExpect(jsonPath("$.categoryName").value("Renamed"));
        mvc.perform(auth(delete(base(owner) + "/categories/" + category), owner)).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CATEGORY_IN_USE"));
        mvc.perform(auth(delete(base(owner) + "/posts/" + post), author)).andExpect(status().isNoContent());
        mvc.perform(auth(delete(base(owner) + "/categories/" + category), owner)).andExpect(status().isNoContent());
    }

    @Test void memberCannotManageCategoriesAndGroupsAreIsolated() throws Exception {
        long category = category(owner, "Game");
        mvc.perform(body(auth(post(base(owner) + "/categories"), author), Map.of("name", "New"))).andExpect(status().isForbidden());
        mvc.perform(body(auth(put(base(owner) + "/categories/" + category), author), Map.of("name", "New"))).andExpect(status().isForbidden());
        mvc.perform(auth(delete(base(owner) + "/categories/" + category), author)).andExpect(status().isForbidden());
        mvc.perform(auth(get(base(owner) + "/categories"), foreign)).andExpect(status().isForbidden());
        mvc.perform(body(auth(put(base(foreign) + "/categories/" + category), foreign), Map.of("name", "New"))).andExpect(status().isNotFound());
        mvc.perform(auth(delete(base(foreign) + "/categories/" + category), foreign)).andExpect(status().isNotFound());
    }

    @Test void uniqueNamesAreScopedToGroupAndUpdateExcludesItself() throws Exception {
        long first = category(owner, "Game");
        long second = category(owner, "Other"); category(foreign, "Game");
        mvc.perform(body(auth(post(base(owner) + "/categories"), owner), Map.of("name", " Game "))).andExpect(status().isConflict());
        mvc.perform(body(auth(put(base(owner) + "/categories/" + second), owner), Map.of("name", "Game"))).andExpect(status().isConflict());
        mvc.perform(body(auth(put(base(owner) + "/categories/" + first), owner), Map.of("name", "Game"))).andExpect(status().isOk());
    }

    @Test void concurrentCategoryCreationHasOneWinner() throws Exception {
        var barrier = new CyclicBarrier(2);
        Callable<Integer> create = () -> { barrier.await(10, TimeUnit.SECONDS); return mvc.perform(body(auth(post(base(owner) + "/categories"), owner), Map.of("name", "Concurrent"))).andReturn().getResponse().getStatus(); };
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(create); var second = executor.submit(create);
            assertThat(List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS))).containsExactlyInAnyOrder(201, 409);
        }
        assertThat(jdbc.queryForObject("select count(*) from game_category where group_id=? and name='Concurrent'", Long.class, owner.groupId)).isEqualTo(1);
    }

    @Test void fkStillBlocksDeleteIfPrecheckMissesAConcurrentPost() throws Exception {
        long category = category(owner, "Game"), post = createPost(author, category, "Kept");
        doReturn(false).when(posts).existsByGameCategoryId(category);
        mvc.perform(auth(delete(base(owner) + "/categories/" + category), owner)).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CATEGORY_CONFLICT"));
        mvc.perform(auth(get(base(owner) + "/posts/" + post), author)).andExpect(status().isOk());
    }

    @Test void onlyAuthorCanEditAndAuthorOrOwnerCanDelete() throws Exception {
        long category = category(owner, "Game"), next = category(owner, "Next"), post = createPost(author, category, "Original");
        var before = node(mvc.perform(auth(get(base(owner) + "/posts/" + post), author)).andReturn());
        for (Access denied : List.of(owner, other)) mvc.perform(body(auth(put(base(owner) + "/posts/" + post), denied), input(next, "Changed"))).andExpect(status().isForbidden());
        var changed = node(mvc.perform(body(auth(put(base(owner) + "/posts/" + post), author), input(next, " Changed "))).andExpect(status().isOk()).andReturn());
        assertThat(changed.get("authorId").asLong()).isEqualTo(author.memberId);
        assertThat(changed.get("createdAt").asString()).isEqualTo(before.get("createdAt").asString());
        assertThat(changed.get("updatedAt").asString()).isGreaterThanOrEqualTo(before.get("updatedAt").asString());
        assertThat(changed.get("categoryId").asLong()).isEqualTo(next);
        mvc.perform(auth(delete(base(owner) + "/posts/" + post), other)).andExpect(status().isForbidden());
        mvc.perform(auth(delete(base(owner) + "/posts/" + post), owner)).andExpect(status().isNoContent());
        mvc.perform(auth(get(base(owner) + "/posts/" + post), author)).andExpect(status().isNotFound());
        long own = createPost(author, category, "Own"); mvc.perform(auth(delete(base(owner) + "/posts/" + own), author)).andExpect(status().isNoContent());
    }

    @Test void requestCannotChooseAuthorAndCrossGroupIdsNeverResolve() throws Exception {
        long category = category(owner, "Game"), outside = category(foreign, "Outside");
        var spoof = Map.of("categoryId", category, "title", "Title", "content", "Body", "authorId", owner.memberId);
        long post = node(mvc.perform(body(auth(post(base(owner) + "/posts"), author), spoof)).andExpect(status().isCreated()).andReturn()).get("postId").asLong();
        mvc.perform(auth(get(base(owner) + "/posts/" + post), author)).andExpect(status().isOk()).andExpect(jsonPath("$.authorId").value(author.memberId)).andExpect(jsonPath("$.accessTokenHash").doesNotExist());
        mvc.perform(body(auth(post(base(owner) + "/posts"), author), input(outside, "Bad"))).andExpect(status().isNotFound());
        mvc.perform(body(auth(put(base(owner) + "/posts/" + post), author), input(outside, "Bad"))).andExpect(status().isNotFound());
        mvc.perform(auth(get(base(owner) + "/posts/" + post), foreign)).andExpect(status().isForbidden());
        mvc.perform(auth(get(base(foreign) + "/posts/" + post), foreign)).andExpect(status().isNotFound());
        mvc.perform(body(auth(put(base(foreign) + "/posts/" + post), foreign), input(outside, "Hidden"))).andExpect(status().isNotFound());
        mvc.perform(auth(delete(base(foreign) + "/posts/" + post), foreign)).andExpect(status().isNotFound());
    }

    @Test void listUsesStablePaginationCategoryFilterAndBoundedQueries() throws Exception {
        long a = category(owner, "A"), b = category(owner, "B");
        long first = createPost(author, a, "First"), second = createPost(author, b, "Second"), third = createPost(owner, a, "Third");
        jdbc.update("update post set created_at=timestamp '2026-11-01 00:00:00' where group_id=?", owner.groupId);
        var stats = emf.unwrap(SessionFactory.class).getStatistics(); stats.clear();
        mvc.perform(auth(get(base(owner) + "/posts?page=0&size=2"), author)).andExpect(status().isOk()).andExpect(jsonPath("$.content[0].postId").value(third))
                .andExpect(jsonPath("$.content[1].postId").value(second)).andExpect(jsonPath("$.totalElements").value(3)).andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.hasNext").value(true)).andExpect(jsonPath("$.content[0].content").doesNotExist());
        assertThat(stats.getPrepareStatementCount()).isLessThanOrEqualTo(4);
        mvc.perform(auth(get(base(owner) + "/posts?page=1&size=2"), author)).andExpect(jsonPath("$.content[0].postId").value(first)).andExpect(jsonPath("$.hasNext").value(false));
        mvc.perform(auth(get(base(owner) + "/posts?categoryId=" + a), author)).andExpect(jsonPath("$.totalElements").value(2));
        mvc.perform(auth(get(base(owner) + "/posts?categoryId=" + category(foreign, "Foreign")), author)).andExpect(status().isNotFound());
    }

    @ParameterizedTest @ValueSource(strings = {"page=-1", "size=0", "size=51", "page=2147483647&size=50", "categoryId=0", "size=abc"})
    void invalidPaginationIs400(String query) throws Exception { mvc.perform(auth(get(base(owner) + "/posts?" + query), author)).andExpect(status().isBadRequest()); }

    @ParameterizedTest @ValueSource(strings = {"", " ", "\n\t"})
    void blankPostInputIs400(String value) throws Exception {
        long category = category(owner, "Game");
        mvc.perform(body(auth(post(base(owner) + "/posts"), author), Map.of("categoryId", category, "title", value, "content", "Body"))).andExpect(status().isBadRequest());
        mvc.perform(body(auth(post(base(owner) + "/posts"), author), Map.of("categoryId", category, "title", "Title", "content", value))).andExpect(status().isBadRequest());
    }

    @Test void lengthLimitsAndMissingCategoryAre400() throws Exception {
        mvc.perform(body(auth(post(base(owner) + "/categories"), owner), Map.of("name", "x".repeat(101)))).andExpect(status().isBadRequest());
        mvc.perform(body(auth(post(base(owner) + "/categories"), owner), Map.of("name", "Name", "description", "x".repeat(2001)))).andExpect(status().isBadRequest());
        mvc.perform(body(auth(post(base(owner) + "/categories"), owner), Map.of("name", "  "))).andExpect(status().isBadRequest());
        long category = category(owner, "Game");
        mvc.perform(body(auth(post(base(owner) + "/posts"), author), input(category, "x".repeat(201)))).andExpect(status().isBadRequest());
        mvc.perform(body(auth(post(base(owner) + "/posts"), author), Map.of("categoryId", category, "title", "Title", "content", "x".repeat(20001)))).andExpect(status().isBadRequest());
        mvc.perform(body(auth(post(base(owner) + "/posts"), author), Map.of("title", "Title", "content", "Body"))).andExpect(status().isBadRequest());
    }

    @Test void allBoardEndpointsRequireAuthentication() throws Exception {
        mvc.perform(get(base(owner) + "/posts")).andExpect(status().isUnauthorized());
        mvc.perform(get(base(owner) + "/categories")).andExpect(status().isUnauthorized());
        mvc.perform(post(base(owner) + "/posts").contentType(MediaType.APPLICATION_JSON).content("{}" )).andExpect(status().isUnauthorized());
    }

    private long category(Access access, String name) throws Exception { return node(mvc.perform(body(auth(post(base(access) + "/categories"), access), Map.of("name", name))).andExpect(status().isCreated()).andReturn()).get("categoryId").asLong(); }
    private long createPost(Access access, long category, String title) throws Exception { return node(mvc.perform(body(auth(post(base(access) + "/posts"), access), input(category, title))).andExpect(status().isCreated()).andReturn()).get("postId").asLong(); }
    private Map<String, Object> input(long category, String title) { return Map.of("categoryId", category, "title", title, "content", "Guide\nhttps://example.com/guide"); }
    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request, Access access) { return request.header("Authorization", "Bearer " + access.token); }
    private MockHttpServletRequestBuilder body(MockHttpServletRequestBuilder request, Object value) { return request.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(value)); }
    private JsonNode node(MvcResult result) { return json.readTree(result.getResponse().getContentAsByteArray()); }
    private String base(Access access) { return "/api/groups/" + access.groupId; }
    private Access access(GroupResponses.Created created) { return new Access(created.group().groupId(), created.member().memberId(), created.memberAccessToken()); }
    private record Access(long groupId, long memberId, String token) { @Override public String toString() { return "Access[redacted]"; } }
}
