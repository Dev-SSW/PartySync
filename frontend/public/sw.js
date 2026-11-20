/* 알림 수신 전용 서비스 워커: 인증 API나 게시글은 캐시하지 않습니다. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let message = {}
  try { message = event.data?.json() || {} } catch { /* 잘못된 데이터에도 사용자에게 알림을 표시한다. */ }
  const url = /^\/groups\/[1-9]\d*$/.test(message.url) ? message.url : '/account/groups'
  event.waitUntil(self.registration.showNotification(message.title || 'PartySync 일정 알림', {
    body: message.body || '파티원의 일정이 변경되었어요.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: message.tag || 'partysync-schedule',
    data: { url },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const path = event.notification.data?.url
  const url = new URL(/^\/groups\/[1-9]\d*$/.test(path) ? path : '/account/groups', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const target = windows.find(client => client.url === url)
    if (target) return target.focus()
    return self.clients.openWindow(url)
  })())
})
