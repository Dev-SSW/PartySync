package github.partysync.availability;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import github.partysync.groupmember.GroupMember;
import github.partysync.common.MinuteRange;
import java.time.DayOfWeek;

/** 매주 같은 요일에 반복되는 가능 시간 */
@Getter
@Entity
@Table(name = "weekly_availability", uniqueConstraints =
    @UniqueConstraint(
            name = "uk_weekly_exact_slot",
            columnNames = {"group_member_id", "day_of_week", "start_minute", "end_minute"}
    ))
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class WeeklyAvailability {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_member_id", nullable = false)
    private GroupMember groupMember;

    @Enumerated(EnumType.STRING)
    @Column(name = "day_of_week", nullable = false, length = 9)
    private DayOfWeek dayOfWeek;

    @Column(name = "start_minute", nullable = false)
    private Integer startMinute;

    @Column(name = "end_minute", nullable = false)
    private Integer endMinute;

    /** 반복 일정 한 구간을 생성 */
    public WeeklyAvailability(GroupMember groupMember, DayOfWeek dayOfWeek, int startMinute, int endMinute) {
        MinuteRange.validate(startMinute, endMinute);
        this.groupMember = java.util.Objects.requireNonNull(groupMember);
        this.dayOfWeek = java.util.Objects.requireNonNull(dayOfWeek);
        this.startMinute = startMinute;
        this.endMinute = endMinute;
    }
}
