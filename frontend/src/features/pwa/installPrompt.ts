export interface InstallEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: string }>
}

let snapshot: { prompt: InstallEvent | null; installed: boolean } = { prompt: null, installed: false }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())

// React가 표시되기 전에 도착한 설치 이벤트도 보관한다.
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  snapshot = { prompt: event as InstallEvent, installed: false }
  emit()
})
window.addEventListener('appinstalled', () => {
  snapshot = { prompt: null, installed: true }
  emit()
})

export const installPrompt = {
  getSnapshot: () => snapshot,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  // 사용한 이벤트만 비워 늦은 응답이 새 설치 이벤트를 지우지 않게 한다.
  consume: (event: InstallEvent) => {
    if (snapshot.prompt !== event) return
    snapshot = { ...snapshot, prompt: null }
    emit()
  },
}
