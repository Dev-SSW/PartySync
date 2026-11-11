package github.partysync;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.stream.Stream;

import github.partysync.availability.AvailabilityOverride;
import github.partysync.availability.AvailabilityOverrideRepository;
import github.partysync.availability.AvailabilityOverrideSlot;
import github.partysync.availability.AvailabilityOverrideSlotRepository;
import github.partysync.availability.WeeklyAvailability;
import github.partysync.availability.WeeklyAvailabilityRepository;
import github.partysync.category.GameCategory;
import github.partysync.category.GameCategoryRepository;
import github.partysync.group.Group;
import github.partysync.group.GroupRepository;
import github.partysync.groupmember.GroupMember;
import github.partysync.groupmember.GroupMemberRepository;
import github.partysync.groupmember.GroupRole;
import github.partysync.post.Post;
import github.partysync.post.PostRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import github.partysync.support.TestDatabaseInitializer;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * PostgreSQL에서 Flyway·Hibernate 매핑·Repository·DB 제약과 삭제 정책을 검증하고 테스트별로 롤백한다.
 */
@SpringBootTest
@ActiveProfiles("test")
@ContextConfiguration(initializers = TestDatabaseInitializer.class)
@Transactional
class PartysyncApplicationTests {
    @Autowired GroupRepository groups;
    @Autowired GroupMemberRepository members;
    @Autowired WeeklyAvailabilityRepository weekly;
    @Autowired AvailabilityOverrideRepository overrides;
    @Autowired AvailabilityOverrideSlotRepository slots;
    @Autowired GameCategoryRepository categories;
    @Autowired PostRepository posts;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    Group group;
    GroupMember member;
    GameCategory category;
    AvailabilityOverride override;

    @BeforeEach
    void setUp() {
        group = groups.saveAndFlush(new Group("Raid group", null, "test-invite"));
        member = members.saveAndFlush(new GroupMember(group, "Owner", GroupRole.OWNER, "test-hash-only"));
        category = categories.saveAndFlush(new GameCategory(group, "Game", null));
        override = overrides.saveAndFlush(new AvailabilityOverride(member, LocalDate.of(2026, 11, 10)));
    }

    @Test
    void migratesValidatesAndRoundTripsAllRepositories() {
        weekly.saveAndFlush(new WeeklyAvailability(member, DayOfWeek.MONDAY, 1140, 1440));
        slots.saveAndFlush(new AvailabilityOverrideSlot(override, 0, 180));
        Post post = posts.saveAndFlush(new Post(group, category, member, "Guide", "https://example.com"));
        assertThat(group.getCreatedAt()).isNotNull();
        assertThat(group.getUpdatedAt()).isNotNull();
        assertThat(member.getJoinedAt()).isNotNull();
        assertThat(category.getCreatedAt()).isNotNull();
        assertThat(override.getCreatedAt()).isNotNull();
        assertThat(post.getCreatedAt()).isNotNull();
        assertThat(post.getUpdatedAt()).isNotNull();
        entityManager.clear();

        assertThat(groups.findByInviteCode("test-invite")).isPresent();
        assertThat(members.findAllByGroupId(group.getId())).hasSize(1);
        assertThat(members.countByGroupId(group.getId())).isEqualTo(1);
        assertThat(members.existsByGroupIdAndNickname(group.getId(), "Owner")).isTrue();
        assertThat(weekly.findAllByGroupMemberIdAndDayOfWeekOrderByStartMinuteAsc(
                member.getId(), DayOfWeek.MONDAY)).singleElement()
                .satisfies(value -> assertThat(value.getEndMinute()).isEqualTo(1440));
        assertThat(overrides.findByGroupMemberIdAndTargetDate(member.getId(), override.getTargetDate())).isPresent();
        assertThat(slots.findAllByAvailabilityOverrideIdOrderByStartMinuteAsc(override.getId())).hasSize(1);
        assertThat(categories.findAllByGroupId(group.getId())).hasSize(1);
        assertThat(posts.findAllByGroupId(group.getId(), PageRequest.of(0, 10))).hasSize(1);
        Post loaded = posts.findById(post.getId()).orElseThrow();
        assertThat(loaded.getGroup().getId()).isEqualTo(group.getId());
        assertThat(loaded.getAuthor().getId()).isEqualTo(member.getId());
        assertThat(loaded.getGameCategory().getId()).isEqualTo(category.getId());
        assertThat(jdbc.queryForObject(
                "select count(*) from flyway_schema_history where version = '1' and success",
                Integer.class)).isEqualTo(1);
    }

    @Test
    void sameNicknameAndCategoryNameAreAllowedInDifferentGroups() {
        Group other = groups.saveAndFlush(new Group("Other", null, "other-invite"));
        members.saveAndFlush(new GroupMember(other, "Owner", GroupRole.MEMBER, "other-hash"));
        categories.saveAndFlush(new GameCategory(other, "Game", null));
        assertThat(members.countByGroupId(other.getId())).isEqualTo(1);
        assertThat(categories.findAllByGroupId(other.getId())).hasSize(1);
    }

    @Test
    void overrideWithoutSlotsIsPersistable() {
        assertThat(overrides.findByGroupMemberIdAndTargetDate(member.getId(), override.getTargetDate())).isPresent();
        assertThat(slots.findAllByAvailabilityOverrideIdOrderByStartMinuteAsc(override.getId())).isEmpty();
    }

    @Test
    void deletingOverrideCascadesToSlotsInDatabase() {
        Long slotId = slots.saveAndFlush(new AvailabilityOverrideSlot(override, 60, 120)).getId();
        overrides.delete(override);
        overrides.flush();
        // ORM 삭제와 DB 연쇄 삭제 후 영속성 캐시가 아닌 DB 결과를 확인한다.
        entityManager.clear();
        assertThat(slots.findById(slotId)).isEmpty();
        assertThat(overrides.findById(override.getId())).isEmpty();
    }

    @Test
    void deletingReloadedOverrideAlsoRemovesExistingSlots() {
        Long overrideId = override.getId();
        Long slotId = slots.saveAndFlush(new AvailabilityOverrideSlot(override, 60, 120)).getId();
        entityManager.clear();
        overrides.deleteById(overrideId);
        overrides.flush();
        entityManager.clear();
        assertThat(slots.findById(slotId)).isEmpty();
    }

    @Test
    void directSqlDeleteAlsoCascadesToSlots() {
        Long overrideId = override.getId();
        Long slotId = slots.saveAndFlush(new AvailabilityOverrideSlot(override, 60, 120)).getId();
        entityManager.clear();
        jdbc.update("delete from availability_override where id = ?", overrideId);
        assertThat(slots.findById(slotId)).isEmpty();
    }

    @Test
    void rejectsDuplicateInviteCode() {
        assertThatThrownBy(() -> jdbc.update("""
                insert into groups(name, invite_code, created_at, updated_at)
                values ('Duplicate', 'test-invite', localtimestamp, localtimestamp)
                """)).isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uk_groups_invite_code");
    }

    @Test
    void rejectsDuplicateNicknameInGroup() {
        assertThatThrownBy(() -> jdbc.update("""
                insert into group_member(group_id, nickname, role, access_token_hash, joined_at)
                values (?, 'Owner', 'MEMBER', 'hash', localtimestamp)
                """, group.getId())).isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uk_member_group_nickname");
    }

    @Test
    void rejectsDuplicateCategoryInGroup() {
        assertThatThrownBy(() -> jdbc.update("""
                insert into game_category(group_id, name, created_at) values (?, 'Game', localtimestamp)
                """, group.getId())).isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uk_category_group_name");
    }

    @Test
    void rejectsDuplicateOverrideOnDate() {
        assertThatThrownBy(() -> jdbc.update("""
                insert into availability_override(group_member_id, target_date, created_at)
                values (?, ?, localtimestamp)
                """, member.getId(), override.getTargetDate())).isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uk_override_member_date");
    }

    static Stream<Arguments> invalidRanges() {
        return Stream.of("weekly", "override").flatMap(kind -> Stream.of(
                Arguments.of(kind, -1, 60), Arguments.of(kind, 60, 60),
                Arguments.of(kind, 120, 60), Arguments.of(kind, 0, 1441)));
    }

    @ParameterizedTest
    @MethodSource("invalidRanges")
    void databaseRejectsInvalidRangesEvenWhenJpaValidationIsBypassed(String kind, int start, int end) {
        String sql = kind.equals("weekly")
                ? "insert into weekly_availability(group_member_id, day_of_week, start_minute, end_minute) values (?, 'MONDAY', ?, ?)"
                : "insert into availability_override_slot(availability_override_id, start_minute, end_minute) values (?, ?, ?)";
        Long parentId = kind.equals("weekly") ? member.getId() : override.getId();
        assertThatThrownBy(() -> jdbc.update(sql, parentId, start, end))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining(kind.equals("weekly") ? "ck_weekly_minutes" : "ck_slot_minutes");
    }

    @Test
    void rejectsInvalidRole() {
        assertThatThrownBy(() -> jdbc.update("""
                insert into group_member(group_id, nickname, role, access_token_hash, joined_at)
                values (?, 'Other', 'ADMIN', 'hash', localtimestamp)
                """, group.getId())).isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_member_role");
    }

    @Test
    void rejectsInvalidDayOfWeek() {
        assertThatThrownBy(() -> jdbc.update("""
                insert into weekly_availability(group_member_id, day_of_week, start_minute, end_minute)
                values (?, 'HOLIDAY', 0, 60)
                """, member.getId())).isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_weekly_day");
    }

    @Test
    void rejectsNonexistentForeignKey() {
        assertThatThrownBy(() -> jdbc.update("""
                insert into availability_override(group_member_id, target_date, created_at)
                values (-1, current_date, localtimestamp)
                """)).isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fk_override_member");
    }

    @Test
    void rejectsNullRequiredColumn() {
        assertThatThrownBy(() -> jdbc.update("""
                insert into groups(name, invite_code, created_at, updated_at)
                values (null, 'null-test', localtimestamp, localtimestamp)
                """)).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void rejectsAuthorFromDifferentGroup() {
        Group other = groups.saveAndFlush(new Group("Other", null, "other-invite"));
        GroupMember outsider = members.saveAndFlush(new GroupMember(other, "Guest", GroupRole.MEMBER, "hash"));
        assertThatThrownBy(() -> insertPost(category.getId(), outsider.getId()))
                .isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("fk_post_author_group");
    }

    @Test
    void rejectsCategoryFromDifferentGroup() {
        Group other = groups.saveAndFlush(new Group("Other", null, "other-invite"));
        GameCategory otherCategory = categories.saveAndFlush(new GameCategory(other, "Other Game", null));
        assertThatThrownBy(() -> insertPost(otherCategory.getId(), member.getId()))
                .isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("fk_post_category_group");
    }

    @Test
    void allowsAdjacentIntervalsAndRejectsExactDuplicates() {
        weekly.saveAndFlush(new WeeklyAvailability(member, DayOfWeek.MONDAY, 60, 120));
        weekly.saveAndFlush(new WeeklyAvailability(member, DayOfWeek.MONDAY, 120, 180));
        assertThatThrownBy(() -> jdbc.update("""
                insert into weekly_availability(group_member_id, day_of_week, start_minute, end_minute)
                values (?, 'MONDAY', 60, 120)
                """, member.getId())).isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uk_weekly_exact_slot");
    }

    @Test
    void rejectsDuplicateOverrideSlot() {
        slots.saveAndFlush(new AvailabilityOverrideSlot(override, 60, 120));
        assertThatThrownBy(() -> jdbc.update("""
                insert into availability_override_slot(availability_override_id, start_minute, end_minute)
                values (?, 60, 120)
                """, override.getId())).isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uk_override_exact_slot");
    }

    private void insertPost(Long categoryId, Long authorId) {
        jdbc.update("""
                insert into post(group_id, game_category_id, author_id, title, created_at, updated_at)
                values (?, ?, ?, 'Guide', localtimestamp, localtimestamp)
                """, group.getId(), categoryId, authorId);
    }
}
