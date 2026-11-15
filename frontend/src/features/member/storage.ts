export const STORAGE_KEY = 'partysync.memberships.v1'
export const ACCOUNT_MEMBERS_KEY = 'partysync.account-members.v1'
export interface Session {
  groupId: number
  token: string
  name: string
  inviteHash?: string
  revision: string
  accountUserId?: number
  expiresAt?: string
}

// MVP의 장기 Bearer Token은 XSS 발생 시 노출될 수 있습니다. 공개 전 HttpOnly 인증 및 토큰 폐기 정책이 필요합니다.
export function readSessions(): Session[] {
  const guests = readStore(localStorage, STORAGE_KEY).filter(s => !s.accountUserId && /^[A-Za-z0-9_-]{43}$/.test(s.token))
  const linked = readStore(sessionStorage, ACCOUNT_MEMBERS_KEY).filter(s => s.accountUserId && /^m_[A-Za-z0-9_-]{43}$/.test(s.token))
  return [...guests.filter(s => !linked.some(m => m.groupId === s.groupId)), ...linked]
}
function readStore(storage: Storage, key: string): Session[] {
  try {
    const data: unknown = JSON.parse(storage.getItem(key) || '[]')
    return Array.isArray(data)
      ? data.filter(
          (s): s is Session =>
            s &&
            Number.isSafeInteger(s.groupId) &&
            s.groupId > 0 &&
            typeof s.token === 'string' &&
            /^(m_)?[A-Za-z0-9_-]{43}$/.test(s.token) &&
            typeof s.name === 'string' &&
            typeof s.revision === 'string',
        )
      : []
  } catch {
    return []
  }
}
export function writeSessions(sessions: Session[]) {
  // 저장 실패를 숨기면 새로고침 시 유일한 토큰을 잃을 수 있으므로 호출자에게 오류를 전달합니다.
  // 복구 수단 없는 비회원만 기존 영속 저장을 유지한다. 계정 세션은 탭을 닫으면 정리된다.
  sessionStorage.setItem(ACCOUNT_MEMBERS_KEY, JSON.stringify(sessions.filter(s => s.accountUserId)))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.filter(s => !s.accountUserId)))
}
export async function inviteHash(code: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}
