import { request, type AccountCredentials, type Credentials } from './client'
import type { Membership, Role } from '../types/api'

export interface AccountUser { userId: number; loginId: string; createdAt: string }
export interface AccountLogin { user: AccountUser; accountAccessToken: string; expiresAt: string }
export interface AccountGroup { groupId: number; groupName: string; memberId: number; nickname: string; role: Role; joinedAt: string }
export const accountApi = {
  register: (loginId: string, password: string, remember = true) => request<AccountLogin>(`/auth/register?rememberMe=${remember}`, { method: 'POST', body: { loginId, password } }),
  login: (loginId: string, password: string, remember = true) => request<AccountLogin>(`/auth/login?rememberMe=${remember}`, { method: 'POST', body: { loginId, password } }),
  resumeInvite: (auth: AccountCredentials, inviteCode: string) => request<Membership>('/account/invite/session', { auth, method: 'POST', body: { inviteCode } }),
  join: (auth: AccountCredentials, inviteCode: string, nickname: string) => request<Membership>('/account/groups/join', { auth, method: 'POST', body: { inviteCode, nickname } }),
  forget: () => request<void>('/auth/forget', { method: 'POST' }),
  me: (auth: AccountCredentials) => request<AccountUser>('/account/me', { auth }),
  groups: (auth: AccountCredentials) => request<AccountGroup[]>('/account/groups', { auth }),
  claim: (auth: AccountCredentials, memberAccessToken: string) => request<Membership>('/account/memberships/claim', { auth, method: 'POST', body: { memberAccessToken } }),
  enter: (auth: AccountCredentials, groupId: number) => request<Membership>(`/account/groups/${groupId}/session`, { auth, method: 'POST' }),
  logout: (auth: AccountCredentials) => request<void>('/auth/logout', { auth, method: 'POST' }),
  logoutMember: (auth: Credentials) => request<void>('/members/me/session/logout', { auth, method: 'POST' }),
}
