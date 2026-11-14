import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useParams } from 'react-router-dom'
import { api, AUTH_INVALID, isTemporaryError } from '../../api/client'
import type { Membership } from '../../types/api'
import { inviteHash, readSessions, STORAGE_KEY, writeSessions, type Session } from './storage'
import { Feedback, Loading } from '../../components/Feedback'

interface AuthState {
  sessions: Session[]
  remember: (data: Membership, code?: string) => Promise<void>
  forget: (id: number) => void
}
const AuthContext = createContext<AuthState | null>(null)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState(readSessions)
  const client = useQueryClient()
  const clearGroup = (id: number) => {
    void client.cancelQueries({ queryKey: ['group', id] })
    client.removeQueries({ queryKey: ['group', id] })
  }
  function forget(id: number) {
    const next = readSessions().filter((s) => s.groupId !== id)
    try {
      writeSessions(next)
    } catch {
      /* 메모리의 인증 상태와 조회 캐시는 반드시 제거합니다. */
    }
    setSessions(next)
    clearGroup(id)
  }
  useEffect(() => {
    const invalid = (event: Event) => {
      const { groupId, token } = (event as CustomEvent<{ groupId: number; token: string }>).detail
      // 교체되기 전의 요청이 늦게 401을 반환해도 새 토큰을 제거하지 않습니다.
      const current = readSessions().find((s) => s.groupId === groupId)
      if (current?.token === token) {
        const next = readSessions().filter((s) => s.groupId !== groupId)
        try {
          writeSessions(next)
        } catch {
          /* 인증 실패 시 메모리 상태부터 정리합니다. */
        }
        setSessions(next)
        void client.cancelQueries({ queryKey: ['group', groupId] })
        client.removeQueries({ queryKey: ['group', groupId] })
      }
    }
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        setSessions(readSessions())
        client.clear()
      }
    }
    window.addEventListener(AUTH_INVALID, invalid)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(AUTH_INVALID, invalid)
      window.removeEventListener('storage', sync)
    }
  }, [client])
  async function remember(data: Membership, code?: string) {
    const hash = code ? await inviteHash(code) : undefined
    const session: Session = {
      groupId: data.group.groupId,
      token: data.memberAccessToken,
      name: data.group.name,
      inviteHash: hash,
      revision: crypto.randomUUID(),
    }
    const next = [...readSessions().filter((s) => s.groupId !== session.groupId), session]
    writeSessions(next)
    clearGroup(session.groupId)
    setSessions(next)
  }
  return (
    <AuthContext.Provider value={{ sessions, remember, forget }}>{children}</AuthContext.Provider>
  )
}
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('AuthProvider required')
  return context
}
export function useGroupSession() {
  const id = Number(useParams().groupId)
  const { sessions } = useAuth()
  const session = sessions.find((s) => s.groupId === id)
  const me = useQuery({
    queryKey: ['group', id, session?.revision, 'me'],
    queryFn: () => api.me(session!),
    enabled: !!session,
    staleTime: 30_000,
  })
  return { session, me, key: ['group', id, session?.revision] as const }
}
export function RequireMember() {
  const { session, me } = useGroupSession()
  if (!session)
    return (
      <section className="narrow page">
        <h1>그룹 참여가 필요해요</h1>
        <p className="muted">
          이 브라우저에 해당 그룹의 인증 정보가 없습니다. 초대 링크로 참여해 주세요.
        </p>
        <Link className="button primary" to="/join">
          초대 코드로 참여
        </Link>
      </section>
    )
  if (me.isPending) return <Loading />
  if (!me.data || (me.error && !isTemporaryError(me.error)))
    return (
      <div className="narrow page">
        <Feedback error={me.error} retry={() => void me.refetch()} />
      </div>
    )
  if (me.data.groupId !== session.groupId)
    return (
      <div className="narrow page">
        <p role="alert">다른 그룹의 인증 정보입니다. 올바른 초대 링크로 참여해 주세요.</p>
      </div>
    )
  return (
    <>
      {me.error && <Feedback error={me.error} retry={() => void me.refetch()} />}
      <Outlet />
    </>
  )
}
