package github.partysync.availability;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import github.partysync.common.CreatedEntity;
import github.partysync.groupmember.GroupMember;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

/**
 * 특정 날짜의 반복 일정을 덮어씌운다
 * 예외가 존재하지만 슬롯이 없으면 그날은 참여 불가능
 */
@Getter
@Entity
@Table(name = "availability_override", uniqueConstraints =
    @UniqueConstraint(
            name = "uk_override_member_date",
            columnNames = {"group_member_id", "target_date"}
    ))
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AvailabilityOverride extends CreatedEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_member_id", nullable = false)
    private GroupMember groupMember;

    @Column(name = "target_date", nullable = false)
    private LocalDate targetDate;

    /**
     * DB 연쇄 삭제와 ORM 삭제 상태를 동기화하기 위한 역방향 컬렉션
     * 외부에는 공개하지 않음
    */
    @Getter(AccessLevel.NONE)
    @OneToMany(mappedBy = "availabilityOverride", cascade = CascadeType.REMOVE)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private List<AvailabilityOverrideSlot> slots = new ArrayList<>();

    /**
     * Slot 생성 시 부모 컬렉션도 맞춰 관리 중인 자식에게 ORM 삭제 상태가 전파
     */
    void registerSlot(AvailabilityOverrideSlot slot) {
        slots.add(slot);
    }

    public AvailabilityOverride(GroupMember groupMember, LocalDate targetDate) {
        this.groupMember = java.util.Objects.requireNonNull(groupMember);
        this.targetDate = java.util.Objects.requireNonNull(targetDate);
    }
}
