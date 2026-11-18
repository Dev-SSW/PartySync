import { useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../api/client'
import { accountApi } from '../../api/account'
import { useAccount } from '../account/AccountAuth'
import { useAuth } from '../member/Auth'
import { readSessions, type Session } from '../member/storage'
import { accessDenied, type Party } from './usePartyList'

/** 입장 직전 권한을 확인하고 필요한 경우에만 기존 멤버의 세션을 재발급한다. */
export function usePartyEntry() {
  const account = useAccount(), auth = useAuth(), client = useQueryClient()
  const identity = account.ready ? account.account!.user.userId : undefined
  const currentIdentity = useRef(identity)
  currentIdentity.current = identity
  return async (party: Party) => {
    const checkIdentity = () => {
      if (currentIdentity.current !== identity) throw new ApiError(409, 'ACCOUNT_CHANGED', 'Account changed')
    }
    const verify = async (session: Session) => {
      const me = await api.me(session)
      checkIdentity()
      if (me.groupId !== party.groupId || me.memberId !== party.memberId) throw new ApiError(403, 'FORBIDDEN', 'Membership mismatch')
      client.setQueryData(['group', party.groupId, session.revision, 'me'], me)
    }
    if (party.kind === 'guest') {
      if (!party.session) throw new ApiError(401, 'UNAUTHORIZED', 'Session required')
      await verify(party.session)
      return party.groupId
    }
    if (!account.ready || !account.credentials) throw new ApiError(401, 'UNAUTHORIZED', 'Account required')
    const stored = readSessions().find(session => session.groupId === party.groupId && session.accountUserId === identity)
    if (stored && (!stored.expiresAt || Date.parse(stored.expiresAt) > Date.now())) {
      try { await verify(stored); return party.groupId }
      catch (error) { if (!accessDenied(error)) throw error }
    }
    const membership = await accountApi.enter(account.credentials, party.groupId)
    checkIdentity()
    if (membership.group.groupId !== party.groupId || membership.member.memberId !== party.memberId)
      throw new ApiError(403, 'FORBIDDEN', 'Membership mismatch')
    await auth.remember(membership, undefined, identity)
    const session = readSessions().find(session => session.groupId === party.groupId)
    if (session) client.setQueryData(['group', party.groupId, session.revision, 'me'], {
      ...membership.member, groupId: party.groupId,
    })
    return party.groupId
  }
}
