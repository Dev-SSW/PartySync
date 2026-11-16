# PartySync API

기본 경로는 /api다. 요청·응답은 UTF-8 JSON이고 ID는 정수다. 별도 성공 응답 envelope는 없다. 감사 시간은 Asia/Seoul 기준 ISO 8601 LocalDateTime(UTC 오프셋 없음)이다. 토큰 원문은 생성·참여·로그인·연결·세션 발급 응답에만 등장한다.

React 개발 서버는 `http://localhost:5173`이며 `/api`를 Vite 프록시로 전달한다. 프론트엔드는 그룹별 Bearer를 선택하고 `/members/me`의 실제 그룹·권한을 검증한다. 생성·가입 요청에는 저장된 토큰을 보내지 않는다. `/join/:inviteCode`는 프론트엔드 가입 경로이며 공개 그룹 조회 API가 아니다. OWNER만 초대 정보 조회를 호출한다.

프론트엔드 시간표는 `common-availability`의 30분 단위 결과를 1시간 UI 셀로 표시한다. 한 시간의 두 30분 구간 모두에서 `availableMemberIds`에 포함된 멤버만 해당 시간 전체의 가능 인원으로 표시하며, 일부만 가능한 경우는 별도 표시하고 반시간별 상세를 제공한다. 전원 가능 강조는 두 구간 모두 `allAvailable=true`이고 그룹 인원이 0명보다 클 때 적용한다. 편집한 셀은 한 시간 전체를 설정하고 연속 구간은 병합해 저장하되, 수정하지 않은 기존 30분 구간은 보존한다. 서버의 30분 시간 모델과 API 계약은 유지한다. 날짜별 예외에서 빈 `slots`의 PUT은 하루 전체 불가이고 DELETE는 기본 반복 일정 복원이다. DB 스키마는 프론트엔드 추가로 변경하지 않았다.

## 공통 인증·보안 규칙

보호된 API에는 다음 헤더를 보낸다.

```http
Authorization: Bearer <memberAccessToken>
```

비회원 토큰은 32바이트 난수(256비트)를 Base64 URL-safe, padding 없이 인코딩한 43자 문자열이다. 계정·계정 기반 그룹 토큰은 이 난수에 각각 u_·m_ 접두사를 붙인 45자 문자열이다. 서버에는 전체 토큰의 SHA-256 해시(64자 소문자 hex)만 저장한다. 기존 비회원 토큰도 우연히 접두사와 같은 문자로 시작할 수 있어 형식과 길이를 함께 구분한다. 초대 코드는 별도로 생성되며 멤버 인증으로 사용할 수 없다. 사용자 식별은 토큰으로만 수행한다. 쿼리의 memberId/groupMemberId나 클라이언트가 보낸 role을 신뢰하지 않는다.

- HTTP 세션·쿠키·HTTP Basic·폼 로그인은 인증 수단으로 사용하지 않는다. DB에 보관한 Opaque Token 세션을 Authorization으로 검증하며 요청 처리는 stateless다.
- Authorization은 단일 헤더로 전달한다. 형식 오류·중복 헤더·유효하지 않은 토큰은 401이다. 공개 API라도 잘못된 Authorization을 첨부하면 401이므로 생성/참여에는 기존 토큰을 생략하는 것을 권장한다.
- 토큰을 URL·서버 로그·분석 도구·콘솔 로그에 넣지 않는다. 생성/참여 응답은 Cache-Control: no-store다. 다른 응답에는 토큰과 해시가 없다.
- 기존 비회원 토큰은 계정 연결 전까지 유지된다. 연결 후 과거 토큰은 즉시 폐기하고 만료·폐기 가능한 그룹 세션으로 전환한다. 계정 로그인 후 새 그룹 세션을 발급받을 수 있다. 비회원 토큰을 분실했고 계정에도 연결하지 않았다면 복구할 수 없다.
- CORS_ALLOWED_ORIGINS에는 허용 Origin을 쉼표로 나열한다. 예: http://localhost:5173,https://raidsync.example. 빈 값은 교차 Origin 접근을 허용하지 않는다. *와 null Origin은 설정할 수 없다.
- CORS는 GET/POST/PUT/DELETE/OPTIONS 및 Authorization/Content-Type/Accept 헤더를 허용한다. credentials 옵션은 false다. Location 헤더는 브라우저에서 읽을 수 있다. 허용 Origin의 preflight는 인증 없이 처리하고, 미허용 Origin은 JSON 403으로 거절한다.
- CSRF는 Authorization 헤더 기반 REST에 맞춰 비활성화했다. 이후 쿠키 인증을 추가하면 CSRF 정책도 다시 설계해야 한다.
- /actuator/health는 GET 공개 경로이며 최소 상태만 제공한다. 운영 Caddy는 /actuator*를 차단하고 /healthz에 최소 상태를 제공한다. 다른 Actuator 엔드포인트는 공개하지 않는다.

## API 목록

| Method | Endpoint | 인증 | 성공 |
|---|---|---|---|
| POST | /api/groups | 불필요 | 201 |
| POST | /api/groups/join | 불필요 | 201 |
| GET | /api/groups/{groupId} | 해당 그룹 멤버 | 200 |
| GET | /api/groups/{groupId}/members | 해당 그룹 멤버 | 200 |
| GET | /api/groups/{groupId}/invite | 해당 그룹 OWNER | 200 |
| GET | /api/members/me | 멤버 | 200 |

## 1. 그룹 생성

POST /api/groups — 인증 불필요.

```json
{
  "name": "저녁 레이드 파티",
  "description": "주간 레이드 일정 공유",
  "ownerNickname": "파티장"
}
```

name과 ownerNickname은 필수다. 이름 최대 100자, 닉네임 최대 50자, description은 nullable이며 최대 2000자다. 이름·설명·닉네임의 앞뒤 공백을 strip하고 Unicode NFC 정규화를 적용한 뒤 검증한다. 닉네임은 대소문자를 구별한다. 공백만 있는 이름·닉네임은 거절한다.

201 Created, Location: /api/groups/1, Cache-Control: no-store.

```json
{
  "group": {
    "groupId": 1,
    "name": "저녁 레이드 파티",
    "description": "주간 레이드 일정 공유",
    "memberCount": 1,
    "createdAt": "2026-11-10T18:00:00.123456"
  },
  "inviteCode": "<43자 URL-safe 난수>",
  "member": {
    "memberId": 10,
    "nickname": "파티장",
    "role": "OWNER",
    "joinedAt": "2026-11-10T18:00:00.123456"
  },
  "memberAccessToken": "<생성자 전용 43자 토큰 원문>"
}
```

그룹과 OWNER 저장은 하나의 트랜잭션이다. 초대 코드 또는 토큰 해시 충돌 시 전체 트랜잭션을 롤백한 뒤 새 트랜잭션으로 최대 3회 시도한다. 재시도 소진은 500 GENERATION_FAILED다. 다른 저장 실패도 전체 롤백한다.

주요 오류: 400 INVALID_REQUEST, 잘못된 Authorization 첨부 시 401 UNAUTHORIZED, 500 INTERNAL_ERROR/GENERATION_FAILED.

## 2. 초대로 그룹 참여

POST /api/groups/join — 인증 불필요.

```json
{
  "inviteCode": "<초대 코드>",
  "nickname": "새로운멤버"
}
```

두 값은 필수다. inviteCode는 앞뒤 공백을 제거하고 최대 128자이며 대소문자를 구별한다. nickname의 정규화·길이 제한은 생성자 닉네임과 같다. 초대 코드는 API 요청 본문으로 전달한다. 프론트에서 초대 링크를 구성할 때 사용할 값이며 멤버 인증 토큰을 링크에 넣지 않는다.

201 Created, Cache-Control: no-store.

```json
{
  "group": {
    "groupId": 1,
    "name": "저녁 레이드 파티",
    "description": "주간 레이드 일정 공유",
    "memberCount": 2,
    "createdAt": "2026-11-10T18:00:00.123456"
  },
  "member": {
    "memberId": 11,
    "nickname": "새로운멤버",
    "role": "MEMBER",
    "joinedAt": "2026-11-10T18:05:00.123456"
  },
  "memberAccessToken": "<가입자 전용 43자 토큰 원문>"
}
```

닉네임 사전 확인과 DB UNIQUE(group_id,nickname)를 함께 사용한다. 동시 요청이 사전 확인을 모두 통과해도 하나만 저장되며 다른 요청은 409다. 다른 그룹에서는 같은 닉네임이 허용된다. 토큰 해시 충돌 시에도 롤백 후 최대 3회 재시도한다. memberCount는 COUNT 결과이며 동시 가입 시 응답 이후 다른 요청에 의해 증가할 수 있다.

주요 오류: 400 INVALID_REQUEST, 404 INVITE_NOT_FOUND, 409 NICKNAME_CONFLICT, 401 UNAUTHORIZED, 500 INTERNAL_ERROR/GENERATION_FAILED.

## 3. 그룹 조회

GET /api/groups/1 — 해당 그룹의 OWNER/MEMBER 인증 필요. 요청 JSON 없음.

```json
{
  "groupId": 1,
  "name": "저녁 레이드 파티",
  "description": "주간 레이드 일정 공유",
  "memberCount": 2,
  "createdAt": "2026-11-10T18:00:00.123456"
}
```

초대 코드와 인증 정보는 포함하지 않는다. memberCount 컬럼은 없으며 COUNT 쿼리로 계산한다.

주요 오류: 400 INVALID_REQUEST(유효하지 않은 ID), 401 UNAUTHORIZED, 403 FORBIDDEN(다른 그룹), 404 GROUP_NOT_FOUND, 500 INTERNAL_ERROR.

## 4. 그룹 멤버 목록

GET /api/groups/1/members — 해당 그룹의 OWNER/MEMBER 인증 필요. 요청 JSON 없음. memberId 오름차순으로 정렬한 배열을 반환한다.

```json
[
  {"memberId": 10, "nickname": "파티장", "role": "OWNER", "joinedAt": "2026-11-10T18:00:00.123456"},
  {"memberId": 11, "nickname": "새로운멤버", "role": "MEMBER", "joinedAt": "2026-11-10T18:05:00.123456"}
]
```

주요 오류: 400 INVALID_REQUEST, 401 UNAUTHORIZED, 403 FORBIDDEN, 404 GROUP_NOT_FOUND, 500 INTERNAL_ERROR.

## 5. 내 멤버 정보

GET /api/members/me — 멤버 인증 필요. 요청 JSON 없음.

```json
{
  "memberId": 10,
  "groupId": 1,
  "nickname": "파티장",
  "role": "OWNER"
}
```

새로고침 후 저장된 토큰을 Authorization에 넣어 이 API를 호출한다. 응답은 해당 토큰의 멤버이며 별도의 memberId 입력은 받지 않는다. 같은 사용자가 여러 그룹에 가입하면 그룹별로 다른 멤버와 토큰을 가진다.

주요 오류: 401 UNAUTHORIZED, 500 INTERNAL_ERROR.

## 6. OWNER 초대 정보 조회

GET /api/groups/1/invite — 해당 그룹 OWNER 인증 필요. 요청 JSON 없음. Cache-Control: no-store.

```json
{
  "groupId": 1,
  "inviteCode": "<그룹 초대 코드>"
}
```

프론트 주소가 아직 정해지지 않아 서버는 inviteUrl을 조합하지 않는다. 프론트에서 초대 코드를 이용해 링크를 만든다. OWNER에게도 다른 멤버의 토큰·해시는 제공하지 않는다.

주요 오류: 400 INVALID_REQUEST, 401 UNAUTHORIZED, 403 FORBIDDEN(MEMBER 또는 다른 그룹), 404 GROUP_NOT_FOUND, 500 INTERNAL_ERROR.

## 공통 오류 응답

```json
{
  "status": 401,
  "code": "UNAUTHORIZED",
  "message": "유효한 멤버 인증이 필요합니다."
}
```

| HTTP | code | 의미 |
|---|---|---|
| 400 | INVALID_REQUEST | 필수값·길이·ID·JSON 형식 오류 |
| 401 | UNAUTHORIZED | 토큰 누락·형식 오류·불일치; WWW-Authenticate: Bearer |
| 403 | FORBIDDEN | 다른 그룹/역할 접근 또는 미허용 CORS |
| 404 | GROUP_NOT_FOUND | 인증 후 조회한 그룹이 없음 |
| 404 | INVITE_NOT_FOUND | 초대 코드로 그룹을 찾지 못함 |
| 404 | NOT_FOUND | 매핑되지 않은 리소스 |
| 409 | NICKNAME_CONFLICT | 같은 그룹 내 닉네임 중복 |
| 405 | METHOD_NOT_ALLOWED | 지원하지 않는 HTTP 메서드 |
| 415 | UNSUPPORTED_MEDIA_TYPE | 요청 Content-Type 오류 |
| 500 | GENERATION_FAILED | 난수 코드 충돌 재시도 소진 |
| 500 | INTERNAL_ERROR | 서버 또는 DB 오류 |

인증이 필요한 경로는 그룹 존재 여부를 확인하기 전에 토큰을 검증한다. 인증 없이 존재 여부를 탐색하면 401이다. 유효한 멤버가 존재하는 다른 그룹에 접근하면 403, 없는 그룹이면 404다. 오류 응답은 SQL·예외 스택·입력값·토큰·해시를 포함하지 않는다.

## 프론트 연동 순서

1. 생성 또는 참여 요청을 보낸다.
2. 반환된 groupId/memberId 및 memberAccessToken을 확보한다. 토큰을 응답 로그에 기록하지 않는다.
3. 그룹별 토큰을 관리하며 이후 요청의 Authorization에 해당 그룹 토큰을 넣는다.
4. 새로고침 시 /api/members/me로 토큰 상태를 확인한다. 401이면 인증 정보가 유효하지 않다는 안내를 한다. 403은 해당 그룹/역할 권한 부족으로 처리한다.
5. 409이면 닉네임 변경을 안내한다. 토큰 분실 시 원문 복구·재발급 API는 아직 없다.

실서비스에서는 HTTPS를 사용하고 브라우저 저장 방식과 XSS 대응을 함께 결정한다. 서버는 쿠키 기반 자동 인증을 제공하지 않는다. 공개 그룹 생성·참여 API의 rate limit, 초대 코드 회전, 토큰 만료/폐기는 후속 운영 보강 사항이다.

## 일정 API

일정 API는 모두 멤버 Bearer 인증이 필요하다. 쓰기는 OWNER/MEMBER 모두 본인 일정에만 적용되며 body의 memberId로 대상을 지정할 수 없다. 그룹 조회는 같은 그룹의 멤버만 가능하다.

| Method | Endpoint | 성공 | 의미 |
|---|---|---|---|
| PUT | /api/members/me/weekly-availability | 200 | 본인 반복 일정 전체 교체 |
| GET | /api/members/me/weekly-availability | 200 | 요일·시작 분 순서 조회 |
| PUT | /api/members/me/availability-overrides/{date} | 200 | 해당 날짜 예외 생성 또는 슬롯 전체 교체 |
| DELETE | /api/members/me/availability-overrides/{date} | 204 | 예외 삭제, 반복 일정으로 복원 |
| GET | /api/members/me/availability-overrides?from=2026-11-16&to=2026-11-22 | 200 | 기간 내 본인 예외 목록 |
| GET | /api/groups/{groupId}/availability?from=2026-11-16&to=2026-11-22 | 200 | 그룹 멤버별 날짜의 최종 가능 시간 |
| GET | /api/groups/{groupId}/common-availability?from=2026-11-16&to=2026-11-22 | 200 | 시간대별 참여 인원·멤버·전원 가능 여부 |

### 공통 시간·날짜 정책

- 하루의 시간은 [startMinute,endMinute)이며 0 <= startMinute < endMinute <= 1440이다. 1440은 24:00이고 시작값으로 사용할 수 없다.
- API 입력은 JSON 정수이면서 30분 배수인 값만 받는다. 소수를 정수로 잘라 처리하지 않는다. MONDAY~SUNDAY를 사용하며 반환 요일 순서는 월요일부터 일요일이다.
- 같은 요일/날짜의 겹치는 구간과 완전히 같은 구간은 400으로 거절한다. 맞닿은 구간은 정렬 후 병합한다.
- 자정을 넘는 시간은 두 요일 또는 두 날짜로 나누어 요청한다. 금요일 23:00~토요일 02:00은 금요일 [1380,1440), 토요일 [0,120)이다.
- 반복 일정은 요청 전체 최대 336개, 날짜별 예외는 최대 48개 구간을 받는다. slots는 필수이며 null이나 null 원소는 허용하지 않는다.
- 모든 기간 조회는 from/to 양 끝을 포함하고 최대 31일이다. from > to, 누락·잘못된 날짜, 32일 이상 요청은 400이다. 기준은 Asia/Seoul의 달력 날짜다.
- 예외가 있으면 그날 반복 일정을 완전히 대체한다. 예외의 빈 slots는 하루 전체 불가능이며, 예외가 없으면 반복 일정을 사용한다.
- 반복 일정을 교체·비워도 이미 등록한 날짜별 예외는 유지된다. 예외 삭제 후에만 반복 일정으로 돌아간다.
- 그룹 응답은 날짜 → 멤버 ID → 시작 분 순서다. 일정이 없는 멤버와 날짜도 생략하지 않는다.
- 입력 전체를 검증한 후 멤버 행을 잠그고 하나의 트랜잭션으로 교체한다. 같은 멤버의 일정 쓰기는 직렬화되며 마지막으로 저장된 전체 요청이 남는다. 클라이언트 버전 기반 충돌 감지는 제공하지 않는다.
- 그룹/예외 기간 조회는 같은 DB 스냅샷에서 일괄 조회하고 메모리에서 계산한다. 날짜마다 추가 DB 조회를 하지 않는다.

### 반복 일정 저장·조회

PUT /api/members/me/weekly-availability 요청:

```json
{
  "slots": [
    {"dayOfWeek": "MONDAY", "startMinute": 1140, "endMinute": 1260},
    {"dayOfWeek": "MONDAY", "startMinute": 1260, "endMinute": 1440}
  ]
}
```

200 응답 및 이후 GET 응답(인접 구간 병합):

```json
{
  "slots": [
    {"dayOfWeek": "MONDAY", "startMinute": 1140, "endMinute": 1440}
  ]
}
```

등록하지 않은 요일은 참여 불가능이다. {"slots":[]}로 모든 반복 일정을 삭제한다. 저장 실패 또는 검증 오류가 있으면 이전 반복 일정이 유지된다.

### 날짜별 예외 저장·삭제·조회

PUT /api/members/me/availability-overrides/2026-11-16 요청:

```json
{
  "slots": [
    {"startMinute": 1260, "endMinute": 1380}
  ]
}
```

200 응답:

```json
{
  "date": "2026-11-16",
  "slots": [
    {"startMinute": 1260, "endMinute": 1380}
  ]
}
```

같은 날짜로 다시 PUT하면 기존 슬롯만 전체 교체하며 예외 행의 ID·생성 시각은 유지한다. {"slots":[]}도 유효한 예외다.

GET /api/members/me/availability-overrides?from=2026-11-16&to=2026-11-17 응답 예시:

```json
[
  {"date": "2026-11-16", "slots": [{"startMinute": 1260, "endMinute": 1380}]},
  {"date": "2026-11-17", "slots": []}
]
```

예외가 등록된 날짜만 반환하며 빈 슬롯 예외도 포함한다. 등록된 예외가 없으면 []다. DELETE /api/members/me/availability-overrides/2026-11-16은 관련 슬롯까지 삭제하고 응답 본문 없이 204를 반환한다. 이미 삭제된 경우에도 204다.

### 그룹 멤버별 최종 가능 시간

GET /api/groups/1/availability?from=2026-11-16&to=2026-11-16 응답 예시:

```json
{
  "groupId": 1,
  "days": [
    {
      "date": "2026-11-16",
      "members": [
        {
          "memberId": 10,
          "nickname": "파티장",
          "source": "OVERRIDE",
          "slots": [{"startMinute": 1260, "endMinute": 1380}]
        },
        {
          "memberId": 11,
          "nickname": "새로운멤버",
          "source": "WEEKLY",
          "slots": [{"startMinute": 1200, "endMinute": 1320}]
        }
      ]
    }
  ]
}
```

source는 WEEKLY 또는 OVERRIDE다. 반복 일정이 없으면 WEEKLY + 빈 slots, 하루 전체 불가능 예외는 OVERRIDE + 빈 slots다. 기존의 분 단위 데이터도 조회 시 합집합으로 정규화해 중복 표시를 방지한다.

### 공통 시간 및 참여 가능 인원

동일한 조건에서 GET /api/groups/1/common-availability?from=2026-11-16&to=2026-11-16 응답 예시:

```json
{
  "groupId": 1,
  "days": [
    {
      "date": "2026-11-16",
      "totalMembers": 2,
      "timeSlots": [
        {"startMinute": 0, "endMinute": 1200, "availableCount": 0, "availableMemberIds": [], "allAvailable": false},
        {"startMinute": 1200, "endMinute": 1260, "availableCount": 1, "availableMemberIds": [11], "allAvailable": false},
        {"startMinute": 1260, "endMinute": 1320, "availableCount": 2, "availableMemberIds": [10, 11], "allAvailable": true},
        {"startMinute": 1320, "endMinute": 1380, "availableCount": 1, "availableMemberIds": [10], "allAvailable": false},
        {"startMinute": 1380, "endMinute": 1440, "availableCount": 0, "availableMemberIds": [], "allAvailable": false}
      ]
    }
  ]
}
```

하루의 48개 30분 구간을 계산하고 참여 멤버 구성이 같은 인접 구간을 병합한다. 인원수만 같고 멤버가 다르면 병합하지 않는다. 0명 구간도 포함하므로 결과는 항상 [0,1440)을 빈틈없이 덮는다. 프론트는 이를 30분 칸으로 펼쳐 표시할 수 있다.

availableMemberIds는 GroupMember ID 오름차순이다. allAvailable은 그룹 인원이 1명 이상이며 availableCount가 totalMembers와 같을 때만 true다. 한 명이라도 해당 시간에 불가능하면 false이고, 빈 그룹도 false다. 기존 데이터에 30분 배수가 아닌 구간이 있으면 30분 전체를 덮는 칸만 가능으로 계산한다.

### 일정 오류 코드

기존 공통 JSON 오류 형식을 그대로 사용한다.

| HTTP | code | 상황 |
|---|---|---|
| 400 | INVALID_REQUEST | 날짜 형식·필수값·길이/개수·필드 범위 오류 |
| 400 | INVALID_TIME_SLOT | 시작/종료 관계 또는 30분 단위 위반 |
| 400 | OVERLAPPING_TIME_SLOTS | 같은 요일 또는 날짜의 구간 겹침 |
| 400 | INVALID_DATE_RANGE | 역순 기간 또는 31일 초과 |
| 401 | UNAUTHORIZED | 멤버 토큰 누락·불일치 |
| 403 | FORBIDDEN | 다른 그룹 일정 조회 |
| 404 | GROUP_NOT_FOUND | 존재하지 않는 그룹 |
| 500 | INTERNAL_ERROR | 저장 등 처리 실패, SQL/내부 예외는 제외 |

## 게임 카테고리

아래 API는 모두 소속 그룹의 Bearer 인증이 필요하다. 목록은 모든 멤버, 생성·수정·삭제는 OWNER만 가능하다.

| Method | Endpoint | 성공 응답 |
|---|---|---|
| GET | /api/groups/{groupId}/categories | 200, Category 배열(ID 오름차순) |
| POST | /api/groups/{groupId}/categories | 201, Category 및 Location 헤더 |
| PUT | /api/groups/{groupId}/categories/{categoryId} | 200, Category |
| DELETE | /api/groups/{groupId}/categories/{categoryId} | 204, 본문 없음 |

POST·PUT 요청:

```json
{"name":"로스트아크","description":"레이드 공략 및 정보"}
```

Category 응답 예시(GET은 이 객체의 배열):

```json
{"categoryId":1,"name":"로스트아크","description":"레이드 공략 및 정보","createdAt":"2026-11-14T10:00:00"}
```

이름은 필수이며 최대 100자, 설명은 선택이며 최대 2,000자다. 양 끝 공백을 제거하고 NFC 정규화한 후 검증한다. 같은 그룹 안에서 이름이 중복되면 409다. 수정 시 연결된 게시글은 유지한다. 게시글이 있는 카테고리 삭제는 409이며 자동 삭제하지 않는다.

## 공략 게시글

모두 소속 그룹의 Bearer 인증이 필요하다. 작성자는 Body가 아닌 인증 토큰으로 결정한다. 작성자만 수정할 수 있으며 OWNER라도 타인의 글은 수정할 수 없다. 삭제는 작성자 또는 OWNER가 가능하다.

| Method | Endpoint | 성공 응답 |
|---|---|---|
| POST | /api/groups/{groupId}/posts | 201, `{"postId":3}` 및 Location 헤더 |
| GET | /api/groups/{groupId}/posts?page=0&size=20&categoryId=1 | 200, 아래 페이지 응답 |
| GET | /api/groups/{groupId}/posts/{postId} | 200, 상세 응답 |
| PUT | /api/groups/{groupId}/posts/{postId} | 200, 수정된 상세 응답 |
| DELETE | /api/groups/{groupId}/posts/{postId} | 204, 본문 없음 |

POST·PUT 요청은 동일하다. categoryId는 같은 그룹의 카테고리 ID이며 필수다. 제목·본문은 공백만 입력할 수 없으며 각각 최대 200자·20,000자다. 양 끝 공백 제거·NFC 정규화 후 저장하며 내부 줄바꿈은 유지한다. authorId는 요청하지 않는다.

```json
{"categoryId":1,"title":"이번 주 레이드 공략","content":"주요 패턴 정리\nhttps://example.com/guide"}
```

페이지 응답 예시:

```json
{
  "content":[{"postId":3,"title":"이번 주 레이드 공략","categoryId":1,"categoryName":"로스트아크","authorId":10,"authorNickname":"파티장","createdAt":"2026-11-14T10:00:00","updatedAt":"2026-11-14T10:00:00"}],
  "page":0,"size":20,"totalElements":1,"totalPages":1,"hasNext":false
}
```

page 기본값은 0(0 이상), size는 20(1~50)이다. categoryId를 생략하면 전체 카테고리를 조회한다. 정렬은 createdAt DESC, id DESC이며 본문은 목록에 포함하지 않는다. 빈 페이지는 content=[], totalElements=0, totalPages=0, hasNext=false다. 대시보드 최신 글은 같은 API에 size=5를 사용한다.

상세·수정 응답 예시:

```json
{"postId":3,"groupId":1,"categoryId":1,"categoryName":"로스트아크","authorId":10,"authorNickname":"파티장","title":"이번 주 레이드 공략","content":"주요 패턴 정리\nhttps://example.com/guide","createdAt":"2026-11-14T10:00:00","updatedAt":"2026-11-14T11:00:00"}
```

본문은 일반 텍스트다. React는 HTML을 이스케이프하고 줄바꿈을 유지하며 HTTP(S) URL만 링크로 표시한다. 외부 링크는 새 탭과 noopener noreferrer를 사용한다. 인증 토큰·해시는 어떤 게시판 응답에도 포함하지 않는다. 카테고리 또는 작성자가 다른 그룹인 게시글은 복합 FK로도 차단한다.

### 게시판 오류

공통 오류 형식은 `{"status":409,"code":"CATEGORY_IN_USE","message":"게시글을 먼저 정리해 주세요."}`다.

| HTTP | code | 상황 |
|---|---|---|
| 400 | INVALID_REQUEST | 필수값·길이·페이지·size·ID 형식 오류 |
| 401 | UNAUTHORIZED | 토큰 누락 또는 무효 |
| 403 | FORBIDDEN | 다른 그룹 접근 또는 작성자·OWNER 권한 부족 |
| 404 | GROUP_NOT_FOUND | 존재하지 않는 그룹 |
| 404 | CATEGORY_NOT_FOUND | 해당 그룹에 없는 카테고리 |
| 404 | POST_NOT_FOUND | 해당 그룹에서 조회할 수 없는 게시글 |
| 409 | CATEGORY_NAME_CONFLICT | 그룹 내 카테고리 이름 중복(동시 생성 포함) |
| 409 | CATEGORY_IN_USE | 게시글이 있는 카테고리 삭제 |
| 409 | CATEGORY_CONFLICT | 동시 삭제·생성으로 카테고리 FK 제약조건 충돌 |
| 500 | INTERNAL_ERROR | 예상하지 못한 오류; 내부 SQL·스택은 반환하지 않음 |

프론트엔드 경로는 `/groups/:groupId/posts`, `/posts/new`, `/posts/:postId`, `/posts/:postId/edit`, `/groups/:groupId/categories`다(게시글 하위 경로는 동일 그룹 경로 기준). 목록은 page·categoryId 쿼리로 필터와 페이지를 유지한다. 생성·수정·삭제 시 해당 그룹 게시판 캐시를 갱신하며, 카테고리 변경 시 게시글의 분류 이름도 다시 조회한다. 최신 글 패널 오류는 일정표와 분리한다.

## 계정·세션 인증

JWT나 쿠키를 사용하지 않는다. 비회원 토큰은 기존 43자 형식이고, 계정 토큰은 `u_` + 43자 난수, 계정 기반 그룹 토큰은 `m_` + 43자 난수다. 각각 256비트 난수이며 DB에는 전체 토큰의 SHA-256 해시만 저장한다. 아래 모든 응답(오류 포함)은 Cache-Control: no-store다.

| Method | Endpoint | 인증 | 성공 |
|---|---|---|---|
| POST | /api/auth/register | 공개 | 201, 계정 세션 |
| POST | /api/auth/login | 공개 | 200, 계정 세션 |
| GET | /api/account/me | 계정 토큰 | 200, 계정 정보 |
| GET | /api/account/groups | 계정 토큰 | 200, 연결된 그룹 배열 |
| POST | /api/account/memberships/claim | 계정 토큰 | 200, 새 그룹 세션 |
| POST | /api/account/groups/{groupId}/session | 계정 토큰 | 200, 새 그룹 세션 |
| POST | /api/auth/logout | 계정 토큰 | 204 |
| POST | /api/members/me/session/logout | 계정 기반 그룹 토큰 | 204 |

계정 토큰을 그룹·일정·게시판 API에 보내거나 그룹 토큰을 계정 관리 API에 보내면 403이다. 무효·만료·폐기된 토큰은 401이다. 그룹 생성·초대 가입은 계속 공개 API이며 기존 비회원 흐름은 유지된다.

### 등록·로그인

두 API는 동일한 요청을 사용한다.

```json
{"loginId":"raidmaster01","password":"example-password-123"}
```

로그인 ID는 양 끝 공백 제거 후 소문자로 변환한다. ASCII 영문·숫자·밑줄 4~32자이며 첫 글자는 영문·숫자다. 비밀번호는 공백·Unicode 정규화를 하지 않는다. 12자 이상, UTF-8 72바이트 이하이고 NUL 문자를 허용하지 않는다. BCrypt 비용 계수 12로 저장한다. 등록은 전체 서비스에서 ID 중복을 거절하며 로그인 실패는 계정 유무와 무관하게 일반적인 401 응답이다.

```json
{"user":{"userId":1,"loginId":"raidmaster01","createdAt":"2026-11-15T10:00:00"},"accountAccessToken":"u_<random-43-characters>","expiresAt":"2026-11-22T01:00:00Z"}
```

성공한 로그인은 다른 기기의 세션을 유지한다. 등록과 로그인은 기본적으로 5분 동안 IP별 30회, 정규화된 ID별 10회로 제한한다(성공 요청도 포함). 초과 시 429이며 `AUTH_RATE_LIMITED`를 반환한다. 실제 접속 주소를 사용하고 임의 X-Forwarded-For는 신뢰하지 않는다. 제한은 단일 프로세스 메모리 기준으로, 다중 인스턴스 운영에서는 별도 공유 정책이 필요하다.

### 내 계정·그룹

`GET /api/account/me` 응답은 위 user 객체다. 비밀번호 및 토큰 해시는 포함하지 않는다.

`GET /api/account/groups`는 연결된 멤버 ID 오름차순 배열이다. 연결된 그룹이 없으면 []다.

```json
[{"groupId":1,"groupName":"저녁 레이드","memberId":10,"nickname":"파티장","role":"OWNER","joinedAt":"2026-11-14T10:00:00"}]
```

### 비회원 연결·기존 그룹 재입장

`POST /api/account/memberships/claim`은 계정 토큰을 Authorization에 보내고 실제 보유한 비회원 토큰을 Body로 전달한다.

```json
{"memberAccessToken":"<existing-guest-token>"}
```

그룹 ID·닉네임만으로는 연결할 수 없다. 연결 성공 시 기존 멤버 ID·닉네임·권한·일정·게시글을 유지하고 과거 비회원 토큰을 즉시 폐기한다. 새 그룹 세션 발급까지 단일 트랜잭션이며 실패하면 기존 비회원 인증을 유지한다. 이미 연결되거나 무효인 토큰은 409 CLAIM_UNAVAILABLE이고, 동일 계정이 이미 같은 그룹의 다른 멤버에 연결되어 있으면 409 MEMBERSHIP_CONFLICT다.

`POST /api/account/groups/{groupId}/session`은 Body 없이 현재 계정에 연결된 기존 멤버 세션을 발급한다. 연결되지 않은 그룹은 403이다. 두 API의 성공 응답은 동일하다.

```json
{"group":{"groupId":1,"name":"저녁 레이드","description":null,"memberCount":2,"createdAt":"2026-11-14T10:00:00"},"member":{"memberId":10,"nickname":"파티장","role":"OWNER","joinedAt":"2026-11-14T10:00:00"},"memberAccessToken":"m_<random-43-characters>","expiresAt":"2026-11-15T13:00:00Z"}
```

이후 기존 그룹 API에는 위 memberAccessToken을 사용한다. 재입장은 새 GroupMember를 만들거나 다른 기기의 멤버 세션을 폐기하지 않는다. 계정 연결은 성공했으나 응답을 잃었다면 로그인 후 그룹 목록에서 재입장해 복구한다. 기존 비회원 토큰도 없고 계정 연결도 하지 않았다면 닉네임만으로는 복구할 수 없다.

### 만료·로그아웃·브라우저 보관

계정 세션은 기본 7일, 그룹 세션은 기본 12시간이다. 그룹 만료는 부모 계정 만료를 넘지 않는다. `ACCOUNT_SESSION_TTL`, `MEMBER_SESSION_TTL`은 ISO-8601 Duration 설정값이다. 두 세션 모두 만료 시각과 같은 순간부터 인증을 거절한다. 부모가 만료·폐기된 그룹 세션도 거절한다.

계정 로그아웃은 현재 계정 세션과 그 하위 그룹 세션만 폐기한다. 다른 기기의 세션은 유지한다. 그룹 로그아웃은 해당 `m_` 토큰만 폐기하므로 유효한 계정 토큰으로 다시 입장할 수 있다. 비회원 토큰으로 서버 그룹 로그아웃을 호출하면 409 GUEST_SESSION이다. 대시보드의 비회원 참여 정보 삭제는 브라우저 저장소만 지우는 동작이며 서버 폐기와 다르다.

React의 `/register`, `/login`, `/account`, `/account/groups`에서 등록·복구·연결·로그아웃을 지원한다. 계정 및 계정 기반 그룹 토큰은 sessionStorage에 보관하고 비회원은 기존 localStorage에 보관한다. 새로고침에는 유지되며 탭 종료 후에는 다시 로그인한다. 인증은 `/account/me`, `/members/me`로 재확인한다. 연결한 그룹 캐시는 계정 전환·만료·로그아웃 시 제거하며 비회원 참여 정보는 보존한다. 로그인 상태에서 새 그룹 생성·가입을 하면 비회원 응답을 먼저 안전하게 저장한 뒤 계정 연결을 시도한다. 연결 실패는 계정 화면에서 재시도할 수 있다.

sessionStorage 역시 XSS에 안전한 보관소가 아니다. HTTPS·CSP·외부 스크립트 제한·인증 요청/응답 로그 제외가 필요하다. 쿠키 인증을 도입하지 않아 기존 CORS credentials=false·CSRF 비활성화 정책을 유지한다. 비밀번호 찾기·이메일 인증·OAuth2는 제공하지 않는다.

| HTTP | code | 의미 |
|---|---|---|
| 400 | INVALID_REQUEST / INVALID_PASSWORD | ID·필수값·비밀번호 길이 및 바이트 제한 |
| 401 | UNAUTHORIZED | 잘못된 로그인 또는 무효·만료·폐기 토큰 |
| 403 | FORBIDDEN | 잘못된 토큰 유형 또는 미연결 그룹 |
| 409 | LOGIN_ID_CONFLICT | 정규화된 ID 중복 |
| 409 | CLAIM_UNAVAILABLE | 연결할 수 없는 비회원 토큰 |
| 409 | MEMBERSHIP_CONFLICT | 같은 계정의 그룹 중복 연결 |
| 409 | GUEST_SESSION | 비회원 토큰의 그룹 로그아웃 시도 |
| 429 | AUTH_RATE_LIMITED | 등록·로그인 요청 제한 |
| 429 | PUBLIC_API_RATE_LIMITED | 운영의 공개 그룹 생성·가입 요청 제한 |

운영 프로파일의 그룹 생성은 기본 IP별 분당 10회, 가입은 분당 30회로 제한하며 본문 검증 전에도 적용된다. 응답은 공통 JSON 429, Cache-Control: no-store다. Caddy가 외부 전달 헤더를 신뢰하지 않고 Tomcat은 Caddy의 내부 IP만 신뢰하도록 구성한다. 운영 Caddy에서 HTTPS와 보안 헤더를 담당하고 HSTS는 실제 TLS 검증 이후에만 켠다. 기존 Bearer 토큰·API 계약·마이그레이션 V1~V3는 유지한다.

## 참고

- [Spring Security CORS](https://docs.spring.io/spring-security/reference/7.0/servlet/integrations/cors.html)
- [Spring Boot MockMvc 테스트](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html)
