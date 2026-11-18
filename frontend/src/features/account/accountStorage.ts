import type { AccountUser } from '../../api/account'

export const ACCOUNT_KEY = 'partysync.account.v1'
export interface AccountSession { token: string; user: AccountUser; revision: string; expiresAt: string }
/** 짧은 API 토큰만 보관한다. 장기 복원 토큰은 HttpOnly 쿠키이며 JS에서 읽지 않는다. */
export function readAccount(): AccountSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(ACCOUNT_KEY) || 'null')
    return value && /^u_[A-Za-z0-9_-]{43}$/.test(value.token) && Number.isSafeInteger(value.user?.userId) && typeof value.revision === 'string' && Number.isFinite(Date.parse(value.expiresAt)) ? value : null
  } catch { return null }
}
export function storeAccount(value: AccountSession | null) {
  if (value) sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(value))
  else sessionStorage.removeItem(ACCOUNT_KEY)
}
