export function pushSupport(): 'ready' | 'install' | 'unsupported' {
  if (window.isSecureContext === false || !('serviceWorker' in navigator)) return 'unsupported'
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const inApp = /KAKAOTALK|NAVER|FBAN|FBAV|Instagram|; wv\)/i.test(navigator.userAgent)
  if (!standalone && (ios || inApp)) return 'install'
  if ('PushManager' in window && 'Notification' in window) return 'ready'
  return standalone ? 'unsupported' : 'install'
}

export function registerServiceWorker() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
}

export async function readyServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await registerServiceWorker()
  if (registration.active) return registration
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('서비스 워커를 준비하지 못했습니다. 앱을 다시 열고 시도해 주세요.')), 10000)
    navigator.serviceWorker.ready.then(value => { window.clearTimeout(timer); resolve(value) }, error => { window.clearTimeout(timer); reject(error) })
  })
}

export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
  return bytes
}
