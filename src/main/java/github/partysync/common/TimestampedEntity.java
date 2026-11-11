package github.partysync.common;

import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import lombok.Getter;
import org.springframework.data.annotation.LastModifiedDate;

/**
 * JPA Auditing으로 생성 시각과 최종 수정 시각을 관리하는 공통 부모
 */
@Getter
@MappedSuperclass
public abstract class TimestampedEntity extends CreatedEntity {
    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
