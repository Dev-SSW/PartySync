import { useEffect, useState } from 'react'

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
/** 설치 가능한 환경에만 간단한 안내를 표시한다. */
export function InstallHint() {
  const [install, setInstall] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  useEffect(() => {
    // 브라우저의 기본 설치 팝업 대신 사용자가 누를 수 있는 버튼을 제공한다.
    const available = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent) }
    const done = () => { setInstall(null); setInstalled(true) }
    window.addEventListener('beforeinstallprompt', available)
    window.addEventListener('appinstalled', done)
    return () => { window.removeEventListener('beforeinstallprompt', available); window.removeEventListener('appinstalled', done) }
  }, [])
  if (installed || window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone) return null
  const ua = navigator.userAgent
  if (/KAKAOTALK/i.test(ua)) return <p className="muted small-text">홈 화면에 설치하려면 카카오톡 메뉴에서 외부 브라우저로 열어 주세요. 브라우저마다 로그인·참여 정보가 다를 수 있어요.</p>
  if (install) return <button className="button small" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null) }}>PartySync 설치</button>
  if (/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) return <p className="muted small-text">Safari 공유 메뉴 → 홈 화면에 추가로 PartySync를 설치할 수 있어요.</p>
  return null
}
