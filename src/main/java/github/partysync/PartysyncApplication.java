package github.partysync;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Spring Boot 실행 진입점
 * 패키지 아래의 도메인·설정·Controller를 자동 탐색
 */
@SpringBootApplication
public class PartysyncApplication {
	public static void main(String[] args) {
		SpringApplication.run(PartysyncApplication.class, args);
	}
}
