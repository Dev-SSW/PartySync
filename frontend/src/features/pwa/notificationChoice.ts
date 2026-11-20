export type NotificationChoice = 'later' | 'install' | 'enabled'

// 알림 선택은 이 브라우저·멤버별로 보관하며 인증 정보나 구독 키는 저장하지 않는다.
export const notificationChoiceKey = (memberId: number) => `partysync.notification-choice.v1.${memberId}`
export function readNotificationChoice(memberId: number): NotificationChoice | null {
  try {
    const value = localStorage.getItem(notificationChoiceKey(memberId))
    return value === 'later' || value === 'install' || value === 'enabled' ? value : null
  } catch { return null }
}
export function saveNotificationChoice(memberId: number, value: NotificationChoice) {
  try { localStorage.setItem(notificationChoiceKey(memberId), value) }
  catch { /* 저장이 차단되어도 참여와 현재 화면의 선택은 유지한다. */ }
}
