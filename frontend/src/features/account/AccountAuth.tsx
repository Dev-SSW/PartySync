import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { accountApi, type AccountLogin } from '../../api/account'
import { ACCOUNT_INVALID, type AccountCredentials } from '../../api/client'
import { readAccount, storeAccount, type AccountSession } from './accountStorage'
import { useAuth } from '../member/Auth'

interface AccountState {
  account: AccountSession | null
  ready: boolean
  error: unknown
  credentials: AccountCredentials | undefined
  accept: (response: AccountLogin) => void
  logout: () => Promise<void>
  retry: () => void
}
const Context = createContext<AccountState | null>(null)
export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState(readAccount)
  const client = useQueryClient(), { forgetAccount } = useAuth()
  const credentials: AccountCredentials | undefined = account ? { account: true, token: account.token } : undefined
  const me = useQuery({ queryKey: ['account', account?.revision, 'me'], queryFn: () => accountApi.me(credentials!), enabled: !!account, retry: false, staleTime: 30000 })
  function clear() {
    storeAccount(null); setAccount(null); forgetAccount()
    void client.cancelQueries({ queryKey: ['account'] }); client.removeQueries({ queryKey: ['account'] })
  }
  useEffect(() => {
    const invalid = (event: Event) => {
      if (readAccount()?.token === (event as CustomEvent<{ token: string }>).detail.token) clear()
    }
    window.addEventListener(ACCOUNT_INVALID, invalid)
    return () => window.removeEventListener(ACCOUNT_INVALID, invalid)
  })
  function accept(response: AccountLogin) {
    const value = { token: response.accountAccessToken, user: response.user, expiresAt: response.expiresAt, revision: crypto.randomUUID() }
    storeAccount(value)
    forgetAccount()
    void client.cancelQueries({ queryKey: ['account'] }); client.removeQueries({ queryKey: ['account'] })
    setAccount(value)
  }
  async function logout() { if (credentials) await accountApi.logout(credentials); clear() }
  const ready = !!account && !!me.data && me.data.userId === account.user.userId
  return <Context.Provider value={{ account, ready, credentials, error: me.error, accept, logout, retry: () => void me.refetch() }}>{children}</Context.Provider>
}
export function useAccount() {
  const context = useContext(Context)
  if (!context) throw new Error('AccountProvider required')
  return context
}
