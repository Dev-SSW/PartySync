import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InstallHint } from '../components/InstallHint'
import { installPrompt, type InstallEvent } from '../features/pwa/installPrompt'

beforeEach(() => {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallEvent
  fireEvent(window, event)
  installPrompt.consume(event)
})
const chrome = () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/144.0.0.0 Mobile Safari/537.36')
  vi.stubGlobal('isSecureContext', true)
}
const available = (prompt = vi.fn().mockResolvedValue(undefined)) => {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallEvent
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }) })
  fireEvent(window, event)
  return event
}

it('Manifest과 PNG 아이콘 크기가 설치 요구사항과 일치한다', () => {
  const manifest = JSON.parse(readFileSync(resolve('public/manifest.webmanifest'), 'utf8'))
  expect(manifest).toMatchObject({ id: '/', name: 'PartySync', short_name: 'PartySync', display: 'standalone', start_url: '/launch', scope: '/' })
  for (const icon of manifest.icons) {
    const png = readFileSync(resolve(`public${icon.src}`))
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes)
  }
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true)
})
it('설치 가능 이벤트가 있을 때만 설치 버튼을 표시한다', () => {
  render(<InstallHint />)
  expect(screen.queryByRole('button', { name: 'PartySync 설치' })).not.toBeInTheDocument()
  const event = new Event('beforeinstallprompt', { cancelable: true })
  Object.assign(event, { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) })
  fireEvent(window, event)
  expect(screen.getByRole('button', { name: 'PartySync 설치' })).toBeInTheDocument()
  expect(event.defaultPrevented).toBe(true)
})
it('Chrome에서 설치 이벤트가 없어도 설치 안내 진입점을 유지한다', async () => {
  chrome()
  render(<InstallHint />)
  expect(screen.queryByRole('button', { name: 'PartySync 설치' })).not.toBeInTheDocument()
  const guide = screen.getByText('앱 설치 안내')
  expect(guide.closest('details')).not.toHaveAttribute('open')
  await userEvent.click(guide)
  expect(guide.closest('details')).toHaveAttribute('open')
  expect(screen.getByText(/브라우저 메뉴에서 앱 설치/)).toBeVisible()
})
it('화면이 표시되기 전에 도착한 설치 이벤트도 재사용한다', () => {
  available()
  render(<InstallHint />)
  expect(screen.getByRole('button', { name: 'PartySync 설치' })).toBeInTheDocument()
})
it('설치를 취소해도 안내는 남고 같은 이벤트로 설치 창을 반복 호출하지 않는다', async () => {
  chrome()
  const event = available()
  render(<InstallHint />)
  await userEvent.click(screen.getByRole('button', { name: 'PartySync 설치' }))
  await screen.findByText('앱 설치 안내')
  expect(event.prompt).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: 'PartySync 설치' })).not.toBeInTheDocument()
})
it('설치 창 호출 오류는 안내로 처리한다', async () => {
  chrome()
  available(vi.fn().mockRejectedValue(new Error('Unavailable')))
  render(<InstallHint />)
  await userEvent.click(screen.getByRole('button', { name: 'PartySync 설치' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('설치 창을 열지 못했습니다'))
  expect(screen.getByText('앱 설치 안내')).toBeInTheDocument()
})
it('iPhone Safari는 설치 버튼 대신 공유 메뉴 안내를 제공한다', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')
  render(<InstallHint />)
  await userEvent.click(screen.getByText('앱 설치 안내'))
  expect(screen.getByText(/Safari 공유 메뉴/)).toBeVisible()
})
it('카카오톡에서는 파티 참여 후 계정 목록으로 외부 브라우저를 열고 설치를 안내한다', () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) Chrome/144.0 Mobile Safari/537.36 KAKAOTALK')
  render(<InstallHint path="/groups/123" />)
  expect(screen.getByText(/카카오톡 메뉴에서 외부 브라우저/)).toBeInTheDocument()
  expect(screen.queryByText('앱 설치 안내')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '앱 설치하러 외부 브라우저 열기' })).toHaveAttribute('href', `kakaotalk://web/openExternal?url=${encodeURIComponent(`${window.location.origin}/account/groups`)}`)
  expect(screen.getByText(/같은 아이디로 로그인/)).toBeInTheDocument()
})
it('카카오톡 초대 화면에서는 초대 코드만 유지하고 인증 정보나 쿼리는 전달하지 않는다', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone KAKAOTALK')
  render(<InstallHint path="/join/invitation" />)
  expect(screen.getByRole('link', { name: '앱 설치하러 외부 브라우저 열기' })).toHaveAttribute('href', `kakaotalk://web/openExternal?url=${encodeURIComponent(`${window.location.origin}/join/invitation`)}`)
  await userEvent.click(screen.getByText('열리지 않을 때'))
  expect(screen.getByLabelText('외부 브라우저에서 열 주소')).toHaveValue(`${window.location.origin}/join/invitation`)
})
it('카카오톡에서 링크 복사가 차단되어도 주소를 직접 복사할 수 있다', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('KAKAOTALK')
  const user = userEvent.setup()
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'))
  render(<InstallHint path="/groups/1" />)
  await user.click(screen.getByRole('button', { name: '설치 링크 복사' }))
  expect(await screen.findByRole('status')).toHaveTextContent('직접 복사')
  await user.click(screen.getByText('열리지 않을 때'))
  expect(screen.getByLabelText('외부 브라우저에서 열 주소')).toBeVisible()
})
it('설치된 앱 또는 설치 완료 후에는 설치 안내를 숨긴다', () => {
  chrome()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const { rerender } = render(<InstallHint />)
  expect(screen.queryByText('앱 설치 안내')).not.toBeInTheDocument()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  available()
  rerender(<InstallHint />)
  expect(screen.getByRole('button', { name: 'PartySync 설치' })).toBeInTheDocument()
  fireEvent(window, new Event('appinstalled'))
  expect(screen.queryByRole('button', { name: 'PartySync 설치' })).not.toBeInTheDocument()
  expect(screen.queryByText('앱 설치 안내')).not.toBeInTheDocument()
})
it('비보안 환경과 지원하지 않는 브라우저에는 설치를 권하지 않는다', () => {
  chrome()
  vi.stubGlobal('isSecureContext', false)
  const { rerender } = render(<InstallHint />)
  expect(screen.queryByText('앱 설치 안내')).not.toBeInTheDocument()
  vi.stubGlobal('isSecureContext', true)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Firefox/144.0')
  rerender(<InstallHint />)
  expect(screen.queryByText('앱 설치 안내')).not.toBeInTheDocument()
})
