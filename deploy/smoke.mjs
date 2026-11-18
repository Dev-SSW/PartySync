// 로컬·CI 전용 배포 검사로, 개발용 .env와 기존 DB는 사용하지 않는다.
import { spawnSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'

const root = resolve(import.meta.dirname, '..')
// 저장소의 마이그레이션 목록과 실제 적용 버전을 비교한다.
const migrationVersions = readdirSync(join(root, 'src/main/resources/db/migration'))
  .map(file => /^V(\d+(?:[._]\d+)*)__.+\.sql$/.exec(file)?.[1].replaceAll('_', '.'))
  .filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
assert.ok(migrationVersions.length > 0)
const project = `partysync-smoke-${Date.now()}-${randomBytes(4).toString('hex')}`
const work = join(root, 'build', project)
mkdirSync(work, { recursive: true, mode: 0o700 })
const adminPassword = randomBytes(32).toString('hex'), appPassword = randomBytes(32).toString('hex')
const adminFile = join(work, 'admin.txt'), appFile = join(work, 'app.txt'), envFile = join(work, '.env')
// 운영용 텍스트 시크릿 파일과 같은 줄바꿈 형식으로 테스트 값을 저장한다.
writeFileSync(adminFile, adminPassword + '\n', { mode: 0o444 }); writeFileSync(appFile, appPassword + '\n', { mode: 0o444 })
const tag = 'phase7-local'
const base = 'http://localhost:18080'
const isolatedEnvLines = [
  `COMPOSE_PROJECT_NAME=${project}`, 'SITE_ADDRESS=http://localhost', 'ACME_EMAIL=qa@example.invalid',
  'POSTGRES_DB=partysync_smoke', 'APP_DB_USER=partysync_app',
  `POSTGRES_ADMIN_PASSWORD_FILE=${adminFile.replaceAll('\\', '/')}`, `APP_DB_PASSWORD_FILE=${appFile.replaceAll('\\', '/')}`,
  'BACKEND_IMAGE=partysync-backend', 'FRONTEND_IMAGE=partysync-web', `IMAGE_TAG=${tag}`,
  'PUBLIC_BIND_IP=127.0.0.1', 'HTTP_PORT=18080', 'HTTPS_PORT=18443', 'HSTS_ENABLED=false',
  'PROXY_SUBNET=172.30.78.0/28', 'PROXY_IP=172.30.78.2', 'BACKEND_PROXY_IP=172.30.78.3', 'TRUSTED_PROXY_REGEX=172[.]30[.]78[.]2',
]
const isolatedEnvironment = Object.fromEntries(isolatedEnvLines.map(line => {
  const split = line.indexOf('=')
  return [line.slice(0, split), line.slice(split + 1)]
}))
writeFileSync(envFile, isolatedEnvLines.join('\n') + '\n', { mode: 0o600 })
const args = ['compose', '--project-directory', root, '--env-file', envFile, '-f', join(root, 'compose.prod.yaml')]
const docker = (...extra) => run('docker', extra)
const compose = (...extra) => docker(...args, ...extra)
function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...isolatedEnvironment, ...env } })
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.replaceAll(adminPassword, '[REDACTED]').replaceAll(appPassword, '[REDACTED]')
    throw new Error(`${command} failed: ${output.slice(-5000)}`)
  }
  return result.stdout.trim()
}
function pass(message) { console.log(`PASS ${message}`) }
async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(path.startsWith('/api') ? { Origin: base, 'X-PartySync-Client': 'web' } : {}), ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) })
  const text = await response.text()
  assert.ok(!text.includes(adminPassword) && !text.includes(appPassword))
  return { status: response.status, headers: response.headers, text, data: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : undefined }
}
async function ok(path, options, status = 200) { const result = await request(path, options); assert.equal(result.status, status, `${path}: unexpected status`); return result.data }
async function waitHealthy() {
  for (let i = 0; i < 90; i++) {
    try { if ((await request('/healthz')).status === 200) return } catch { /* 시작·재연결 중에는 다시 확인한다. */ }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error('Backend did not recover')
}
const query = sql => compose('exec', '-T', 'postgres', 'sh', '-ec', 'export PGPASSWORD="$(cat /run/secrets/DB_PASSWORD)"; exec psql -X -h 127.0.0.1 -U "$APP_DB_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "$1"', 'sh', sql)
const backupEnv = { PARTYSYNC_ENV_FILE: envFile, BACKUP_DIR: join(work, 'backups') }
const bash = process.env.PARTYSYNC_BASH || 'bash'
let started = false
try {
  for (const port of [18080, 18443]) await new Promise((resolve, reject) => { const socket = createServer(); socket.once('error', reject); socket.listen(port, '127.0.0.1', () => socket.close(resolve)) })
  compose('config', '--quiet')
  // 외부 환경 변수로 격리 설정이 바뀌었으면 Docker 리소스를 변경하지 않는다.
  const config = JSON.parse(compose('config', '--format', 'json'))
  assert.equal(config.name, project)
  assert.equal(config.services.postgres.environment.POSTGRES_DB, 'partysync_smoke')
  assert.ok(config.services['reverse-proxy'].ports.every(port => port.host_ip === '127.0.0.1'))
  assert.equal(config.services.backend.image, `partysync-backend:${tag}`)
  assert.equal(config.services['reverse-proxy'].image, `partysync-web:${tag}`)
  if (process.env.PARTYSYNC_SKIP_BUILD !== '1') compose('build', 'backend', 'reverse-proxy')
  started = true
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '240')
  await waitHealthy()
  assert.ok(!config.services.backend.ports && !config.services.postgres.ports)
  assert.equal(config.networks.database.internal, true)
  assert.equal(query("select rolsuper from pg_roles where rolname=current_user"), 'f')
  assert.equal(query("select string_agg(version, ',' order by installed_rank) from flyway_schema_history where success and version is not null"), migrationVersions.join(','))
  assert.equal(docker('image', 'inspect', '--format', '{{.Config.User}}', `partysync-backend:${tag}`), '10001:10001')
  for (const service of ['backend', 'postgres']) {
    const inspect = docker('inspect', compose('ps', '-q', service))
    assert.ok(!inspect.includes(adminPassword) && !inspect.includes(appPassword))
  }
  pass(`all containers healthy; migrations ${migrationVersions.join(',')} + Hibernate validate; non-root backend; non-superuser DB; no DB/API published ports or env passwords`)

  for (const path of ['/', '/login', '/register', '/account', '/groups/1', '/groups/1/posts', '/join/example']) {
    const page = await request(path); assert.equal(page.status, 200); assert.ok(page.text.includes('<div id="root">'))
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer'); assert.ok(page.headers.get('content-security-policy').includes("script-src 'self'"))
    assert.equal(page.headers.get('strict-transport-security'), null)
  }
  const apiMissing = await request('/api/unknown'); assert.equal(apiMissing.status, 401); assert.ok(!apiMissing.text.includes('<html'))
  assert.equal((await request('/actuator/env')).status, 404)
  pass('SPA deep links; API JSON stays separate from index.html; security headers; HSTS disabled before real HTTPS approval')

  const owner = await ok('/api/groups', { method: 'POST', body: { name: 'Container smoke party', ownerNickname: 'Owner' } }, 201)
  const groupId = owner.group.groupId, ownerId = owner.member.memberId, guestToken = owner.memberAccessToken
  const member = await ok('/api/groups/join', { method: 'POST', body: { inviteCode: owner.inviteCode, nickname: 'Member' } }, 201)
  const userId = 'smoke_' + Date.now(), password = randomBytes(18).toString('base64url')
  const registered = await ok('/api/auth/register', { method: 'POST', body: { loginId: userId, password } }, 201)
  const accountToken = registered.accountAccessToken
  const linked = await ok('/api/account/memberships/claim', { method: 'POST', token: accountToken, body: { memberAccessToken: guestToken } })
  assert.equal(linked.member.memberId, ownerId)
  await ok('/api/members/me', { token: guestToken }, 401)
  await ok('/api/account/me', { token: member.memberAccessToken }, 403)
  await ok('/api/members/me', { token: accountToken }, 403)
  let ownerToken = linked.memberAccessToken
  await ok('/api/members/me/weekly-availability', { method: 'PUT', token: ownerToken, body: { slots: [{ dayOfWeek: 'MONDAY', startMinute: 1140, endMinute: 1260 }] } })
  await ok('/api/members/me/availability-overrides/2026-11-16', { method: 'PUT', token: ownerToken, body: { slots: [] } })
  const availability = await ok(`/api/groups/${groupId}/availability?from=2026-11-16&to=2026-11-16`, { token: ownerToken })
  assert.equal(availability.days[0].members.find(m => m.memberId === ownerId).source, 'OVERRIDE')
  const category = await ok(`/api/groups/${groupId}/categories`, { method: 'POST', token: ownerToken, body: { name: 'Game' } }, 201)
  await ok(`/api/groups/${groupId}/categories`, { method: 'POST', token: member.memberAccessToken, body: { name: 'Forbidden' } }, 403)
  const post = await ok(`/api/groups/${groupId}/posts`, { method: 'POST', token: member.memberAccessToken, body: { categoryId: category.categoryId, title: 'Guide', content: 'https://example.com' } }, 201)
  await ok(`/api/groups/${groupId}/posts/${post.postId}`, { method: 'PUT', token: ownerToken, body: { categoryId: category.categoryId, title: 'Forbidden edit', content: 'Body' } }, 403)
  await ok(`/api/groups/${groupId}/posts/9999999`, { token: ownerToken }, 404)
  const foreign = await ok('/api/groups', { method: 'POST', body: { name: 'Foreign party', ownerNickname: 'Foreign' } }, 201)
  await ok(`/api/groups/${foreign.group.groupId}/posts`, { token: ownerToken }, 403)
  pass('real group/join/account claim, old token revoked, principal separation, schedules/empty override, board ownership and cross-group 403/404')

  const otherDevice = await ok('/api/auth/login', { method: 'POST', body: { loginId: userId, password } })
  const otherMember = await ok(`/api/account/groups/${groupId}/session`, { method: 'POST', token: otherDevice.accountAccessToken })
  assert.equal(otherMember.member.memberId, ownerId)
  await ok('/api/auth/logout', { method: 'POST', token: otherDevice.accountAccessToken }, 204)
  await ok('/api/members/me', { token: otherMember.memberAccessToken }, 401)
  await ok('/api/members/me', { token: ownerToken })
  await ok('/api/members/me/session/logout', { method: 'POST', token: ownerToken }, 204)
  ownerToken = (await ok(`/api/account/groups/${groupId}/session`, { method: 'POST', token: accountToken })).memberAccessToken
  const hash = createHash('sha256').update(ownerToken).digest('hex')
  query(`update member_session set created_at=now()-interval '2 days', expires_at=now()-interval '1 second' where token_hash='${hash}'`)
  await ok('/api/members/me', { token: ownerToken }, 401)
  ownerToken = (await ok(`/api/account/groups/${groupId}/session`, { method: 'POST', token: accountToken })).memberAccessToken
  pass('independent devices, account/group logout, expiry and reissue preserve original member ID')

  let limited = false
  for (let i = 0; i < 12; i++) {
    const result = await request('/api/groups', { method: 'POST', body: {}, headers: { 'X-Forwarded-For': `192.0.2.${i + 1}`, Forwarded: `for=198.51.100.${i + 1}` } })
    if (result.status === 429) { limited = true; assert.equal(result.data.code, 'PUBLIC_API_RATE_LIMITED'); break }
    assert.equal(result.status, 400)
  }
  assert.ok(limited)
  pass('public group rate limit cannot be bypassed with spoofed forwarding headers through Caddy')

  run(bash, ['deploy/backup.sh'], backupEnv)
  const archive = join(backupEnv.BACKUP_DIR, readdirSync(backupEnv.BACKUP_DIR).find(file => file.endsWith('.dump')))
  const dump = readFileSync(archive); assert.equal(dump.subarray(0, 5).toString(), 'PGDMP')
  run(bash, ['deploy/restore-check.sh', archive], backupEnv)
  pass('real pg_dump custom archive, SHA-256 checksum, isolated database restore check and cleanup')

  const previousDbContainer = compose('ps', '-q', 'postgres')
  compose('stop', 'postgres')
  const unavailable = await request('/api/members/me', { token: ownerToken })
  assert.equal(unavailable.status, 500); assert.ok(!unavailable.text.includes('<html'))
  assert.equal((await request('/healthz')).status, 503)
  compose('up', '-d', '--no-build', '--force-recreate', '--no-deps', '--wait', '--wait-timeout', '120', 'postgres'); await waitHealthy()
  assert.notEqual(compose('ps', '-q', 'postgres'), previousDbContainer)
  assert.equal((await ok('/api/members/me', { token: ownerToken })).memberId, ownerId)
  compose('up', '-d', '--no-build', '--force-recreate', '--no-deps', '--wait', '--wait-timeout', '180', 'backend', 'reverse-proxy')
  await waitHealthy()
  assert.equal((await ok(`/api/groups/${groupId}/posts/${post.postId}`, { token: ownerToken })).title, 'Guide')
  assert.equal((await ok('/api/members/me/weekly-availability', { token: ownerToken })).slots[0].startMinute, 1140)
  pass('DB failure gives JSON 500/health 503; DB and app container recreation retain sessions, schedule and post in named volumes')
  if (process.env.PARTYSYNC_BROWSER_CHECK) console.log(run(process.execPath, [process.env.PARTYSYNC_BROWSER_CHECK]))

  const start = performance.now()
  await Promise.all(Array.from({ length: 10 }, () => ok(`/api/groups/${groupId}/common-availability?from=2026-11-16&to=2026-11-22`, { token: ownerToken })))
  console.log(`Ten concurrent one-week reads: ${Math.round(performance.now() - start)} ms total`)
  console.log(docker('stats', '--no-stream', '--format', '{{.Name}} {{.MemUsage}} {{.CPUPerc}}', ...compose('ps', '-q').split(/\s+/)))
  writeFileSync(join(work, 'result.json'), JSON.stringify({ project, groupId, ownerId, imageTag: tag, backup: archive, browserChecked: !!process.env.PARTYSYNC_BROWSER_CHECK, ok: true }, null, 2))
  pass('small read workload; backup and result artifacts kept only under ignored build/')
} catch (error) {
  if (started) writeFileSync(join(work, 'container-failure.log'), compose('logs', '--no-color', '--tail', '60'))
  throw error
} finally {
  if (started) compose('down', '--remove-orphans') // 데이터 볼륨은 보존하며 down -v는 사용하지 않는다.
  console.log(`Isolated Compose project: ${project}; verification artifacts: ${work}`)
}
