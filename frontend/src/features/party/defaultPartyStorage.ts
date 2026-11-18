import { useCallback, useSyncExternalStore } from 'react'

const CHANGED = 'partysync:default-party-changed'
export const defaultPartyKey = (userId?: number) => `partysync.default-party.v1.${userId ? `account.${userId}` : 'guest'}`

/** 기본 설정에는 그룹 ID만 저장하며 로그인 계정과 비회원의 범위를 분리한다. */
export function readDefaultParty(userId?: number): number | null {
  try {
    const raw = localStorage.getItem(defaultPartyKey(userId))
    const id = Number(raw)
    return raw && /^\d+$/.test(raw) && Number.isSafeInteger(id) && id > 0 ? id : null
  } catch { return null }
}
export function writeDefaultParty(groupId: number | null, userId?: number) {
  if (groupId !== null && (!Number.isSafeInteger(groupId) || groupId <= 0)) throw new Error('Invalid group ID')
  const key = defaultPartyKey(userId)
  if (groupId === null) localStorage.removeItem(key)
  else localStorage.setItem(key, String(groupId))
  window.dispatchEvent(new Event(CHANGED))
}

/** 같은 저장소를 쓰는 탭의 설정 변경만 반영한다. */
export function useDefaultParty(userId?: number, enabled = true) {
  const subscribe = useCallback((listener: () => void) => {
    const changed = (event: StorageEvent) => { if (event.key === null || event.key === defaultPartyKey(userId)) listener() }
    window.addEventListener('storage', changed)
    window.addEventListener(CHANGED, listener)
    return () => { window.removeEventListener('storage', changed); window.removeEventListener(CHANGED, listener) }
  }, [userId])
  const id = useSyncExternalStore(subscribe, () => enabled ? readDefaultParty(userId) : null)
  return { id, set: (id: number | null) => writeDefaultParty(id, userId) }
}
