package github.partysync.availability;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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

import github.partysync.common.MinuteRange;

/** 날짜별 예외 일정에 속하는 가능 시간 구간 */
@Getter
@Entity
@Table(name = "availability_override_slot", uniqueConstraints =
    @UniqueConstraint(
            name = "uk_override_exact_slot",
            columnNames = {"availability_override_id", "start_minute", "end_minute"}
    ))
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AvailabilityOverrideSlot {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "availability_override_id", nullable = false)
    private AvailabilityOverride availabilityOverride;

    @Column(name = "start_minute", nullable = false)
    private Integer startMinute;

    @Column(name = "end_minute", nullable = false)
    private Integer endMinute;

    /** 예외의 가능 시간 한 구간을 만들고 부모의 역방향 컬렉션에도 등록해 ORM 삭제 전파를 맞춘다. */
    public AvailabilityOverrideSlot(AvailabilityOverride availabilityOverride, int startMinute, int endMinute) {
        MinuteRange.validate(startMinute, endMinute);
        this.availabilityOverride = java.util.Objects.requireNonNull(availabilityOverride);
        this.startMinute = startMinute;
        this.endMinute = endMinute;
        // 외래키의 주인은 Slot이지만 ORM 삭제 전파를 위해 부모 컬렉션도 함께 갱신
        availabilityOverride.registerSlot(this);
    }
}
