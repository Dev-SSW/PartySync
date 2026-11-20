package github.partysync.notification;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import github.partysync.groupmember.auth.MemberPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** 일정 저장과 발송 대기를 원자적으로 기록하고 실제 네트워크 전송은 별도로 수행한다. */
@Service
public class SchedulePushNotifications {
    private static final Logger log = LoggerFactory.getLogger(SchedulePushNotifications.class);
    private final JdbcTemplate jdbc;
    private final PushGateway gateway;
    private final ObjectMapper json;
    public SchedulePushNotifications(JdbcTemplate jdbc, PushGateway gateway, ObjectMapper json) {
        this.jdbc=jdbc; this.gateway=gateway; this.json=json;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void changed(MemberPrincipal actor) {
        if (!gateway.enabled()) return;
        jdbc.update("""
            insert into push_delivery(actor_id,subscription_id,due_at)
            select a.id,s.id,now()+interval '20 seconds'
            from group_member a join group_member m on m.group_id=a.group_id
            join push_subscription s on s.group_member_id=m.id
            left join user_session u on u.id=s.user_session_id
            where a.id=? and a.active and m.active and a.id<>m.id
              and (s.user_session_id is null or u.revoked_at is null)
            for key share of s
            on conflict(actor_id,subscription_id) do update set due_at=excluded.due_at, attempts=0
            """, actor.groupMemberId());
    }

    private record Delivery(long id, long actorId, long subscriptionId, int attempts, Timestamp lease) { }

    public void dispatch() {
        if (!gateway.enabled()) return;
        // 한 건씩 발송권을 얻고 네트워크 대기 중에는 일정 저장의 행 잠금을 유지하지 않는다.
        for (int count=0; count<20; count++) {
            List<Delivery> claimed = jdbc.query("""
                with candidate as (select id from push_delivery where due_at<=now() order by due_at,id for update skip locked limit 1)
                update push_delivery d set due_at=now()+interval '60 seconds'
                from candidate c where d.id=c.id returning d.id,d.actor_id,d.subscription_id,d.attempts,d.due_at
                """, (row, index) -> new Delivery(row.getLong(1),row.getLong(2),row.getLong(3),row.getInt(4),row.getTimestamp(5)));
            if (claimed.isEmpty()) return;
            deliver(claimed.getFirst());
        }
    }

    private void deliver(Delivery delivery) {
        var rows=jdbc.queryForList("""
            select s.endpoint,s.p256dh,s.auth,a.nickname,a.group_id,g.name
            from push_subscription s join group_member m on m.id=s.group_member_id
            join group_member a on a.id=? and a.group_id=m.group_id
            join groups g on g.id=a.group_id left join user_session u on u.id=s.user_session_id
            where s.id=? and a.active and m.active and a.id<>m.id
              and (s.user_session_id is null or u.revoked_at is null)
            """, delivery.actorId(),delivery.subscriptionId());
        if (rows.isEmpty()) { complete(delivery); return; }
        Map<String,Object> row=rows.getFirst();
        try {
            String payload=json.writeValueAsString(Map.of("title",row.get("name")+" · 일정 알림",
                    "body",row.get("nickname")+"님이 일정을 등록하거나 변경했어요.",
                    "url","/groups/"+row.get("group_id"),"tag","schedule-"+row.get("group_id")));
            int status=gateway.send((String)row.get("endpoint"),(String)row.get("p256dh"),(String)row.get("auth"),payload);
            if (status==404 || status==410) {
                jdbc.update("delete from push_subscription where id=?",delivery.subscriptionId());
            } else if (status>=200 && status<300) complete(delivery);
            else if (status==429 || status>=500) retry(delivery);
            else { complete(delivery); log.warn("Web Push provider rejected delivery {} (HTTP {})",delivery.id(),status); }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt(); retry(delivery);
        } catch (Exception failure) {
            // 구독 주소와 암호화 키, VAPID 개인 키는 로그에 남기지 않는다.
            log.warn("Web Push delivery {} failed; retry scheduled",delivery.id());
            retry(delivery);
        }
    }

    private void complete(Delivery delivery) {
        // 발송 중 새로 저장된 변경은 다음 알림으로 남긴다.
        jdbc.update("delete from push_delivery where id=? and due_at=?",delivery.id(),delivery.lease());
    }
    private void retry(Delivery delivery) {
        if (delivery.attempts()>=2) { complete(delivery); return; }
        jdbc.update("update push_delivery set attempts=attempts+1,due_at=now()+interval '1 minute' where id=? and due_at=?",delivery.id(),delivery.lease());
    }
}
