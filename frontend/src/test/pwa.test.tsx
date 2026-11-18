import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import { InstallHint } from '../components/InstallHint'

it('Manifest과 PNG 아이콘 크기가 설치 요구사항과 일치한다', () => {
  const manifest = JSON.parse(readFileSync(resolve('public/manifest.webmanifest'), 'utf8'))
  expect(manifest).toMatchObject({ name: 'PartySync', short_name: 'PartySync', display: 'standalone', start_url: '/', scope: '/' })
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
