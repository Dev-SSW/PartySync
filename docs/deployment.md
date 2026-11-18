# PartySync 운영 배포

## 아키텍처와 서버 요구사항

Linux 한 대에서 Caddy(React 정적 파일 + HTTPS), Spring Boot, PostgreSQL 17을 실행한다. 브라우저는 같은 도메인의 `/api`를 사용한다. 외부 공개 포트는 Caddy의 TCP 80/443뿐이며 DB·백엔드 포트는 publish하지 않는다. `/api` 오류는 SPA HTML로 대체하지 않는다. `/healthz`는 DB 상태를 포함한 최소 UP/DOWN만 제공하고 `/actuator*`는 외부에서 차단한다.

출발점은 2 CPU·RAM 2GB 이상·여유 디스크 20GB 이상이다. Compose 메모리 상한은 백엔드 768MiB, PostgreSQL 256MiB, Caddy 128MiB다. JVM 최대 heap 55%, Hikari 최대 5개, Tomcat 최대 25개 스레드를 기본으로 한다. 이는 보수적인 시작 설정이며 실제 사용량을 관찰해 조정한다. ARM64/AMD64 이미지를 게시하도록 구성되어 있다. 해당 서버 아키텍처의 CI 빌드 성공과 운영 검증은 별도로 확인한다.

서버에는 Docker Engine, Compose v2 이상(`up --wait` 지원), Bash, curl, Python 3, OpenSSL, util-linux의 flock, sha256sum이 필요하다. 설치·Docker 권한·SSH·방화벽·도메인 구매는 관리자가 승인 후 수행한다. Docker 소켓/그룹 권한은 사실상 호스트 관리자 권한이다. 임의의 다른 호스트 프록시나 CDN을 앞에 붙이지 않는다.

`compose.prod.yaml`의 proxy/database 네트워크는 internal이며 Caddy만 별도 edge 네트워크를 통해 인증서를 발급받는다. Tomcat은 proxy 네트워크의 **Caddy IP 하나만** 신뢰한다. 기본 subnet 172.30.77.0/28이 기존 Docker/VPN과 충돌하면 `PROXY_SUBNET`, `PROXY_IP`, `BACKEND_PROXY_IP`, `TRUSTED_PROXY_REGEX`를 함께 변경한다. 임의 X-Forwarded-For를 신뢰하는 설정으로 넓히지 않는다.

## 환경 변수와 비밀값

개발자의 루트 `.env`, 로컬 DB, TEST_DB 설정을 운영으로 복사하지 않는다. `deploy/.env.prod.example`은 값의 형식을 설명하는 템플릿이다. 실제 파일은 서버의 `/opt/partysync/shared/.env.prod` 등 별도의 경로에 두고 0600으로 보호한다. 아래 경로는 예시이며 승인한 경로로 바꿀 수 있다.

| 설정 | 용도 |
|---|---|
| COMPOSE_PROJECT_NAME | 영구 데이터와 연결된 고정 프로젝트명. 재배포마다 바꾸지 않음 |
| SITE_ADDRESS | 실제 bare hostname. 예: 관리자가 소유하고 DNS를 연결한 호스트 이름 |
| ACME_EMAIL | 실제 인증서 운영 연락처 |
| HSTS_ENABLED | 초기 false. 외부 HTTPS 점검을 마친 뒤 true |
| POSTGRES_DB / APP_DB_USER | 운영 전용 DB 및 앱 계정 |
| POSTGRES_ADMIN_PASSWORD_FILE / APP_DB_PASSWORD_FILE | 서로 다른 비밀번호 파일의 절대 경로 |
| BACKEND_IMAGE / FRONTEND_IMAGE / IMAGE_TAG | GHCR 저장소와 검증된 main의 전체 40자 SHA |
| CORS_ALLOWED_ORIGINS | 동일 도메인이면 빈 값. 외부 Origin이 필요할 때만 명시 |
| ACCOUNT_SESSION_TTL / MEMBER_SESSION_TTL | 기본 PT15M / PT12H. 그룹 세션은 부모 만료 이내 |
| REMEMBER_LOGIN_TTL | 기본 P30D. HttpOnly 복원 쿠키의 고정 서버 수명 |
| AUTH_* / GROUP_* | 등록·로그인 및 공개 그룹 API의 단일 서버 요청 제한 |
| DB_POOL_SIZE / JAVA_TOOL_OPTIONS | 연결 풀 및 JVM 메모리 조정 |

비밀번호는 예를 들어 다음처럼 **승인된 서버에서 관리자가** 생성한다. 화면/채팅에 값을 출력하지 않는다.

```bash
umask 077
mkdir -p /opt/partysync/shared/secrets
chmod 700 /opt/partysync/shared /opt/partysync/shared/secrets
openssl rand -hex 32 > /opt/partysync/shared/secrets/postgres-admin.txt
openssl rand -hex 32 > /opt/partysync/shared/secrets/db-password.txt
chmod 444 /opt/partysync/shared/secrets/*.txt
```

Compose의 파일 기반 secret은 서비스별로 허용한 파일만 `/run/secrets`에 마운트한다. 파일을 컨테이너의 서로 다른 UID가 읽어야 하므로 0444를 사용하며, **호스트의 상위 디렉터리 0700이 접근을 제한한다.** Compose 파일 secret의 uid/gid 재매핑에 의존하지 않는다. Docker 관리자와 호스트 root는 secret을 읽을 수 있다. 파일을 다른 공개 디렉터리로 복사하지 않는다.

새 PostgreSQL 볼륨 초기화 때만 admin 계정이 NOSUPERUSER/NOCREATEDB/NOCREATEROLE 앱 계정을 만든다. APP_DB_USER는 소문자로 시작하는 영문 소문자·숫자·밑줄 63자 이하이며 admin·postgres·pg_* 이름과 구분한다. 앱은 해당 DB의 owner로 Flyway DDL을 수행한다. admin 비밀번호는 백엔드에 마운트하지 않는다. 기존 볼륨에서는 초기화 스크립트가 다시 실행되지 않는다. **파일만 바꿔도 기존 DB 비밀번호가 자동 변경되는 것은 아니다.** 암호 변경은 백업과 접속 검증을 포함한 별도 작업이다.

### GitHub 설정

- 이미지 게시: 기본 제공 GITHUB_TOKEN, 해당 job만 packages:write. 별도의 PAT를 CI에 추가하지 않는다.
- 서버 배포 Secrets: DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS.
- Variables: DEPLOY_PATH(예: /opt/partysync), DEPLOY_PORT(기본 22), PRODUCTION_DEPLOY_ENABLED.
- `production` Environment에 required reviewers와 main 배포 제한을 설정한다. 이는 저장소 관리자가 별도로 설정해야 한다.
- 실제 서버 승인 전에는 PRODUCTION_DEPLOY_ENABLED를 만들지 않거나 false로 유지한다. 배포는 main의 workflow_dispatch에서 확인 체크를 해야만 진행된다.
- private GHCR이면 서버에서 read:packages 전용 자격 증명으로 docker login을 준비한다. 비밀번호를 CLI 인자로 넣지 않는다. SSH known_hosts는 별도 신뢰 채널로 fingerprint를 확인하며 StrictHostKeyChecking을 해제하지 않는다.

## 최초 배포

이 절차는 서버·DNS·운영 비밀값과 실제 공개 승인이 확보된 뒤 진행한다. 준비되지 않은 호스트에서 템플릿만으로 운영 배포를 시도하지 않는다.

1. Phase 5~7 소스를 검토해 main에 반영한다. 기존 CI는 PR/develop/main에서 Java 21 + 격리 테스트 PostgreSQL, Node 24의 검증을 실행하며 배포 smoke job도 별도 DB 컨테이너로 실행한다.
2. main push의 CI 전체 성공 후 `images.yml`이 동일 SHA를 checkout해 backend/web 이미지를 GHCR에 게시한다. PR·fork의 코드를 권한 있는 게시 작업에서 실행하지 않는다. latest 태그는 사용하지 않는다. 공식 베이스 이미지는 Dockerfile/Compose에 digest로 고정되어 있다. 갱신 시 검토하고 전체 검증을 다시 수행한다.
3. 서버 IP에 DNS를 연결하고 TCP 80/443을 Caddy에 허용한다. SSH는 관리자가 승인한 접근 범위로 제한한다. 5432/8080은 외부 방화벽에도 열지 않는다. 기존 로컬 DB 데이터는 옮기지 않는다.
4. shared/.env.prod와 두 secret 파일, 서버의 GHCR 읽기 권한을 준비한다. COMPOSE_PROJECT_NAME은 초기부터 고정한다. 예시의 replace 값은 실제 승인한 값으로 바꾼다.
5. GitHub production Environment와 수동 배포 gate를 설정한 뒤, 게시된 40자 main SHA를 선택해 배포를 승인한다. 워크플로는 해당 SHA의 `compose.prod.yaml`, `deploy/`만 releases/SHA로 보내고 shared의 비밀값·백업·상태를 유지한다.
6. 배포 스크립트는 이미지 revision label을 확인하고 DB를 no-recreate로 시작한다. 기존 public 테이블이 있으면 pg_dump 백업에 성공해야 앱을 갱신한다. Flyway가 실패하거나 health가 통과하지 않으면 실패 처리한다.
7. 외부 브라우저에서 인증서 체인·HTTPS 접속과 HTTP→HTTPS 전환을 확인한다. `/healthz`, SPA 새로고침, API JSON 응답도 확인한다. 실제 DNS/80/443/ACME 확인 전에는 HTTPS 완료가 아니다.
8. HTTPS가 정상임을 확인한 뒤 HSTS_ENABLED=true로 변경하고 Caddy 컨테이너만 재생성한다. 초기 정책은 max-age=31536000이며 includeSubDomains/preload는 사용하지 않는다. HSTS 활성화 후 TLS 장애의 영향은 장기 지속될 수 있다.

승인한 서버에서 수동으로 같은 절차를 실행할 수도 있다.

```bash
export PARTYSYNC_ENV_FILE=/opt/partysync/shared/.env.prod
export BACKUP_DIR=/opt/partysync/shared/backups
export STATE_DIR=/opt/partysync/shared/state
bash /opt/partysync/releases/VERIFIED_SHA/deploy/deploy.sh VERIFIED_SHA
```

배포 동시 실행은 flock으로 막는다. PostgreSQL 컨테이너는 앱 재배포 시 강제로 재생성하지 않는다. PostgreSQL 메이저/이미지 업그레이드는 백업·호환성 확인을 거친 별도 작업이다. 정적 파일은 Caddy 이미지 안에 있으며 Vite/Node 개발 서버를 운영에서 띄우지 않는다.

## 재배포와 롤백

CI가 통과하고 게시된 새 main SHA로 같은 수동 워크플로를 실행한다. shared/state/current는 최종 health 및 HTTPS 확인이 성공한 SHA이고, previous는 직전 안정 SHA다. 실패 시 자동 DB 초기화나 자동 다운그레이드를 하지 않는다. `docker compose ps`, `logs --tail 100 backend`로 원인을 확인하되 요청/SQL bind/debug 로그는 켜지 않는다.

이전 이미지로의 복구도 해당 SHA를 지정한 수동 배포다. **이전 앱과 현재 DB 스키마의 호환성을 먼저 확인해야 한다.** 코드 롤백은 Flyway 마이그레이션 롤백이 아니다. 적용된 V1~V3를 수정/삭제하거나 Flyway clean, repair, ignore 옵션으로 검증을 우회하지 않는다. 이전 버전이 현재 스키마를 지원하지 않으면 호환 수정 릴리스 또는 승인한 데이터 복구 절차를 택한다.

볼륨은 프로젝트명 기반 postgres_data, caddy_data, caddy_config에 보관된다. 앱 이미지 교체·컨테이너 재생성만으로 삭제되지 않는다. **운영 자동화에는 down -v, volume prune, 데이터 디렉터리 삭제가 없다.** Caddy 인증서 볼륨도 재사용해야 불필요한 재발급을 피할 수 있다.

## 백업과 복구

### 백업

```bash
PARTYSYNC_ENV_FILE=/opt/partysync/shared/.env.prod \
BACKUP_DIR=/opt/partysync/shared/backups \
bash /opt/partysync/releases/VERIFIED_SHA/deploy/backup.sh
```

pg_dump custom format, no-owner/no-acl로 일관된 DB 스냅샷을 만든다. 임시 파일과 archive 목록 검사를 통과한 뒤 원자적으로 이름을 바꾸고 SHA-256 checksum을 기록한다. 백업 디렉터리 0700, 파일 0600이다. 기본 보관은 14일이며 BACKUP_RETENTION_DAYS로 조정한다. 오래된 `partysync-*.dump`와 checksum만 이 디렉터리 안에서 정리한다. 백업에는 계정 해시·일정·게시글 등 민감 데이터가 있으므로 접근을 제한한다.

cron 또는 systemd timer로 매일 실행한다. 예를 들어 관리자가 검토한 절대 경로와 고정 SHA를 사용해 새벽 백업 작업을 등록한다. 스케줄을 실제 등록하는 것은 서버 관리자의 작업이다. 성공/실패 알림과 남은 디스크도 함께 점검한다.

같은 서버의 파일만으로 장애에 대비할 수 없다. `BACKUP_EXPORT_HOOK`에 관리자가 만든 실행 파일의 절대 경로를 지정하면 archive와 checksum 경로를 인자로 호출한다. 이 파일에서 age 등으로 암호화해 승인한 외부 저장소로 복제하고 복구를 주기적으로 확인한다. hook 실패는 백업/배포 실패로 처리한다. 백업 스크립트는 cloud 계정이나 저장소를 생성하지 않으며 임의 문자열을 eval하지 않는다.

### 복구 검증

```bash
PARTYSYNC_ENV_FILE=/opt/partysync/shared/.env.prod \
bash /opt/partysync/releases/VERIFIED_SHA/deploy/restore-check.sh /secure/path/partysync-TIMESTAMP.dump
```

checksum을 확인하고 같은 PostgreSQL 인스턴스의 `partysync_restore_*_test` 임시 DB에 single-transaction으로 복구한다. Flyway 성공 행·그룹·멤버 수를 확인하고 임시 DB만 삭제한다. 원본 운영 DB에는 덮어쓰지 않는다. trusted pg_dump 파일에만 사용한다.

실제 운영 복구는 사용자 승인을 받은 별도 장애 작업이다. 쓰기를 중단하고 현재 DB도 백업한 다음, **별도 새 DB**에 복구·내용 검증 후 백엔드 접속 대상을 전환한다. 기존 DB를 자동 drop하거나 pg_restore --clean으로 덮어쓰는 절차는 제공하지 않는다. 접속 대상 전환 후 Flyway·계정·세션·일정·게시글을 확인하고 기존 DB를 보존한다.

## 배포 후 점검과 로컬 검증

- `/healthz`: 상태만 공개되며 DB 장애 시 503. backend 컨테이너 healthcheck도 같은 DB 포함 Actuator 상태를 확인한다. Caddy 자체 probe는 loopback 2015의 정적 index를 확인한다.
- React 직접 접속/새로고침: `/login`, `/register`, `/account`, `/groups/ID`, `/groups/ID/posts`, `/join/CODE`. `/api`의 401/403/404/500이 index.html로 바뀌지 않아야 한다.
- 그룹 생성·초대·가입·역할 차이·다른 그룹 접근 거절을 확인한다. 초대 URL은 window.location.origin을 사용하므로 실제 서비스 주소로 복사되어야 한다.
- 반복/예외·빈 예외·복원·클릭/드래그 자동 저장·본인 체크·참여 수·새벽 접기와 모바일 레이아웃을 확인한다.
- 게시글 CRUD·카테고리 OWNER 관리·대시보드 최신 글을 확인한다.
- 계정 등록·로그인·비회원 연결·다른 브라우저 복구·세션 만료·기기별 로그아웃을 확인한다. 기존 43자 비회원 토큰도 지원한다.
- Bearer 계정/멤버 토큰은 sessionStorage, 비회원은 localStorage다. 로그인 복원은 HttpOnly·Secure·SameSite 쿠키를 추가로 사용한다. [배포 설정·마이그레이션·설치 확인](pwa-and-sessions.md)을 따른다. CORS credentials=false를 유지하고 쿠키 변경 요청의 Origin과 커스텀 헤더를 검증한다.
- 등록/로그인은 IP·ID 제한을 유지하며 운영 그룹 생성/가입은 기본 IP별 10회/30회, 1분 창이다. 프록시 원본 IP 복원을 우회할 수 없어야 한다. 다중 인스턴스에서는 메모리 제한기를 공유하도록 별도 설계한다.
- `docker stats --no-stream`, DB 접속 수, OOM/restart 횟수, 디스크와 백업 크기를 관찰한다. Docker 로그는 서비스당 최대 10MB × 3개로 회전한다. access logging은 초대 URL 유출 방지를 위해 켜지 않는다. 비밀번호·토큰·Authorization·요청 본문을 로그에 수집하지 않는다.
- healthcheck는 장애 감지이며 Docker restart 정책이 모든 unhealthy 상태를 자동 복구하는 것은 아니다. DB 재연결은 앱 pool이 처리하며 최종 `/healthz`를 확인한다. 외부 포트는 Caddy의 X-Forwarded-Port를 신뢰된 Tomcat 프록시 설정으로 복원하므로 비표준 로컬 검증 포트에서도 동일 출처가 유지된다.

로컬/CI의 독립 컨테이너 검증은 Node 24와 Docker에서 실행한다.

```bash
node deploy/smoke.mjs
```

이 스크립트는 루트 .env를 읽지 않고 난수 secret·독립 Compose 프로젝트/DB·loopback 18080/18443을 사용한다. 기본적으로 두 이미지를 빌드하고 HTTP에서 SPA/API/권한/만료·요청 제한·덤프 복구·DB 장애/재시작·앱 재생성을 검증한다. **공개 DNS나 신뢰된 HTTPS 인증서 검증을 대신하지 않는다.** 기록·백업은 무시된 build/ 아래에 두고 컨테이너/네트워크만 내려서 종료한다. 검증용 named volume은 자동 삭제하지 않는다. 정리하려면 출력한 `partysync-smoke-*` 프로젝트의 volume label을 확인한 후 해당 검증 볼륨만 명시적으로 삭제한다. 운영 볼륨을 대상으로 volume prune을 실행하지 않는다.

Windows에서는 Git Bash 경로를 PARTYSYNC_BASH에 지정할 수 있다. 이미 빌드한 `partysync-backend:phase7-local`, `partysync-web:phase7-local`을 재사용할 때만 PARTYSYNC_SKIP_BUILD=1을 지정한다.

참고: [Caddy 프록시 헤더](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets), [Spring Boot health](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html).
