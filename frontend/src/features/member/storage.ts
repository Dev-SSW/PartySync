export const STORAGE_KEY = 'partysync.memberships.v1'
export interface Session {
  groupId: number
  token: string
  name: string
  inviteHash?: string
  revision: string
}

// MVP의 장기 Bearer Token은 XSS 발생 시 노출될 수 있습니다. 공개 전 HttpOnly 인증 및 토큰 폐기 정책이 필요합니다.
export function readSessions(): Session[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(data)
      ? data.filter(
          (s): s is Session =>
            s &&
            Number.isSafeInteger(s.groupId) &&
            s.groupId > 0 &&
            typeof s.token === 'string' &&
            /^[A-Za-z0-9_-]{43}$/.test(s.token) &&
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}
export async function inviteHash(code: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}
