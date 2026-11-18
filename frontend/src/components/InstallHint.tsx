import { useState, useSyncExternalStore } from 'react'
import { installPrompt } from '../features/pwa/installPrompt'

/** 지원 브라우저에 설치 안내를 남기고, 실제 설치는 브라우저 허용 시에만 제공한다. */
export function InstallHint() {
  const { prompt, installed } = useSyncExternalStore(installPrompt.subscribe, installPrompt.getSnapshot)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  if (installed || window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone) return null
  if (window.isSecureContext === false) return null
  const ua = navigator.userAgent
  if (/KAKAOTALK/i.test(ua)) return <p className="muted small-text">홈 화면에 설치하려면 카카오톡 메뉴에서 외부 브라우저로 열어 주세요. 브라우저마다 로그인·참여 정보가 다를 수 있어요.</p>
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const safari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
  const chromium = !ios && /Chrome|Chromium|Edg\//.test(ua) && !/; wv\)|FBAN|FBAV|Instagram|NAVER|SamsungBrowser|OPR\//.test(ua)
  async function install() {
    if (!prompt || pending) return
    setPending(true); setFailed(false)
    try { await prompt.prompt(); await prompt.userChoice }
    catch { setFailed(true) }
    finally { installPrompt.consume(prompt); setPending(false) }
  }
  if (prompt || safari || chromium) return <div className="install-hint">
    {prompt && <button type="button" className="button small" disabled={pending} onClick={() => void install()}>{pending ? '설치 창 여는 중…' : 'PartySync 설치'}</button>}
    {!prompt && <details className="install-guide">
      <summary className="button small">앱 설치 안내</summary>
      <p className="muted small-text">{safari
        ? 'Safari 공유 메뉴 → 홈 화면에 추가로 PartySync를 설치할 수 있어요.'
        : '브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 확인해 주세요. 이미 설치했다면 홈 화면의 PartySync 아이콘으로 실행하세요.'}</p>
    </details>}
    {failed && !prompt && <p className="muted small-text" role="status">설치 창을 열지 못했습니다. 브라우저 메뉴의 설치 기능을 이용해 주세요.</p>}
  </div>
  return null
}
