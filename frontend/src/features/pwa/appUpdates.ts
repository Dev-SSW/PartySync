import { updateSafety } from './updateSafety'

const UPDATE_PARAMETER = '__ps_update'
type Snapshot = { version: string | null; applying: boolean }

/** 실제 화면 빌드 버전을 확인한다. 서비스 워커 코드가 바뀌지 않은 배포도 감지한다. */
export class AppUpdateMonitor {
  private snapshot: Snapshot = { version: null, applying: false }
  private listeners = new Set<() => void>()
  private checking = false
  private interacted = false
  private stop: (() => void) | undefined
  private controller: AbortController | undefined

  constructor(private version: string | undefined, private navigate = (url: string) => window.location.replace(url)) { }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(value: Snapshot) { this.snapshot = value; this.listeners.forEach(listener => listener()) }

  start() {
    if (!this.version || this.stop) return
    const url = new URL(window.location.href)
    if (url.searchParams.get(UPDATE_PARAMETER) === this.version) {
      url.searchParams.delete(UPDATE_PARAMETER)
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    }
    const interact = () => { this.interacted = true }
    const resume = () => { if (document.visibilityState !== 'hidden') void this.check() }
    for (const type of ['pointerdown', 'keydown', 'input']) window.addEventListener(type, interact, true)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', resume)
    const timer = window.setInterval(resume, 60000)
    this.stop = () => {
      for (const type of ['pointerdown', 'keydown', 'input']) window.removeEventListener(type, interact, true)
      window.removeEventListener('focus', resume); window.removeEventListener('online', resume); window.removeEventListener('pageshow', resume)
      document.removeEventListener('visibilitychange', resume); window.clearInterval(timer)
      this.controller?.abort(); this.stop = undefined
    }
    // 첫 화면 렌더링을 기다리게 하지 않고, 조작하기 전이라면 새 버전으로 자동 진입한다.
    void this.check(true)
  }
  dispose() { this.stop?.() }

  async check(initial = false) {
    if (!this.version || this.checking || this.snapshot.applying) return
    this.checking = true
    const controller = new AbortController()
    this.controller = controller
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch('/version.json', { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal })
      if (!response.ok) return
      const data = await response.json() as { version?: unknown }
      if (controller.signal.aborted) return
      if (typeof data.version !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(data.version)) return
      if (data.version === this.version) {
        if (this.snapshot.version) this.emit({ version: null, applying: false })
        return
      }
      this.emit({ version: data.version, applying: false })
      if (initial && !this.interacted && !updateSafety.getSnapshot()
          && new URL(window.location.href).searchParams.get(UPDATE_PARAMETER) !== data.version) this.apply()
    } catch { /* 오프라인·배포 중 오류는 현재 앱 사용을 막지 않고 다음 확인 때 재시도한다. */ }
    finally { window.clearTimeout(timeout); this.checking = false; this.controller = undefined }
  }

  apply() {
    if (!this.snapshot.version || this.snapshot.applying || updateSafety.getSnapshot()) return
    const url = new URL(window.location.href)
    url.searchParams.set(UPDATE_PARAMETER, this.snapshot.version)
    this.emit({ ...this.snapshot, applying: true })
    // 로그인 정보·파티 설정·푸시 구독을 지우지 않고 현재 경로만 다시 불러온다.
    this.navigate(url.href)
  }
}

export const appUpdates = new AppUpdateMonitor(import.meta.env.VITE_APP_BUILD_ID)
