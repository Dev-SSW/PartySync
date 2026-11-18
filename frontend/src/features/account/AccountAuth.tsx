import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { accountApi, type AccountLogin } from '../../api/account'
import { ACCOUNT_INVALID, ACCOUNT_RESTORED, restoreAccount, type AccountCredentials } from '../../api/client'
import { readAccount, storeAccount, type AccountSession } from './accountStorage'
import { useAuth } from '../member/Auth'

interface AccountState {
  account: AccountSession | null
  ready: boolean
  restoring: boolean
  error: unknown
  credentials: AccountCredentials | undefined
  accept: (response: AccountLogin) => void
  logout: () => Promise<void>
  retry: () => void
}
const Context = createContext<AccountState | null>(null)
/** 계정 검증·로그인 복원·기기별 로그아웃 상태를 관리한다. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState(readAccount)
  const [restoring, setRestoring] = useState(true)
  const [restoreError, setRestoreError] = useState<unknown>(null)
  const client = useQueryClient(), { forgetAccount } = useAuth()
  const credentials: AccountCredentials | undefined = account ? { account: true, token: account.token } : undefined
  const me = useQuery({ queryKey: ['account', account?.revision, 'me'], queryFn: () => accountApi.me(credentials!), enabled: !!account, retry: false, staleTime: 30000 })
  /** 비회원 참여 정보는 남기고 계정 인증과 관련 캐시를 정리한다. */
  function clear() {
    storeAccount(null); setAccount(null); forgetAccount()
    void client.cancelQueries({ queryKey: ['account'] }); client.removeQueries({ queryKey: ['account'] })
  }
  /** 통신 오류는 인증을 지우지 않고 재시도할 수 있게 남긴다. */
  async function restore() {
    setRestoring(true); setRestoreError(null)
    try {
      const result = await restoreAccount()
      if (!result) clear()
      else setAccount(readAccount())
    } catch (error) { setRestoreError(error) }
    finally { setRestoring(false) }
  }
  useEffect(() => {
    if (!account || Date.parse(account.expiresAt) <= Date.now()) void restore()
    else setRestoring(false)
    // 최초 복원만 수행하고 이후 서버 인증 실패는 API 클라이언트에서 처리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!account) return
    // API 토큰 만료 시 복원하며 타이머의 최대 지연 범위를 넘지 않게 한다.
    const timer = window.setTimeout(() => void restore(), Math.min(2147483647, Math.max(0, Date.parse(account.expiresAt) - Date.now())))
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.token, account?.expiresAt])
  useEffect(() => {
    const invalid = (event: Event) => {
      if (readAccount()?.token === (event as CustomEvent<{ token: string }>).detail.token) clear()
    }
    window.addEventListener(ACCOUNT_INVALID, invalid)
    const restored = () => setAccount(readAccount())
    window.addEventListener(ACCOUNT_RESTORED, restored)
    return () => { window.removeEventListener(ACCOUNT_INVALID, invalid); window.removeEventListener(ACCOUNT_RESTORED, restored) }
  })
  function accept(response: AccountLogin) {
    setRestoreError(null); setRestoring(false)
    const value = { token: response.accountAccessToken, user: response.user, expiresAt: response.expiresAt, revision: crypto.randomUUID() }
    storeAccount(value)
    forgetAccount()
    void client.cancelQueries({ queryKey: ['account'] }); client.removeQueries({ queryKey: ['account'] })
    setAccount(value)
  }
  async function logout() { if (credentials) await accountApi.logout(credentials); else await accountApi.forget(); clear() }
  const ready = !restoring && !!account && Date.parse(account.expiresAt) > Date.now() && !!me.data && me.data.userId === account.user.userId
  return <Context.Provider value={{ account, ready, restoring, credentials, error: restoreError || me.error, accept, logout, retry: () => { if (restoreError) void restore(); else void me.refetch() } }}>{children}</Context.Provider>
}
export function useAccount() {
  const context = useContext(Context)
  if (!context) throw new Error('AccountProvider required')
  return context
}
