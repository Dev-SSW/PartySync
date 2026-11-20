package github.partysync.notification;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration
@EnableScheduling
@ConditionalOnProperty(name="app.push.dispatch-enabled", havingValue="true", matchIfMissing=true)
public class PushDispatchScheduler {
    private final SchedulePushNotifications notifications;
    public PushDispatchScheduler(SchedulePushNotifications notifications) { this.notifications=notifications; }
    @Scheduled(fixedDelay=5000, initialDelay=5000)
    public void dispatch() { notifications.dispatch(); }
}
