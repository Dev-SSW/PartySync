import { useState, useSyncExternalStore } from 'react'
import { installPrompt } from '../features/pwa/installPrompt'

/** 지원 브라우저에 설치 안내를 남기고, 실제 설치는 브라우저 허용 시에만 제공한다. */
export function InstallHint({ path = window.location.pathname }: { path?: string }) {
  const { prompt, installed } = useSyncExternalStore(installPrompt.subscribe, installPrompt.getSnapshot)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  if (installed || window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone) return null
  if (window.isSecureContext === false) return null
  const ua = navigator.userAgent
  if (/KAKAOTALK/i.test(ua)) {
    // 브라우저 간 인증 정보를 URL로 전달하지 않는다. 참여 후에는 계정으로 복원한다.
    const target = new URL(path.startsWith('/join/') ? path : '/account/groups', window.location.origin).href
    async function copy() {
      try { await navigator.clipboard.writeText(target); setCopied(true); setCopyFailed(false) }
      catch { setCopyFailed(true) }
    }
    return <aside className="card install-hint" aria-label="카카오톡 앱 설치 안내">
      <div><strong>PartySync를 앱으로 설치하세요</strong>
        <p className="muted small-text">카카오톡 안에서는 설치 창이 나타나지 않을 수 있어요. 외부 브라우저에서 같은 아이디로 로그인한 뒤 앱 설치 또는 홈 화면에 추가를 선택해 주세요.</p>
        <p className="muted small-text">브라우저 간 로그인 정보는 공유되지 않습니다. 비회원이라면 먼저 계정을 만들고 내 계정에서 파티를 연결해 주세요.</p>
        <div className="actions wrap">
          <a className="button primary small" href={`kakaotalk://web/openExternal?url=${encodeURIComponent(target)}`}>앱 설치하러 외부 브라우저 열기</a>
          <button type="button" className="button small" onClick={() => void copy()}>{copied ? '링크 복사됨' : '설치 링크 복사'}</button>
        </div>
        <details className="install-guide"><summary>열리지 않을 때</summary><p className="muted small-text">카카오톡 메뉴에서 외부 브라우저로 열어 주세요. Android는 Chrome 메뉴의 앱 설치, iPhone은 Safari 공유 메뉴의 홈 화면에 추가를 이용하세요.</p><label>외부 브라우저에서 열 주소<input readOnly value={target} onFocus={event => event.target.select()} /></label></details>
        {copyFailed && <p role="status" className="muted small-text">링크를 복사하지 못했어요. 위의 ‘열리지 않을 때’에서 주소를 직접 복사해 주세요.</p>}
      </div>
    </aside>
  }
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
