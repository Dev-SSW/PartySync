import { StrictMode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../App'
import { AuthProvider } from '../features/member/Auth'
import { readSessions, writeSessions } from '../features/member/storage'
import { storeAccount } from '../features/account/accountStorage'
import { defaultPartyKey, readDefaultParty, writeDefaultParty } from '../features/party/defaultPartyStorage'

const accountToken = 'u_' + 'A'.repeat(43), linkedToken = 'm_' + 'C'.repeat(43)
const guestToken = 'G'.repeat(43), guestTwoToken = 'H'.repeat(43)
const expiry = '2030-01-01T00:00:00Z'
const accountUser = (userId = 1) => ({ userId, loginId: `user_${userId}`, createdAt: '' })
const linked = { groupId: 1, groupName: '계정 파티', memberId: 10, nickname: '계정 닉네임', role: 'OWNER', joinedAt: '' }
const guest = (groupId = 2) => ({ groupId, name: groupId === 1 ? '예전 파티 이름' : '비회원 파티', token: groupId === 1 ? guestToken : guestTwoToken, revision: `guest-${groupId}` })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
function setup(path: string, options: { account?: boolean; userId?: number; restore?: boolean; refresh?: Promise<Response>; refreshStatus?: number;
  groupsStatus?: number; guestDenied?: boolean; enterStatus?: number; expired?: boolean; strict?: boolean } = {}) {
  const userId = options.userId || 1
  if (options.account) storeAccount({ user: accountUser(userId), token: accountToken, expiresAt: expiry, revision: `account-${userId}` })
  let groupsStatus = options.groupsStatus || 200, enterStatus = options.enterStatus || 200
  let guestDenied = !!options.guestDenied, signedOut = false
  const fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    const path = new URL(url, 'https://test.invalid').pathname
    if (path === '/api/auth/refresh') return options.refresh || (options.restore
      ? json({ user: accountUser(userId), accountAccessToken: accountToken, expiresAt: expiry }) : json({}, options.refreshStatus || 401))
    if (path === '/api/account/me') return options.expired || signedOut ? json({}, 401) : json(accountUser(userId))
    if (path === '/api/account/groups') return groupsStatus === 200 ? json([linked]) : json({}, groupsStatus)
    if (path === '/api/auth/logout') { signedOut = true; return new Response(null, { status: 204 }) }
    if (path === '/api/account/invite/session') return json(membership)
    if (path === '/api/account/groups/1/session') return enterStatus === 200 ? json(membership) : json({}, enterStatus)
    if (path === '/api/members/me') {
      const token = (init.headers as Record<string, string>).Authorization?.slice(7)
      if (token === linkedToken) return json({ memberId: 10, groupId: 1, nickname: linked.nickname, role: linked.role })
      return guestDenied ? json({}, 401) : json({ memberId: token === guestToken ? 11 : 20, groupId: token === guestToken ? 1 : 2, nickname: '비회원 닉네임', role: 'MEMBER' })
    }
    if (path.endsWith('/members')) return json([{ memberId: 10, nickname: linked.nickname, role: 'OWNER', joinedAt: '' }])
    if (path.endsWith('/posts')) return json({ content: [], page: 0, size: 5, totalElements: 0, totalPages: 0, hasNext: false })
    if (path.includes('availability')) return json({ groupId: 1, days: [] })
    return json({ groupId: path.includes('/2') ? 2 : 1, name: '파티 일정표', description: '', memberCount: 1, createdAt: '' })
  })
  const membership = { group: { groupId: 1, name: '파티 일정표', description: '', memberCount: 1, createdAt: '' },
    member: { memberId: 10, nickname: linked.nickname, role: linked.role, joinedAt: '' }, memberAccessToken: linkedToken, expiresAt: expiry }
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const app = <QueryClientProvider client={client}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider>
  render(options.strict ? <StrictMode>{app}</StrictMode> : app)
  return { fetch, router, client, recover: () => { groupsStatus = 200; enterStatus = 200 }, denyGuests: () => { guestDenied = true } }
}
const partyArea = () => screen.getByRole('region', { name: '내 파티' })

describe('홈의 계정·비회원 파티 조회', () => {
  it('로그인 복원 중인 홈은 빈 목록 안내를 표시하지 않는다', async () => {
    let release!: (value: Response) => void
    const refresh = new Promise<Response>(resolve => { release = resolve })
    const { fetch, router } = setup('/', { refresh })
    await waitFor(() => expect(fetch.mock.calls.some(call => call[0].endsWith('/auth/refresh'))).toBe(true))
    expect(screen.queryByText(/아직 참여한 파티가 없습니다/)).not.toBeInTheDocument()
    expect(within(partyArea()).getByRole('status')).toBeInTheDocument()
    await act(async () => { release(json({ user: accountUser(), accountAccessToken: accountToken, expiresAt: expiry })) })
    await screen.findByRole('article', { name: '계정 파티' })
    expect(router.state.location.pathname).toBe('/')
  })
  it('그룹 세션 없이 계정 파티 이름·닉네임·역할을 표시하고 입장 시 기존 멤버 세션을 복원한다', async () => {
    const { fetch, router } = setup('/', { account: true })
    const party = await screen.findByRole('article', { name: '계정 파티' })
    expect(party).toHaveTextContent('계정 닉네임 · 파티장 · 계정 연결')
    expect(readSessions()).toHaveLength(0)
    await userEvent.click(within(party).getByRole('button', { name: '파티 입장' }))
    await screen.findByRole('heading', { name: '파티 일정표' })
    expect(router.state.location.pathname).toBe('/groups/1')
    expect(readSessions()[0]).toMatchObject({ groupId: 1, accountUserId: 1, token: linkedToken })
    expect(fetch.mock.calls.filter(call => call[0].endsWith('/account/groups/1/session'))).toHaveLength(1)
    expect(fetch.mock.calls.some(call => call[0].endsWith('/groups/join'))).toBe(false)
  })
  it('비회원 파티는 서버로 검증하여 표시하고 입장한다', async () => {
    writeSessions([guest()])
    const { router } = setup('/')
    const party = await screen.findByRole('article', { name: '비회원 파티' })
    expect(party).toHaveTextContent('비회원 닉네임 · 파티원 · 비회원')
    await userEvent.click(within(party).getByRole('button', { name: '파티 입장' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/2'))
  })
  it('동일 그룹은 계정 멤버를 우선하고 다른 비회원 파티는 보존한다', async () => {
    writeSessions([guest(1), guest(2)])
    const { fetch } = setup('/', { account: true })
    await screen.findByRole('article', { name: '계정 파티' })
    await screen.findByRole('article', { name: '비회원 파티' })
    expect(within(partyArea()).getAllByRole('article')).toHaveLength(2)
    expect(screen.queryByText('예전 파티 이름')).not.toBeInTheDocument()
    expect(fetch.mock.calls.some(call => call[1].headers.Authorization === `Bearer ${guestToken}`)).toBe(false)
  })
  it('계정 목록 장애는 로컬 계정 세션을 목록으로 대신하지 않고 재시도한다', async () => {
    writeSessions([{ ...guest(1), token: linkedToken, accountUserId: 1 }])
    const { recover } = setup('/', { account: true, groupsStatus: 503 })
    await screen.findByRole('alert')
    expect(screen.queryByRole('article', { name: '계정 파티' })).not.toBeInTheDocument()
    recover()
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await screen.findByRole('article', { name: '계정 파티' })
  })
  it('강퇴·만료된 비회원 파티는 정상 목록으로 표시하지 않는다', async () => {
    writeSessions([guest()])
    setup('/', { guestDenied: true })
    await screen.findByText(/아직 참여한 파티가 없습니다/)
    expect(within(partyArea()).queryByRole('article')).not.toBeInTheDocument()
  })
  it('기본 파티를 지정·변경·해제하고 그룹 ID만 영속 저장한다', async () => {
    writeSessions([guest()])
    setup('/', { account: true })
    const account = await screen.findByRole('article', { name: '계정 파티' })
    const other = await screen.findByRole('article', { name: '비회원 파티' })
    await userEvent.click(within(account).getByRole('button', { name: '기본 파티로 설정' }))
    expect(localStorage.getItem(defaultPartyKey(1))).toBe('1')
    expect(within(account).getByText('기본 파티')).toBeInTheDocument()
    await userEvent.click(within(other).getByRole('button', { name: '기본 파티로 설정' }))
    expect(readDefaultParty(1)).toBe(2)
    expect(within(account).queryByText('기본 파티')).not.toBeInTheDocument()
    await userEvent.click(within(other).getByRole('button', { name: '기본 파티 해제' }))
    expect(readDefaultParty(1)).toBeNull()
  })
  it('일반 홈과 로고 이동에는 기본 파티 자동 실행을 적용하지 않는다', async () => {
    writeDefaultParty(1, 1)
    const { fetch, router } = setup('/', { account: true })
    await screen.findByRole('article', { name: '계정 파티' })
    await userEvent.click(screen.getByRole('link', { name: 'PartySync' }))
    expect(router.state.location.pathname).toBe('/')
    expect(fetch.mock.calls.some(call => call[0].endsWith('/account/groups/1/session'))).toBe(false)
  })
})

describe('PWA 기본 파티 실행', () => {
  it('유효한 계정 그룹 세션은 실제 권한만 확인하고 중복 발급하지 않는다', async () => {
    writeDefaultParty(1, 1)
    writeSessions([{ groupId: 1, name: '계정 파티', token: linkedToken, accountUserId: 1, expiresAt: expiry, revision: 'linked' }])
    const { fetch, router } = setup('/launch', { account: true })
    await screen.findByRole('heading', { name: '파티 일정표' })
    expect(router.state.location.pathname).toBe('/groups/1')
    expect(fetch.mock.calls.some(call => call[0].endsWith('/account/groups/1/session'))).toBe(false)
    expect(fetch.mock.calls.some(call => call[0].endsWith('/members/me'))).toBe(true)
  })
  it('만료된 그룹 세션은 계정의 기존 멤버로 재발급한다', async () => {
    writeDefaultParty(1, 1)
    writeSessions([{ groupId: 1, name: '계정 파티', token: linkedToken, accountUserId: 1, expiresAt: '2000-01-01T00:00:00Z', revision: 'expired' }])
    const { fetch } = setup('/launch', { account: true })
    await screen.findByRole('heading', { name: '파티 일정표' })
    expect(fetch.mock.calls.filter(call => call[0].endsWith('/account/groups/1/session'))).toHaveLength(1)
    expect(readSessions()[0].expiresAt).toBe(expiry)
  })
  it('로그인 복원 중에는 빈 파티로 판단하지 않고 복원 후 기존 멤버로 입장한다', async () => {
    let release!: (value: Response) => void
    const refresh = new Promise<Response>(resolve => { release = resolve })
    writeDefaultParty(1, 1)
    const { fetch, router } = setup('/launch', { refresh, strict: true })
    await waitFor(() => expect(fetch.mock.calls.some(call => call[0].endsWith('/auth/refresh'))).toBe(true))
    expect(router.state.location.pathname).toBe('/launch')
    expect(screen.queryByText(/아직 참여한 파티가 없습니다/)).not.toBeInTheDocument()
    await act(async () => { release(json({ user: accountUser(), accountAccessToken: accountToken, expiresAt: expiry })) })
    await screen.findByRole('heading', { name: '파티 일정표' })
    expect(router.state.location.pathname).toBe('/groups/1')
    expect(fetch.mock.calls.filter(call => call[0].endsWith('/account/groups/1/session'))).toHaveLength(1)
  })
  it('비회원 기본 파티는 보유한 토큰을 검증한 뒤 실행한다', async () => {
    writeSessions([guest()]); writeDefaultParty(2)
    const { fetch, router } = setup('/launch')
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/2'))
    expect(fetch.mock.calls.some(call => call[0].includes('/account/groups/2/session'))).toBe(false)
  })
  it('기본 파티가 없으면 홈으로 이동한다', async () => {
    const { router } = setup('/launch')
    await screen.findByRole('heading', { name: '내 파티' })
    expect(router.state.location.pathname).toBe('/')
  })
  it('강퇴된 비회원 기본 파티도 실행하지 않고 설정을 해제한다', async () => {
    writeSessions([guest()]); writeDefaultParty(2)
    const { router } = setup('/launch', { guestDenied: true })
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(readDefaultParty()).toBeNull()
    expect(within(partyArea()).queryByRole('article', { name: '비회원 파티' })).not.toBeInTheDocument()
  })
  it('다른 계정의 기본 설정은 실행하지 않는다', async () => {
    writeDefaultParty(1, 1)
    const { fetch, router } = setup('/launch', { account: true, userId: 2 })
    await screen.findByRole('article', { name: '계정 파티' })
    expect(router.state.location.pathname).toBe('/')
    expect(readDefaultParty(1)).toBe(1)
    expect(fetch.mock.calls.some(call => call[0].endsWith('/account/groups/1/session'))).toBe(false)
  })
  it('로그아웃 후에는 이전 계정의 기본 파티로 입장하지 않는다', async () => {
    writeDefaultParty(1, 1)
    const { router } = setup('/account', { account: true })
    await userEvent.click(await screen.findByRole('button', { name: '이 기기 로그아웃' }))
    await screen.findByLabelText('로그인 ID')
    await act(async () => { await router.navigate('/launch') })
    await screen.findByRole('heading', { name: '내 파티' })
    expect(router.state.location.pathname).toBe('/')
  })
  it('강퇴되어 서버 목록에 없는 파티는 기본 설정을 해제하고 홈으로 이동한다', async () => {
    writeDefaultParty(9, 1)
    const { fetch, router } = setup('/launch', { account: true })
    await screen.findByRole('article', { name: '계정 파티' })
    expect(router.state.location.pathname).toBe('/')
    expect(readDefaultParty(1)).toBeNull()
    expect(fetch.mock.calls.some(call => call[0].includes('/account/groups/9/session'))).toBe(false)
  })
  it('목록 조회 후 강퇴된 경우에도 세션 재발급을 거절하고 기본 설정을 해제한다', async () => {
    writeDefaultParty(1, 1)
    const { router } = setup('/launch', { account: true, enterStatus: 403 })
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(readDefaultParty(1)).toBeNull()
  })
  it('세션 발급 장애는 설정을 보존하고 재시도하면 입장한다', async () => {
    writeDefaultParty(1, 1)
    const { router, recover } = setup('/launch', { account: true, enterStatus: 503 })
    await screen.findByRole('alert')
    expect(router.state.location.pathname).toBe('/launch')
    expect(readDefaultParty(1)).toBe(1)
    recover()
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await screen.findByRole('heading', { name: '파티 일정표' })
    expect(router.state.location.pathname).toBe('/groups/1')
  })
  it('인증 복원 장애는 설정을 삭제하거나 홈으로 넘기지 않는다', async () => {
    writeDefaultParty(1, 1)
    const { router } = setup('/launch', { refreshStatus: 503 })
    await screen.findByRole('alert')
    expect(router.state.location.pathname).toBe('/launch')
    expect(readDefaultParty(1)).toBe(1)
  })
  it('만료된 인증으로 다른 계정의 기본 설정을 실행하지 않는다', async () => {
    writeDefaultParty(1, 1)
    const { router } = setup('/launch', { account: true, expired: true })
    await screen.findByRole('heading', { name: '내 파티' })
    expect(router.state.location.pathname).toBe('/')
  })
  it('기본 파티가 있어도 초대받은 계정 파티를 우선한다', async () => {
    writeDefaultParty(9, 1)
    const { router } = setup('/join/valid-code', { account: true })
    await screen.findByRole('heading', { name: '파티 일정표' })
    expect(router.state.location.pathname).toBe('/groups/1')
    expect(readDefaultParty(1)).toBe(9)
  })
})
