import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../App'
import { AuthProvider } from '../features/member/Auth'
import { readSessions, writeSessions, STORAGE_KEY, ACCOUNT_MEMBERS_KEY } from '../features/member/storage'
import { readAccount, storeAccount, ACCOUNT_KEY } from '../features/account/accountStorage'
import { ACCOUNT_INVALID } from '../api/client'

const accountToken = 'u_' + 'A'.repeat(43), memberToken = 'm_' + 'C'.repeat(43), guestToken = 'G'.repeat(43)
const user = { userId: 1, loginId: 'raidmaster', createdAt: '2026-11-15T10:00:00' }
const expiry = '2030-11-15T10:00:00Z'
const membership = { group: { groupId: 1, name: '원래 파티', description: '', memberCount: 1, createdAt: '' }, member: { memberId: 10, nickname: '원래 닉네임', role: 'OWNER', joinedAt: '' }, memberAccessToken: memberToken, expiresAt: expiry }
const guest = { groupId: 1, name: '원래 파티', token: guestToken, revision: 'guest' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
function seedAccount() { storeAccount({ token: accountToken, user, revision: 'account-one', expiresAt: expiry }) }
function setup(path: string, options: { restore?: boolean; restoreFailure?: number; resume?: boolean; failLogin?: boolean; expireAccount?: boolean; failClaim?: boolean; failLogout?: boolean; failEntry?: boolean; groupsEmpty?: boolean; joinConflictOnce?: boolean } = {}) {
  let claimed = false, signedOut = false
  let joinAttempts = 0
  let pushSubscribed = false
  const fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith('/auth/refresh')) return options.restoreFailure ? json({}, options.restoreFailure) : options.restore ? json({ user, accountAccessToken: accountToken, expiresAt: expiry }) : json({ code: 'UNAUTHORIZED' }, 401)
    if (url.includes('/auth/')) url = url.split('?')[0]
    if (url.includes('/auth/') && init.method !== 'POST') throw new Error('Expected POST authentication request')
    if (url.endsWith('/auth/login') || url.endsWith('/auth/register')) return options.failLogin ? json({ code: 'UNAUTHORIZED' }, 401) : json({ user, accountAccessToken: accountToken, expiresAt: expiry }, url.endsWith('register') ? 201 : 200)
    if (url.endsWith('/account/me')) return options.expireAccount || signedOut ? json({ code: 'UNAUTHORIZED' }, 401) : json(user)
    if (url.endsWith('/account/groups')) return json(options.groupsEmpty && !claimed ? [] : [{ groupId: 1, groupName: '원래 파티', memberId: 10, nickname: '원래 닉네임', role: 'OWNER', joinedAt: '' }])
    if (url.endsWith('/account/invite/session')) return options.resume ? json(membership) : json({ code: 'MEMBERSHIP_NOT_FOUND' }, 404)
    if (url.endsWith('/push/configuration')) return json({ enabled: true, publicKey: btoa(String.fromCharCode(4) + '\0'.repeat(64)).replace(/=/g, '') })
    if (url.endsWith('/push/status')) return json({ subscribed: pushSubscribed })
    if (url.endsWith('/push/subscription') && init.method === 'PUT') { pushSubscribed = true; return new Response(null, { status: 204 }) }
    if (url.endsWith('/account/groups/join')) { joinAttempts++; return options.joinConflictOnce && joinAttempts === 1 ? json({ code: 'NICKNAME_CONFLICT' }, 409) : json(membership, 201) }
    if (url.endsWith('/memberships/claim')) { if (options.failClaim) return json({ code: 'MEMBERSHIP_CONFLICT' }, 409); claimed = true; return json(membership) }
    if (url.endsWith('/account/groups/1/session')) return options.failEntry ? json({ code: 'UNAUTHORIZED' }, 401) : json(membership)
    if (url.endsWith('/auth/logout')) { if (options.failLogout) return json({}, 500); signedOut = true; return new Response(null, { status: 204 }) }
    if (url.endsWith('/members/me/session/logout')) return new Response(null, { status: 204 })
    if (url.endsWith('/groups') || url.endsWith('/groups/join')) return json({ ...membership, memberAccessToken: guestToken, inviteCode: 'I'.repeat(43) }, 201)
    if (url.endsWith('/members/me')) return json({ memberId: 10, groupId: 1, nickname: '원래 닉네임', role: 'OWNER' })
    if (url.includes('/posts?')) return json({ content: [], page: 0, size: 5, totalElements: 0, totalPages: 0, hasNext: false })
    if (url.endsWith('/members')) return json([{ ...membership.member }])
    if (url.includes('common-availability') || url.includes('/availability?')) return json({ groupId: 1, days: [] })
    return json(membership.group)
  })
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<QueryClientProvider client={client}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider>)
  return { fetch, router, client }
}

describe('계정 등록과 로그인', () => {
  async function fillInvitation() {
    await userEvent.type(await screen.findByLabelText(/내 닉네임/), '참여자')
    await userEvent.type(screen.getByLabelText('로그인 ID'), 'raidmaster')
    await userEvent.type(screen.getByLabelText('비밀번호', { exact: true }), 'safe-password-123')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'safe-password-123')
  }
  it('초대 가입이 끝나 파티에 입장하면 수신 여부를 묻고 동의 시 해당 파티 알림을 켠다', async () => {
    let subscription: { endpoint: string; toJSON: () => unknown } | null = null
    const registration = { active: {}, pushManager: {
      getSubscription: async () => subscription,
      subscribe: vi.fn(async () => {
        subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/invited-device', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/invited-device', keys: { p256dh: 'public', auth: 'auth' } }) }
        return subscription
      }),
    } }
    const nav = { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: 0,
      serviceWorker: { getRegistration: async () => registration, register: async () => registration } }
    vi.stubGlobal('navigator', nav)
    vi.stubGlobal('PushManager', class {})
    const requestPermission = vi.fn(async () => 'granted')
    vi.stubGlobal('Notification', { requestPermission, permission: 'default' })
    const { fetch, router } = setup('/join/invitation')
    await fillInvitation()
    await userEvent.click(screen.getByRole('button', { name: '계정 만들고 파티 참여하기' }))
    await screen.findByRole('dialog', { name: '원래 파티의 일정 알림을 받을까요?' })
    expect(router.state.location.pathname).toBe('/groups/1')
    expect(requestPermission).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '알림 받기' }))
    await screen.findByRole('button', { name: '이 파티 알림 끄기' })
    expect(requestPermission).toHaveBeenCalledOnce()
    expect(fetch.mock.calls.find(([url, init]) => url.endsWith('/push/subscription') && init.method === 'PUT')![1].headers.Authorization).toBe(`Bearer ${memberToken}`)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('초대 링크는 계정 생성을 기본으로 하고 가입 후 계정으로 파티에 바로 참여한다', async () => {
    const { fetch } = setup('/join/invitation')
    await fillInvitation()
    await userEvent.click(screen.getByRole('button', { name: '계정 만들고 파티 참여하기' }))
    await screen.findByRole('heading', { name: '원래 파티' })
    expect(readSessions()[0]).toMatchObject({ token: memberToken, accountUserId: 1 })
    expect(fetch.mock.calls.filter(c => c[0].includes('/auth/register'))).toHaveLength(1)
    const joined = fetch.mock.calls.find(c => c[0].endsWith('/account/groups/join'))!
    expect(JSON.parse(joined[1].body)).toEqual({ inviteCode: 'invitation', nickname: '참여자' })
    expect(joined[1].headers.Authorization).toBe(`Bearer ${accountToken}`)
    expect(fetch.mock.calls.some(c => c[0] === '/api/groups/join' || c[0].endsWith('/memberships/claim'))).toBe(false)
  })
  it('계정 생성 후 닉네임 충돌 시 계정을 다시 만들지 않고 닉네임만 고쳐 재시도한다', async () => {
    const { fetch } = setup('/join/invitation', { joinConflictOnce: true })
    await fillInvitation()
    await userEvent.click(screen.getByRole('button', { name: '계정 만들고 파티 참여하기' }))
    await screen.findByText(/이미 사용 중인 닉네임/)
    expect(screen.getByLabelText(/내 닉네임/)).toHaveValue('참여자')
    expect(screen.queryByLabelText('비밀번호', { exact: true })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/내 닉네임/), '2')
    await userEvent.click(screen.getByRole('button', { name: '파티 참여하기' }))
    await screen.findByRole('heading', { name: '원래 파티' })
    expect(fetch.mock.calls.filter(c => c[0].includes('/auth/register'))).toHaveLength(1)
    expect(fetch.mock.calls.filter(c => c[0].endsWith('/account/groups/join'))).toHaveLength(2)
  })
  it('비회원 참여는 별도로 선택해야 하며 복구 불가 경고를 표시한다', async () => {
    setup('/join/invitation')
    expect(await screen.findByLabelText('로그인 ID')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '비회원으로 시작하기' }))
    expect(screen.queryByLabelText('로그인 ID')).not.toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('일회용 사용자')
    expect(screen.getByRole('note')).toHaveTextContent('다시 파티에 들어오지 못할 수')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들고 시작하기' }))
    expect(screen.getByLabelText('로그인 ID')).toBeInTheDocument()
  })
  it('기존 계정 로그인 링크는 초대 주소를 유지한다', async () => {
    const { router } = setup('/join/invitation', { resume: true })
    await userEvent.click(await screen.findByRole('link', { name: '계정에 연결한 기존 파티로 로그인' }))
    await userEvent.type(await screen.findByLabelText('로그인 ID'), 'raidmaster')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'safe-password-123')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('heading', { name: '원래 파티' })
    expect(router.state.location.pathname).toBe('/groups/1')
  })
  it('탭 인증이 없어도 HttpOnly 쿠키 갱신으로 계정을 복원한다', async () => {
    const { fetch } = setup('/account', { restore: true })
    await screen.findByRole('heading', { name: '내 계정과 파티' })
    expect(readAccount()?.user.userId).toBe(1)
    expect(localStorage.getItem(ACCOUNT_KEY)).toBeNull()
    expect(fetch.mock.calls.filter(c => c[0].endsWith('/auth/refresh'))).toHaveLength(1)
  })
  it('초대 링크에서 계정을 복원한 뒤 기존 멤버로 이동하며 새 가입을 하지 않는다', async () => {
    const { fetch, router } = setup('/join/known-code', { restore: true, resume: true })
    await screen.findByRole('heading', { name: '원래 파티' })
    expect(router.state.location.pathname).toBe('/groups/1')
    expect(readSessions()[0].accountUserId).toBe(1)
    expect(fetch.mock.calls.some(c => c[0].endsWith('/groups/join'))).toBe(false)
  })
  it('쿠키 갱신 서버 장애는 재시도를 안내한다', async () => {
    setup('/account', { restoreFailure: 503 })
    await screen.findByRole('alert')
    expect(screen.queryByRole('heading', { name: '계정 로그인이 필요해요' })).not.toBeInTheDocument()
  })
  it('비밀번호 확인·바이트 길이를 검증하고 잘못된 요청을 전송하지 않는다', async () => {
    const { fetch } = setup('/register')
    await userEvent.type(await screen.findByLabelText('로그인 ID'), 'raidmaster')
    await userEvent.type(screen.getByLabelText('비밀번호', { exact: true }), '가'.repeat(25))
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'different-password')
    await userEvent.click(screen.getByRole('button', { name: '계정 등록' }))
    expect(screen.getByRole('alert')).toHaveTextContent('72바이트')
    expect(fetch.mock.calls.some(c => c[0].includes('/auth/register'))).toBe(false)
  })
  it('등록 후 계정 정보만 보관하고 비회원 연결을 안내한다', async () => {
    writeSessions([guest]); const { fetch, router } = setup('/register', { groupsEmpty: true })
    await userEvent.type(await screen.findByLabelText('로그인 ID'), 'raidmaster')
    await userEvent.type(screen.getByLabelText('비밀번호', { exact: true }), 'safe-password-123')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'safe-password-123')
    await userEvent.click(screen.getByRole('button', { name: '계정 등록' }))
    await screen.findByRole('heading', { name: '내 계정과 파티' })
    expect(router.state.location.pathname).toBe('/account/groups')
    expect(screen.getByRole('button', { name: '계정에 연결하기' })).toBeInTheDocument()
    expect(readAccount()?.user.loginId).toBe('raidmaster')
    expect(localStorage.getItem(ACCOUNT_KEY)).toBeNull()
    expect(sessionStorage.getItem(ACCOUNT_KEY)).not.toContain('safe-password-123')
    const request = fetch.mock.calls.find(c => c[0].includes('/auth/register'))!
    expect(request[1].headers.Authorization).toBeUndefined()
  })
  it('로그인 성공 후 그룹 목록을 조회한다', async () => {
    setup('/login')
    await userEvent.type(await screen.findByLabelText('로그인 ID'), 'raidmaster')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'safe-password-123')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByText('원래 닉네임 · 파티장')
  })
  it('로그인 실패 시 계정을 저장하지 않고 아이디를 보존한다', async () => {
    setup('/login', { failLogin: true })
    await userEvent.type(await screen.findByLabelText('로그인 ID'), 'raidmaster')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'safe-password-123')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('아이디 또는 비밀번호를 확인')
    expect(readAccount()).toBeNull(); expect(await screen.findByLabelText('로그인 ID')).toHaveValue('raidmaster')
  })
})

describe('계정 그룹 복구와 안전한 토큰 전환', () => {
  it('새 브라우저처럼 멤버 토큰 없이 계정만 복원해 같은 멤버로 입장한다', async () => {
    seedAccount(); const { fetch } = setup('/account/groups')
    await userEvent.click(await screen.findByRole('button', { name: '파티 입장' }))
    await screen.findByRole('heading', { name: '원래 파티' })
    expect(readSessions()[0]).toMatchObject({ token: memberToken, accountUserId: 1, expiresAt: expiry })
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain(memberToken)
    expect(sessionStorage.getItem(ACCOUNT_MEMBERS_KEY)).toContain(memberToken)
    const entry = fetch.mock.calls.find(c => c[0].endsWith('/account/groups/1/session'))!
    expect(entry[1].headers.Authorization).toBe('Bearer ' + accountToken)
    const me = fetch.mock.calls.find(c => c[0].endsWith('/members/me'))!
    expect(me[1].headers.Authorization).toBe('Bearer ' + memberToken)
    expect(fetch.mock.calls.some(c => c[0].includes(accountToken) || c[0].includes(memberToken))).toBe(false)
  })
  it('확인 후 비회원 토큰을 연결하고 같은 그룹의 신규 토큰으로 교체한다', async () => {
    seedAccount(); writeSessions([guest]); const { fetch } = setup('/account', { groupsEmpty: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.click(await screen.findByRole('button', { name: '계정에 연결하기' }))
    await waitFor(() => expect(readSessions()[0].token).toBe(memberToken))
    expect(readSessions()).toHaveLength(1)
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain(guestToken)
    expect(JSON.parse(fetch.mock.calls.find(c => c[0].endsWith('/memberships/claim'))![1].body)).toEqual({ memberAccessToken: guestToken })
    expect(await screen.findByText('원래 닉네임 · 파티장')).toBeInTheDocument()
  })
  it('연결 실패 시 기존 비회원 참여 정보를 유지하고 재시도할 수 있다', async () => {
    seedAccount(); writeSessions([guest]); setup('/account', { failClaim: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.click(await screen.findByRole('button', { name: '계정에 연결하기' }))
    await screen.findByRole('alert')
    expect(readSessions()[0].token).toBe(guestToken)
    expect(screen.getByRole('button', { name: '계정에 연결하기' })).toBeEnabled()
  })
  it('계정 로그아웃은 서버를 호출하고 해당 계정 캐시·세션만 지운다', async () => {
    seedAccount(); writeSessions([{ ...guest, token: memberToken, accountUserId: 1 }, { ...guest, groupId: 2, name: '비회원 파티' }])
    const { fetch, client } = setup('/account')
    client.setQueryData(['group', 1, 'private-board'], { secret: 'previous account data' })
    await userEvent.click(await screen.findByRole('button', { name: '이 기기 로그아웃' }))
    await screen.findByRole('heading', { name: '로그인' })
    expect(fetch.mock.calls.some(c => c[0].endsWith('/auth/logout') && c[1].method === 'POST')).toBe(true)
    expect(readAccount()).toBeNull(); expect(readSessions().map(s => s.groupId)).toEqual([2])
    expect(client.getQueryData(['group', 1, 'private-board'])).toBeUndefined()
  })
  it('로그아웃 서버 오류 시 로그아웃 성공으로 처리하지 않는다', async () => {
    seedAccount(); setup('/account', { failLogout: true })
    await userEvent.click(await screen.findByRole('button', { name: '이 기기 로그아웃' }))
    await screen.findByRole('alert')
    expect(readAccount()).not.toBeNull()
  })
  it('계정 만료 시 계정 멤버 세션을 정리하고 비회원 정보는 보존한다', async () => {
    seedAccount(); writeSessions([{ ...guest, token: memberToken, accountUserId: 1 }, { ...guest, groupId: 2 }])
    setup('/account', { expireAccount: true })
    await screen.findByRole('heading', { name: '계정 로그인이 필요해요' })
    expect(readAccount()).toBeNull(); expect(readSessions().map(s => s.groupId)).toEqual([2])
  })
  it('그룹 세션 재발급 중 계정 만료도 안전하게 정리한다', async () => {
    seedAccount(); setup('/account', { failEntry: true })
    await userEvent.click(await screen.findByRole('button', { name: '파티 입장' }))
    await screen.findByRole('heading', { name: '계정 로그인이 필요해요' })
    expect(readSessions()).toEqual([])
  })
  it('이미 교체된 계정의 늦은 401은 현재 인증을 지우지 않는다', async () => {
    seedAccount(); setup('/account')
    await screen.findByRole('button', { name: '파티 입장' })
    await act(async () => { window.dispatchEvent(new CustomEvent(ACCOUNT_INVALID, { detail: { token: 'u_' + 'Z'.repeat(43) } })) })
    expect(readAccount()?.token).toBe(accountToken)
  })
  it('로그인 상태에서 새 파티 생성 시 공개 API 후 계정 연결까지 수행한다', async () => {
    seedAccount(); const { fetch } = setup('/groups/new')
    await waitFor(() => expect(fetch.mock.calls.some(c => c[0].endsWith('/account/me'))).toBe(true))
    await userEvent.type(screen.getByLabelText(/그룹 이름/), '새 파티')
    await userEvent.type(screen.getByLabelText(/내 닉네임/), '파티장')
    await userEvent.click(screen.getByRole('button', { name: '파티 만들기' }))
    await screen.findByRole('heading', { name: '원래 파티' })
    expect(readSessions()[0].accountUserId).toBe(1)
    expect(fetch.mock.calls.find(c => c[0].endsWith('/groups'))![1].headers.Authorization).toBeUndefined()
    expect(fetch.mock.calls.some(c => c[0].endsWith('/memberships/claim'))).toBe(true)
  })
  it('생성 후 자동 계정 연결이 실패해도 생성한 비회원 토큰은 남는다', async () => {
    seedAccount(); setup('/groups/new', { failClaim: true })
    await userEvent.type(screen.getByLabelText(/그룹 이름/), '새 파티'); await userEvent.type(screen.getByLabelText(/내 닉네임/), '파티장')
    await userEvent.click(screen.getByRole('button', { name: '파티 만들기' }))
    await screen.findByText(/파티는 생성·참여되었지만/)
    expect(readSessions()[0].token).toBe(guestToken)
  })
})
