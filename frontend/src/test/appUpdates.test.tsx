import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppUpdateMonitor, appUpdates } from '../features/pwa/appUpdates'
import { updateSafety, useUpdateSafety } from '../features/pwa/updateSafety'
import { AppUpdateNotice } from '../features/pwa/AppUpdateNotice'

const monitors: AppUpdateMonitor[] = []
const guards: symbol[] = []
const originalUrl = window.location.href
afterEach(() => {
  monitors.forEach(monitor => monitor.dispose()); monitors.length = 0
  guards.forEach(guard => updateSafety.set(guard, false)); guards.length = 0
  window.history.replaceState(null, '', originalUrl)
  vi.useRealTimers()
})
const json = (version: unknown) => new Response(JSON.stringify({ version }), { headers: { 'Content-Type': 'application/json' } })
function monitor(version = 'old') {
  const navigate = vi.fn()
  const value = new AppUpdateMonitor(version, navigate)
  monitors.push(value)
  return { value, navigate }
}
async function finish() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

it('웹·설치 앱 모두 시작 시 새 버전이 있으면 현재 경로를 유지해 자동 적용한다', async () => {
  window.history.replaceState(null, '', '/join/secret-code?returnTo=party#section')
  const fetch = vi.fn(async () => json('new-build')); vi.stubGlobal('fetch', fetch)
  const { value, navigate } = monitor()
  value.start(); await finish()
  expect(navigate).toHaveBeenCalledOnce()
  const target = new URL(navigate.mock.calls[0][0])
  expect(target.pathname).toBe('/join/secret-code')
  expect(target.searchParams.get('returnTo')).toBe('party')
  expect(target.hash).toBe('#section')
  expect(target.searchParams.get('__ps_update')).toBe('new-build')
  expect(fetch).toHaveBeenCalledWith('/version.json', expect.objectContaining({ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }))
})
it('이미 최신 버전이면 다시 불러오지 않고 임시 업데이트 표식을 정리한다', async () => {
  window.history.replaceState({ saved: true }, '', '/groups/1?__ps_update=current&keep=1')
  vi.stubGlobal('fetch', vi.fn(async () => json('current')))
  const { value, navigate } = monitor('current')
  value.start(); await finish()
  expect(navigate).not.toHaveBeenCalled()
  expect(window.location.search).toBe('?keep=1')
  expect(window.history.state).toEqual({ saved: true })
})
it('중간 캐시나 배포 지연으로 이전 코드가 돌아와도 자동 새로고침을 반복하지 않는다', async () => {
  window.history.replaceState(null, '', '/groups/1?__ps_update=new-build')
  vi.stubGlobal('fetch', vi.fn(async () => json('new-build')))
  const { value, navigate } = monitor()
  value.start(); await finish()
  expect(navigate).not.toHaveBeenCalled()
  expect(value.getSnapshot().version).toBe('new-build')
})
it('최초 확인이 늦어 사용자가 입력을 시작했다면 자동 적용하지 않는다', async () => {
  let release!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve })))
  const { value, navigate } = monitor()
  value.start()
  window.dispatchEvent(new Event('input', { bubbles: true }))
  release(json('new-build')); await finish()
  expect(navigate).not.toHaveBeenCalled()
  expect(value.getSnapshot().version).toBe('new-build')
})
it('사용 중 앱 복귀·네트워크 복구·주기 확인은 업데이트 안내만 제공한다', async () => {
  vi.useFakeTimers()
  let version = 'old'
  const fetch = vi.fn(async () => json(version)); vi.stubGlobal('fetch', fetch)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const { value, navigate } = monitor()
  value.start(); await finish()
  version = 'new-build'
  window.dispatchEvent(new Event('focus')); await finish()
  expect(value.getSnapshot().version).toBe('new-build')
  expect(navigate).not.toHaveBeenCalled()
  document.dispatchEvent(new Event('visibilitychange')); await finish()
  window.dispatchEvent(new Event('online')); await finish()
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(5)
  value.dispose()
  const calls = fetch.mock.calls.length
  window.dispatchEvent(new Event('focus')); await finish()
  expect(fetch).toHaveBeenCalledTimes(calls)
})
it('저장하지 않은 내용은 자동 적용과 업데이트 버튼 동작을 모두 차단한다', async () => {
  const guard = Symbol(); guards.push(guard); updateSafety.set(guard, true)
  vi.stubGlobal('fetch', vi.fn(async () => json('new-build')))
  const { value, navigate } = monitor()
  value.start(); await finish(); value.apply()
  expect(navigate).not.toHaveBeenCalled()
  updateSafety.set(guard, false); value.apply()
  expect(navigate).toHaveBeenCalledOnce()
})
it('오프라인·오류 응답·옛 서버의 HTML·잘못된 버전은 앱 실행을 막지 않는다', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Offline'))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response('<html>old app</html>'))
    .mockResolvedValueOnce(json('https://evil.example/'))
  vi.stubGlobal('fetch', fetch)
  const { value, navigate } = monitor()
  for (let i = 0; i < 4; i++) await value.check(true)
  expect(navigate).not.toHaveBeenCalled()
  expect(value.getSnapshot().version).toBeNull()
})
it('사용자 설정과 저장 토큰을 삭제하지 않고 새 버전을 적용한다', async () => {
  localStorage.setItem('party', 'keep'); sessionStorage.setItem('token', 'keep')
  vi.stubGlobal('fetch', vi.fn(async () => json('new-build')))
  const { value } = monitor()
  await value.check(); value.apply()
  expect(localStorage.getItem('party')).toBe('keep')
  expect(sessionStorage.getItem('token')).toBe('keep')
})
it('업데이트 화면은 미저장 내용이 있을 때 버튼을 잠그고 저장 후 적용한다', async () => {
  const snapshot = { version: 'new-build', applying: false }
  vi.spyOn(appUpdates, 'getSnapshot').mockReturnValue(snapshot)
  const apply = vi.spyOn(appUpdates, 'apply').mockImplementation(() => undefined)
  function Form({ dirty }: { dirty: boolean }) { useUpdateSafety(dirty); return null }
  const client = new QueryClient()
  const view = (dirty: boolean) => <QueryClientProvider client={client}><Form dirty={dirty} /><AppUpdateNotice /></QueryClientProvider>
  const result = render(view(true))
  expect(screen.getByRole('button', { name: '업데이트하기' })).toBeDisabled()
  expect(screen.getByText('변경 내용을 저장한 뒤 업데이트할 수 있어요.')).toBeInTheDocument()
  result.rerender(view(false))
  await userEvent.click(screen.getByRole('button', { name: '업데이트하기' }))
  expect(apply).toHaveBeenCalledOnce()
})
