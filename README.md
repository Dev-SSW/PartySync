# PartySync

RPG 그룹이 함께할 시간을 찾는 웹서비스다. 회원가입 없이 초대 코드로 그룹에 참여하고 멤버별 Bearer Token으로 접근한다. React 웹에서 반복 일정과 날짜별 예외를 편집하고 참여 인원 및 공통 가능 시간을 확인한다.

## 기술 스택

Java 21, Spring Boot 4.1.2, Gradle 9.8.2, Spring Web MVC, Spring Data JPA, Validation, Security, PostgreSQL 17, Flyway, Lombok, JUnit 5.

프론트엔드는 Node.js 24 이상, React 19, TypeScript 6, Vite 8, React Router 7, Tailwind CSS 4, TanStack Query 5, Lucide React, Vitest, React Testing Library를 사용한다. 설치 버전은 `frontend/package-lock.json`으로 고정한다.

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
- 랜딩, 그룹 생성·초대 가입, 대시보드, 주간 일정 편집과 날짜별 예외 편집 웹 화면을 제공한다.
- 토큰 만료·재발급·폐기, 그룹 삭제·추방·권한 위임은 제공하지 않는다.

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
frontend/
  src/api/        fetch 클라이언트
  src/features/   그룹별 인증·시간표·예외 편집
  src/pages/      랜딩·생성/가입·대시보드·반복 일정 편집
  src/components/ 공통 피드백·모달·30분 시간 선택
  src/utils/      서울 날짜·슬롯 변환
  src/test/       API·인증·UI·시간 변환 테스트
.github/workflows/ci.yml
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

## React 개발 서버

백엔드는 프로젝트 루트에서, 프론트엔드는 별도 터미널에서 실행한다. 로컬 PostgreSQL을 그대로 사용하며 Docker는 필요하지 않다.

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

브라우저에서 `http://localhost:5173`에 접속한다. macOS/Linux에서는 `npm`을 사용한다. `/api`는 Vite 프록시가 Spring Boot 기본 포트 `8080`으로 전달한다. 백엔드 포트를 바꿨다면 `frontend/.env.example`을 `frontend/.env`로 복사해 `API_PROXY_TARGET`을 수정한다. 루트 `.env`의 `CORS_ALLOWED_ORIGINS`에는 `http://localhost:5173`을 포함한다. Vite는 포트가 이미 사용 중이면 다른 포트로 자동 이동하지 않고 종료한다.

`VITE_API_BASE_URL`은 기본 `/api`다. `VITE_` 변수는 브라우저에 공개되므로 비밀번호·토큰을 넣지 않는다. 운영에서는 `frontend/dist`를 정적 호스팅하고 `/api`를 백엔드로 프록시한다. `/groups/*`, `/join/*` 등 SPA 경로는 `index.html`로 fallback해야 한다. HTTPS, 응답 `Referrer-Policy: no-referrer`, 적절한 CSP 및 인증 응답·헤더 로그 제외 정책을 별도로 구성한다. Vite 개발 서버는 운영 서버가 아니다.

주요 화면: `/` 소개·저장된 파티, `/groups/new` 생성, `/join` 코드 입력, `/join/:inviteCode` 초대 가입, `/groups/:groupId` 시간표·멤버·예외 편집, `/groups/:groupId/schedule/weekly` 반복 일정 편집. 시간표는 서버의 30분 단위 결과를 1시간 UI 셀로 표시하며, 해당 시간 전체의 참여 가능 인원과 일부만 가능한 상태를 구분한다. 날짜 헤더에서는 내 예외를 편집하며 빈 예외 저장과 예외 삭제를 구분한다. 날짜는 KST 기준이고 날짜 전용 산술 연산은 UTC로 수행한다.

참여 입력에는 순수 코드, HTTP(S) 전체 초대 링크, `/join/코드` 상대 경로를 사용할 수 있다. OWNER는 코드와 링크를 각각 복사할 수 있다. 지원하지 않는 경로·인증 정보·쿼리가 붙은 링크는 거절한다.

시간표는 1시간 한 행에 하나의 선택 셀을 표시한다. 인원수는 서버의 두 30분 결과에 모두 포함된 멤버 수이고, 일부만 가능한 경우 ◐ 표시와 반시간별 상세로 구분한다. 체크는 1시간 전체 가능일 때만 표시한다. 02~08시는 기본 접혀 있으며 펼치기/접기는 데이터에 영향을 주지 않는다. 접힌 구간의 본인 일정은 별도 안내하고 인원수를 합산하지 않는다. PC는 7일 시간표와 오른쪽 패널을 약 68:32로 배치하고, 작은 화면은 세로 배치 및 요일 탭으로 하루를 표시한다. `✓`는 현재 멤버 ID가 서버의 가능 멤버 목록에 포함된 경우이며 인원수와 별도로 표시한다. 반복·예외 상세 편집도 같은 세로 시간축을 사용한다.

대시보드의 `내 일정 수정`에서 `이번 날짜만` 또는 `매주 반복`을 선택하면 마지막 입력 후 800ms 대기해 자동 저장한다. 마우스·펜 드래그는 시작 칸에서 선택/해제 방향을 정하고 지나간 각 칸을 한 번만 처리하며, 놓은 뒤 모아서 저장한다. 드래그 중에는 PUT을 시작하지 않는다. 모바일은 스크롤과 충돌하지 않도록 탭으로 선택한다. 날짜 수정은 하루 전체를, 반복 수정은 다른 요일을 포함한 주간 전체를 보존해 PUT하며 요청은 순서대로 처리한다. 수정한 셀은 60분 경계로 설정하지만 기존 30분 데이터는 수정하지 않은 구간에 그대로 남긴다. 따라서 전체 교체 요청에도 보존된 기존 30분 경계가 포함될 수 있다. 저장 중 체크는 편집 초안이고 인원수는 서버 결과다. 반복 편집에서는 왼쪽 체크로 실제 참여를, 셀 테두리와 접근성 레이블·툴팁으로 원본 설정을 구분한다. 원본 설정은 날짜별 예외가 적용된 최종 참여와 다를 수 있다. PUT 응답으로 내 일정 캐시를 갱신하고 저장 묶음 종료 후 그룹 일정·공통 시간 GET 두 개를 갱신한다. 서버에 저장한 마지막 상태와 같은 선택은 PUT과 재조회를 생략한다. PUT 성공 후 조회만 실패하면 재시도는 GET만 수행한다. 실패하면 최신 선택을 유지해 재시도한다. 미저장 상태에서는 주 이동·수정 범위 전환·기기 정보 삭제를 제한하며 경로 이동은 저장 완료 후 진행한다. 새로고침·탭 종료에는 경고를 표시하지만 브라우저 강제 종료까지 저장을 보장하지는 않는다. 이미 조회된 화면의 재조회가 통신 오류 또는 5xx로 실패하면 화면과 편집 초안을 유지하고 재시도를 안내한다. 최초 조회 실패와 인증·권한 오류는 기존처럼 접근을 차단한다.

### 프론트엔드 검증

`frontend`에서 다음을 실행한다. 테스트는 fetch mock을 사용하므로 PostgreSQL 없이 실행할 수 있다.

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Vitest는 그룹 폼·API 오류·그룹별 인증 복원/정리·권한 UI·반복 일정 저장·예외 등록/삭제·시간 경계 및 슬롯 변환을 검증한다. `package.json`의 minimatch override는 개발 도구의 취약한 전이 의존성을 수정된 11.x로 제한한다.

### CI

GitHub Actions는 Pull Request와 develop push에서 백엔드 빌드·전체 테스트 및 프론트엔드 타입·ESLint·Vitest·배포 빌드를 수행한다. 백엔드 작업의 PostgreSQL 17 서비스와 계정은 CI 실행별로 폐기되며 개발·운영 DB에 접속하지 않는다. CI 테스트 DB도 기존 `_test` 이름과 localhost 안전 검증을 통과해야 한다. 로컬 실행에는 이 서비스 컨테이너가 필요하지 않다.

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

프론트엔드는 새로고침 후 접근을 유지하기 위해 그룹별 토큰을 `localStorage`의 전용 모듈에 저장한다. 멤버 ID·역할은 저장값을 신뢰하지 않고 `/api/members/me`로 확인한다. 공개 생성·가입 요청에는 Bearer를 보내지 않으며 인증 실패는 해당 그룹 정보와 캐시만 제거한다. 다른 탭에서 참여 정보가 바뀌어도 반영한다. 초대 코드는 중복 가입 안내를 위해 해시만 저장하며 일반 멤버는 OWNER 초대 조회를 호출하지 않는다.

**장기 Bearer Token의 localStorage 저장은 XSS 발생 시 탈취될 위험이 있다.** 현재 토큰 만료·폐기·복구·재발급은 제공하지 않는다. 기기에서 참여 정보를 삭제해도 서버 토큰이 폐기되는 것은 아니며, 저장소를 지우면 기존 멤버 인증을 복구할 수 없다. 공개 전 HttpOnly/Secure/SameSite 인증 보관 방식, 토큰 만료·교체·폐기, 요청 제한, CSP와 보안 로그 정책을 마련해야 한다. 프론트 라우트 보호는 편의 기능이며 실제 권한은 서버가 검증한다. 초대 링크도 가입 권한을 제공하므로 신뢰하는 사람에게만 공유한다.

## 문서

- [API 명세](docs/api.md): 요청·응답, 인증·권한, 오류 코드
- [ERD](docs/erd.md): 테이블·관계·제약조건과 데이터 모델
