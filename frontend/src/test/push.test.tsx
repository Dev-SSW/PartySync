import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PartyNotifications } from '../features/pwa/PartyNotifications'

const session = { groupId: 1, token: 'A'.repeat(43), revision: 'push-one', name: 'Party' }
vi.mock('../features/member/Auth', () => ({ useGroupSession: () => ({ session, key: ['group', 1, 'push-one'] }) }))
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

function setup({ granted = true, subscribed = false, configured = true, failSave = false } = {}) {
  let current: ReturnType<typeof makeSubscription> | null = subscribed ? makeSubscription() : null
  let active = subscribed
  const subscribe = vi.fn().mockImplementation(async () => { current = makeSubscription(); return current })
  const registration = { active: {}, pushManager: { getSubscription: vi.fn(async () => current), subscribe } }
  const register = vi.fn(async () => registration)
  const nav = Object.create(navigator)
  Object.defineProperty(nav, 'serviceWorker', { value: { getRegistration: vi.fn(async () => registration), register, ready: Promise.resolve(registration) }, configurable: true })
  vi.stubGlobal('navigator', nav)
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.stubGlobal('PushManager', class {})
  const requestPermission = vi.fn(async () => granted ? 'granted' : 'denied')
  vi.stubGlobal('Notification', { permission: 'default', requestPermission })
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/configuration')) return json({ enabled: configured, publicKey: btoa(String.fromCharCode(4) + '\0'.repeat(64)).replace(/=/g, '') })
    if (url.endsWith('/status')) return json({ subscribed: active })
    if (options.method === 'PUT') { if (failSave) return json({}, 503); active = true; return new Response(null, { status: 204 }) }
    if (options.method === 'DELETE') { active = false; return new Response(null, { status: 204 }) }
    throw new Error(`Unexpected ${url}`)
  })
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><PartyNotifications /></QueryClientProvider>)
  return { fetch, requestPermission, subscribe, register, subscription: current }
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
  render(<QueryClientProvider client={client}><PartyNotifications /></QueryClientProvider>)
  expect(screen.getByText(/앱을 홈 화면에 설치한 뒤/)).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
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
