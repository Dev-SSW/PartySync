import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PartyNotifications } from '../features/pwa/PartyNotifications'
import { notificationChoiceKey } from '../features/pwa/notificationChoice'

const session = { groupId: 1, token: 'A'.repeat(43), revision: 'push-one', name: 'Party' }
vi.mock('../features/member/Auth', () => ({ useGroupSession: () => ({ session, key: ['group', 1, 'push-one'] }) }))
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

function setup({ granted = true, subscribed = false, configured = true, failSave = false, firstVisit = false, standalone = true, agent = 'Mozilla/5.0 Chrome/144.0.0.0', memberId = 10 } = {}) {
  if (!firstVisit) localStorage.setItem(notificationChoiceKey(memberId), 'later')
  let savingFails = failSave
  let current: ReturnType<typeof makeSubscription> | null = subscribed ? makeSubscription() : null
  let active = subscribed
  const subscribe = vi.fn().mockImplementation(async () => { current = makeSubscription(); return current })
  const registration = { active: {}, pushManager: { getSubscription: vi.fn(async () => current), subscribe } }
  const register = vi.fn(async () => registration)
  const nav = Object.create(navigator)
  Object.defineProperties(nav, { userAgent: { value: agent }, platform: { value: 'Linux' }, maxTouchPoints: { value: 0 } })
  Object.defineProperty(nav, 'serviceWorker', { value: { getRegistration: vi.fn(async () => registration), register, ready: Promise.resolve(registration) }, configurable: true })
  vi.stubGlobal('navigator', nav)
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('matchMedia', () => ({ matches: standalone }))
  vi.stubGlobal('PushManager', class {})
  const requestPermission = vi.fn(async () => granted ? 'granted' : 'denied')
  vi.stubGlobal('Notification', { permission: 'default', requestPermission })
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/configuration')) return json({ enabled: configured, publicKey: btoa(String.fromCharCode(4) + '\0'.repeat(64)).replace(/=/g, '') })
    if (url.endsWith('/status')) return json({ subscribed: active })
    if (options.method === 'PUT') { if (savingFails) return json({}, 503); active = true; return new Response(null, { status: 204 }) }
    if (options.method === 'DELETE') { active = false; return new Response(null, { status: 204 }) }
    throw new Error(`Unexpected ${url}`)
  })
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const rendered = render(<QueryClientProvider client={client}><PartyNotifications memberId={memberId} /></QueryClientProvider>)
  return { fetch, requestPermission, subscribe, register, subscription: current, rendered, recover: () => { savingFails = false } }
}
function makeSubscription() {
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/device', options: {}, unsubscribe: vi.fn(), toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/device', keys: { p256dh: 'public-key', auth: 'auth-key' } }) }
}

it('설정 화면을 보는 것만으로 알림 권한을 요청하지 않고 버튼을 누르면 구독한다', async () => {
  const { fetch, requestPermission, subscribe } = setup()
  const button = await screen.findByRole('button', { name: '이 파티 알림 켜기' })
  expect(requestPermission).not.toHaveBeenCalled()
  await userEvent.click(button)
  await screen.findByRole('button', { name: '이 파티 알림 끄기' })
  expect(requestPermission).toHaveBeenCalledOnce()
  expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) })
  expect(fetch.mock.calls.find(([, options]) => options.method === 'PUT')?.[1].headers).toMatchObject({ Authorization: `Bearer ${session.token}` })
})
it('권한 거절 시 구독하지 않고 설정에서 허용하도록 안내한다', async () => {
  const { fetch, subscribe } = setup({ granted: false })
  await userEvent.click(await screen.findByRole('button', { name: '이 파티 알림 켜기' }))
  expect(await screen.findByRole('status')).toHaveTextContent('알림 권한이 허용되지 않았어요')
  expect(subscribe).not.toHaveBeenCalled()
  expect(fetch.mock.calls.some(([, options]) => options.method === 'PUT')).toBe(false)
})
it('파티 알림을 꺼도 다른 파티에서 쓰는 브라우저 구독은 유지한다', async () => {
  const { subscription, fetch, requestPermission } = setup({ subscribed: true })
  await userEvent.click(await screen.findByRole('button', { name: '이 파티 알림 끄기' }))
  await screen.findByRole('button', { name: '이 파티 알림 켜기' })
  expect(subscription?.unsubscribe).not.toHaveBeenCalled()
  expect(requestPermission).not.toHaveBeenCalled()
  const request = fetch.mock.calls.find(([, options]) => options.method === 'DELETE')!
  expect(JSON.parse(request[1].body as string)).toEqual({ endpoint: subscription?.endpoint })
})
it('서버 저장 실패 시 켜짐으로 표시하지 않고 재시도할 수 있다', async () => {
  const { subscribe } = setup({ failSave: true })
  await userEvent.click(await screen.findByRole('button', { name: '이 파티 알림 켜기' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('알림을 설정하지 못했어요')
  expect(screen.queryByRole('button', { name: '이 파티 알림 끄기' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '이 파티 알림 켜기' }))
  await waitFor(() => expect(subscribe).toHaveBeenCalledOnce())
})
it('서버 키가 준비되지 않았으면 권한 요청 없이 준비 중 안내를 표시한다', async () => {
  const { requestPermission } = setup({ configured: false })
  await screen.findByText('아직 알림 서비스를 준비 중입니다.')
  expect(requestPermission).not.toHaveBeenCalled()
})
it('설치하지 않은 환경은 홈 화면 앱에서 알림을 켜도록 안내한다', () => {
  vi.stubGlobal('navigator', { serviceWorker: {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const client = new QueryClient()
  render(<QueryClientProvider client={client}><PartyNotifications memberId={10} /></QueryClientProvider>)
  expect(screen.getByText(/앱을 홈 화면에 설치한 뒤/)).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

it('처음 입장하면 수신 여부를 묻고 동의한 뒤에만 권한 요청과 구독을 수행한다', async () => {
  const { requestPermission, fetch } = setup({ firstVisit: true })
  expect(await screen.findByRole('dialog', { name: 'Party의 일정 알림을 받을까요?' })).toBeInTheDocument()
  expect(requestPermission).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '알림 받기' }))
  await screen.findByRole('button', { name: '이 파티 알림 끄기' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(requestPermission).toHaveBeenCalledOnce()
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'PUT')).toHaveLength(1)
  expect(localStorage.getItem(notificationChoiceKey(10))).toBe('enabled')
})
it('나중에를 고르면 권한을 요청하지 않고 재입장 시 다시 묻지 않으며 설정에서 켤 수 있다', async () => {
  const first = setup({ firstVisit: true })
  await userEvent.click(await screen.findByRole('button', { name: '나중에' }))
  expect(first.requestPermission).not.toHaveBeenCalled()
  expect(localStorage.getItem(notificationChoiceKey(10))).toBe('later')
  first.rendered.unmount()
  const second = setup({ firstVisit: true })
  await screen.findByRole('button', { name: '이 파티 알림 켜기' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '이 파티 알림 켜기' }))
  await screen.findByRole('button', { name: '이 파티 알림 끄기' })
  expect(second.requestPermission).toHaveBeenCalledOnce()
})
it('다른 멤버로 입장하면 별도로 묻고 이미 구독한 멤버에게는 묻지 않는다', async () => {
  localStorage.setItem(notificationChoiceKey(10), 'later')
  const first = setup({ firstVisit: true, memberId: 11 })
  await screen.findByRole('dialog')
  first.rendered.unmount()
  setup({ firstVisit: true, subscribed: true, memberId: 12 })
  await screen.findByRole('button', { name: '이 파티 알림 끄기' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('처음 동의했더라도 권한 거절이나 서버 실패 시 켜진 것으로 저장하지 않는다', async () => {
  const first = setup({ firstVisit: true, granted: false })
  await userEvent.click(await screen.findByRole('button', { name: '알림 받기' }))
  expect(await screen.findByRole('status')).toHaveTextContent('알림 권한이 허용되지 않았어요')
  expect(localStorage.getItem(notificationChoiceKey(10))).toBeNull()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  first.rendered.unmount()
  const second = setup({ firstVisit: true, failSave: true })
  await userEvent.click(await screen.findByRole('button', { name: '알림 받기' }))
  await screen.findByRole('alert')
  expect(localStorage.getItem(notificationChoiceKey(10))).toBeNull()
  second.recover()
  await userEvent.click(screen.getByRole('button', { name: '알림 받기' }))
  await screen.findByRole('button', { name: '이 파티 알림 끄기' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('카카오톡에서는 설치 안내를 보여주고 설치된 앱에서 다시 동의를 받는다', async () => {
  const first = setup({ firstVisit: true, standalone: false, agent: 'Android KAKAOTALK' })
  await userEvent.click(await screen.findByRole('button', { name: '설치하고 알림 받기' }))
  expect(screen.getByRole('dialog', { name: '앱 설치 후 알림을 켜 주세요' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '앱 설치하러 외부 브라우저 열기' })).toBeInTheDocument()
  expect(first.requestPermission).not.toHaveBeenCalled()
  expect(localStorage.getItem(notificationChoiceKey(10))).toBe('install')
  await userEvent.click(screen.getByRole('button', { name: '설치 후 설정할게요' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  first.rendered.unmount()
  setup({ firstVisit: true })
  await screen.findByRole('button', { name: '알림 받기' })
})
it('지원하는 일반 브라우저는 앱 설치 없이도 첫 입장에서 알림을 켤 수 있다', async () => {
  const { requestPermission } = setup({ firstVisit: true, standalone: false })
  await userEvent.click(await screen.findByRole('button', { name: '알림 받기' }))
  await screen.findByRole('button', { name: '이 파티 알림 끄기' })
  expect(requestPermission).toHaveBeenCalledOnce()
})
it('iPhone 브라우저에서는 직접 권한을 요청하지 않고 홈 화면 앱 설치를 안내한다', async () => {
  const { requestPermission } = setup({ firstVisit: true, standalone: false, agent: 'iPhone Safari' })
  await userEvent.click(await screen.findByRole('button', { name: '설치하고 알림 받기' }))
  expect(screen.getByText(/앱을 설치하고 같은 계정으로/)).toBeInTheDocument()
  expect(requestPermission).not.toHaveBeenCalled()
})
it('선택 저장이 차단되어도 나중에를 누르면 현재 화면에서 안내를 닫을 수 있다', async () => {
  setup({ firstVisit: true })
  await screen.findByRole('dialog')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked') })
  await userEvent.click(screen.getByRole('button', { name: '나중에' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

type WorkerEvent = { data?: { json: () => unknown }; notification?: { close: () => void; data: { url: string } }; waitUntil: (value: Promise<unknown>) => void }
function worker() {
  const listeners: Record<string, (event: WorkerEvent) => void> = {}
  const showNotification = vi.fn(async () => undefined)
  const openWindow = vi.fn(async () => undefined)
  const focus = vi.fn(async () => undefined)
  const self = { addEventListener: (name: string, listener: (event: WorkerEvent) => void) => { listeners[name] = listener }, registration: { showNotification }, location: { origin: 'https://party.example' }, clients: { matchAll: async () => [], openWindow }, skipWaiting: vi.fn() }
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL })
  return { listeners, showNotification, openWindow, focus }
}
it('서비스 워커가 닫힌 앱에서도 알림을 표시하고 외부 URL을 열지 않는다', async () => {
  const { listeners, showNotification, openWindow } = worker()
  let pending: Promise<unknown> = Promise.resolve()
  const waitUntil = (value: Promise<unknown>) => { pending = value }
  listeners.push({ data: { json: () => ({ title: 'Party', body: 'Member changed', url: 'https://evil.example/', tag: 'party' }) }, waitUntil })
  await pending
  expect(showNotification).toHaveBeenCalledWith('Party', expect.objectContaining({ body: 'Member changed', data: { url: '/account/groups' } }))
  listeners.notificationclick({ notification: { close: vi.fn(), data: { url: '//evil.example' } }, waitUntil })
  await pending
  expect(openWindow).toHaveBeenCalledWith('https://party.example/account/groups')
})
it('알림을 누르면 해당 파티를 열고 손상된 데이터도 기본 알림으로 표시한다', async () => {
  const { listeners, openWindow, showNotification } = worker()
  let pending: Promise<unknown> = Promise.resolve()
  const waitUntil = (value: Promise<unknown>) => { pending = value }
  listeners.notificationclick({ notification: { close: vi.fn(), data: { url: '/groups/42' } }, waitUntil })
  await pending
  expect(openWindow).toHaveBeenCalledWith('https://party.example/groups/42')
  listeners.push({ data: { json: () => { throw new Error('bad payload') } }, waitUntil })
  await pending
  expect(showNotification).toHaveBeenCalledWith('PartySync 일정 알림', expect.objectContaining({ body: '파티원의 일정이 변경되었어요.' }))
})
