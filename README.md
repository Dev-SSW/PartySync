# RaidSync

RPG 그룹의 일정과 공략을 공유하는 웹서비스 백엔드다. 회원가입 없이 초대 코드로 그룹에 참여하고 멤버별 Bearer Token으로 접근한다.

## 기술 스택

Java 21, Spring Boot 4.1.2, Gradle 9.8.2, Spring Web MVC, Spring Data JPA, Validation, Security, PostgreSQL 17, Flyway, Lombok, JUnit 5.

## 현재 기능

- 그룹 생성과 OWNER 등록을 하나의 트랜잭션으로 처리한다.
- 초대 코드로 MEMBER를 등록하며 그룹 내 닉네임 중복을 방지한다.
- 그룹 정보, COUNT 기반 인원 수, 정렬된 멤버 목록과 내 정보를 조회한다.
- 초대 정보는 해당 그룹 OWNER만 조회할 수 있다.
- 멤버 토큰은 256비트 난수로 발급하고 SHA-256 해시만 DB에 저장한다.
- 본인의 주간 반복 일정을 전체 교체하고 날짜별 예외 시간을 등록·수정·삭제한다.
- 그룹 멤버별 최종 가능 시간과 시간대별 참여 인원·전원 가능 시간을 조회한다. 예외는 반복 일정을 완전히 대체하며 빈 예외는 하루 전체 불가능이다.
- 일정 입력은 30분 단위이며 기간 조회는 양 끝을 포함해 최대 31일이다. 겹침은 거절하고 인접 구간은 병합한다.
- 카테고리·게시글은 엔티티와 Repository까지 구현되어 있으며 해당 API는 아직 제공하지 않는다.
- 프론트엔드, 토큰 만료·재발급·폐기, 그룹 삭제·추방·권한 위임은 제공하지 않는다.

## 프로젝트 구조

```text
src/main/java/github/partysync/
  group/          그룹 API·요청/응답·트랜잭션
  groupmember/    멤버 정보·권한·Bearer 인증
  availability/   일정 API·저장·예외 적용·공통 시간 계산
  category/       그룹별 카테고리 모델
  post/           게시글 모델
  common/         감사 시간·오류 처리·입력 검증
  config/         JPA Auditing·Spring Security 설정
src/main/resources/
  application.yaml
  db/migration/   Flyway V1·V2
src/test/
  java/           API·Repository 통합 테스트와 단위 테스트
  resources/
    application-test.yml
```

## 로컬 환경

Java 21과 로컬 PostgreSQL이 필요하다. 애플리케이션용 DB와 테스트 전용 DB를 별도로 준비한다. 기본 예시는 raidsync와 raidsync_test다.

프로젝트 루트에서 .env.example을 .env로 복사하고 자신의 로컬 접속 정보로 채운다. 이미 .env가 있으면 덮어쓰지 않는다.

| 변수 | 용도 |
|---|---|
| DB_URL, DB_USERNAME, DB_PASSWORD | 애플리케이션 DB |
| TEST_DB_URL, TEST_DB_USERNAME, TEST_DB_PASSWORD | 테스트 전용 DB |
| CORS_ALLOWED_ORIGINS | 허용할 프론트 Origin, 쉼표로 구분 |

URL 형식은 jdbc:postgresql://localhost:5432/raidsync이며 테스트 DB 이름은 raidsync_test 또는 PartySync_Test처럼 _test로 끝나도록 한다(대소문자 무관). 한 줄 KEY=value 형식으로 작성하고 따옴표나 export를 붙이지 않는다. .env는 Git에서 제외하며 운영 비밀은 별도 비밀 관리 시스템으로 주입한다.

## 애플리케이션 실행

```powershell
.\gradlew.bat bootRun
```

Spring 설정이 프로젝트 루트의 .env를 읽는다. IntelliJ에서도 Working directory를 프로젝트 루트로 지정하면 된다. 운영체제 및 Run Configuration 환경 변수는 .env보다 우선한다. macOS/Linux에서는 ./gradlew를 사용한다.

Flyway로 스키마를 적용한 뒤 Hibernate ddl-auto=validate로 매핑을 검사한다. 적용된 마이그레이션은 주석까지 유지하고 스키마 변경은 새 버전 SQL로 추가한다. 감사 시간과 일정 날짜의 기준은 Asia/Seoul이다.

## 테스트

```powershell
.\gradlew.bat clean build
```

두 통합 테스트는 @ActiveProfiles("test")로 application-test.yml을 자동 적용한다. 별도 Gradle 옵션이나 IntelliJ VM 옵션이 필요하지 않다. TEST_DB_*만 사용하며 JDBC와 Flyway가 같은 전용 DB에 연결된다.

테스트 DB는 실행 전에 준비해야 하고, 테스트 계정에는 접속·스키마 생성·데이터 정리 권한이 필요하다. 연결 초기화 단계에서 localhost/127.0.0.1/[::1]의 이름이 _test로 끝나는 DB만 허용하며 애플리케이션 DB_URL과 동일한 URL도 거절한다.

**API 테스트는 테스트 DB의 데이터를 TRUNCATE로 삭제한다.** 해당 DB는 폐기 가능한 테스트 데이터 전용으로 사용하고 다른 애플리케이션이나 개발 데이터와 공유하지 않는다. 테스트를 동시에 실행하지 않는다. 도메인 테스트는 트랜잭션을 롤백하며 테스트 종료 후 DB 자체와 Flyway 이력은 유지한다.

테스트 범위는 Flyway·Hibernate 매핑, Repository 저장/조회, UNIQUE/CHECK/FK, 삭제 전파, 그룹 API, 인증·인가·CORS, 동시 가입과 트랜잭션 롤백이다.

| 테스트 | DB 필요 | 검증 범위 |
|---|---|---|
| GroupApiControllerTest | 아니요 | HTTP 상태·응답 형식, 필수 입력 검증, 인증 누락, 공통 오류 처리. Service만 대체한다. |
| GroupApiIntegrationTest | 예 | 실제 생성·참여·조회, 토큰 인증·그룹 권한, 동시 가입, 롤백·충돌 재시도, 권한 위조 차단·입력 정규화 |
| PartysyncApplicationTests | 예 | Flyway·Hibernate 매핑, Repository, UNIQUE/CHECK/FK, 예외 일정 삭제 전파 |
| AvailabilityApiIntegrationTest | 예 | 일정 전체 교체·예외 적용, 삭제 복원, 본인 권한, 동시 수정·롤백, 기간별 쿼리 수 |
| AvailabilityCalculatorTest | 아니요 | 30분 입력·겹침·인접 병합, 예외 우선, 참여 인원과 전원 가능 시간·날짜 경계 |
| MinuteRangeTest / MemberTokenServiceTest / DatabaseConstraintsTest | 아니요 | 시간 경계, 토큰·해시, 번역된 PostgreSQL 오류의 제약조건 판별 |
| TestDatabaseInitializerTest | 아니요 | 개발 DB 오연결 및 JPA·Flyway 연결 불일치 차단 |

API 요청·응답만 빠르게 확인할 때는 DB 없이 다음을 실행한다.

```powershell
.\gradlew.bat test --tests '*GroupApiControllerTest'
```

DB 없이 단위 테스트만 실행할 수도 있다.

```powershell
.\gradlew.bat test --tests '*MinuteRangeTest' --tests '*MemberTokenServiceTest' --tests '*DatabaseConstraintsTest' --tests '*TestDatabaseInitializerTest' --tests '*AvailabilityCalculatorTest'
```

## 인증과 보안

생성·참여 응답의 memberAccessToken은 최초 한 번 전달되며 이후 요청의 Authorization: Bearer 헤더에 사용한다. 일반 조회에는 토큰 원문·해시를 포함하지 않는다. 초대 코드와 멤버 인증 토큰은 별개다.

세션·쿠키 기반 인증을 사용하지 않는 stateless API이며 CSRF는 비활성화되어 있다. CORS는 명시적인 Origin만 허용한다. CORS_ALLOWED_ORIGINS가 비어 있으면 교차 Origin 요청을 허용하지 않는다.

운영에서는 HTTPS를 사용하고 인증 헤더 및 토큰이 포함된 응답을 로그에 수집하지 않아야 한다.

## 문서

- [API 명세](docs/api.md): 요청·응답, 인증·권한, 오류 코드
- [ERD](docs/erd.md): 테이블·관계·제약조건과 데이터 모델
