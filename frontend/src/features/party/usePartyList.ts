import { useQueries, useQuery } from '@tanstack/react-query'
import { accountApi } from '../../api/account'
import { api, ApiError } from '../../api/client'
import { useAccount } from '../account/AccountAuth'
import { useAuth } from '../member/Auth'
import type { Session } from '../member/storage'
import type { Role } from '../../types/api'

export interface Party {
  groupId: number; name: string; memberId: number; nickname: string; role: Role
  kind: 'account' | 'guest'; session?: Session
}
export const accessDenied = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status)

/** 연결 파티는 서버 목록을 기준으로 삼고 비회원은 보유 토큰을 검증한다. */
export function usePartyList({ enabled = true, guestGroupId }: { enabled?: boolean; guestGroupId?: number | null } = {}) {
  const account = useAccount()
  const { sessions } = useAuth()
  const accountWaiting = account.restoring || (!!account.account && !account.ready && !account.error)
  const groups = useQuery({ queryKey: ['account', account.account?.revision, 'groups'],
    queryFn: () => accountApi.groups(account.credentials!), enabled: enabled && account.ready, retry: false })
  const linked: Party[] = account.ready ? (groups.data || []).map(group => ({
    groupId: group.groupId, name: group.groupName, memberId: group.memberId, nickname: group.nickname,
    role: group.role, kind: 'account',
  })) : []
  // 계정 목록과 겹치는 비회원 토큰은 조회와 표시를 생략한다.
  const guests = enabled ? sessions.filter(session => !session.accountUserId
    && (guestGroupId === undefined || session.groupId === guestGroupId)
    && !linked.some(group => group.groupId === session.groupId)) : []
  const guestsEnabled = !accountWaiting && !(account.ready && groups.isPending)
  const checks = useQueries({ queries: guests.map(session => ({
    queryKey: ['group', session.groupId, session.revision, 'me'],
    queryFn: async () => {
      const me = await api.me(session)
      if (me.groupId !== session.groupId) throw new ApiError(403, 'FORBIDDEN', 'Membership mismatch')
      return me
    }, enabled: guestsEnabled, retry: false, staleTime: 30000,
  })) })
  const verified: Party[] = guests.flatMap((session, index) => {
    const result = checks[index]
    return result.data && !accessDenied(result.error) ? [{ groupId: session.groupId, name: session.name,
      memberId: result.data.memberId, nickname: result.data.nickname, role: result.data.role, kind: 'guest', session }] : []
  })
  const parties = [...new Map([...verified, ...linked].map(party => [party.groupId, party])).values()]
  const guestError = checks.find(check => check.error && !accessDenied(check.error))?.error
  const error = account.error || (account.ready ? groups.error : null) || guestError
  const waiting = accountWaiting || (enabled && account.ready && groups.isPending)
    || (guestsEnabled && checks.some(check => check.isPending))
  return { parties, waiting, error, retry: () => {
    if (account.error) account.retry()
    if (enabled && account.ready) void groups.refetch()
    checks.forEach(check => { if (guestsEnabled) void check.refetch() })
  } }
}
