import type {
  CommonAvailability,
  Group,
  GroupAvailability,
  Member,
  Membership,
  Me,
  OverrideSchedule,
  Slot,
  WeeklySchedule,
  WeeklySlot,
} from '../types/api'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export const AUTH_INVALID = 'partysync:auth-invalid'
/** 이미 조회한 화면은 일시적인 통신/서버 오류에도 유지해 편집 초안을 보존합니다. */
export function isTemporaryError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof ApiError && error.status >= 500)
}
type Credentials = { groupId: number; token: string }
const messages: Record<string, string> = {
  NICKNAME_CONFLICT: '이 그룹에서 이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.',
  INVITE_NOT_FOUND: '사용할 수 없는 초대 코드입니다. 초대한 파티원에게 링크를 확인해 주세요.',
  GROUP_NOT_FOUND: '그룹을 찾을 수 없습니다.',
  INVALID_REQUEST: '입력한 값이나 날짜 범위를 다시 확인해 주세요.',
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return '인증 정보를 확인할 수 없습니다. 초대 링크로 다시 참여해 주세요.'
    if (error.status === 403) return '이 그룹 또는 기능에 접근할 권한이 없습니다.'
    return (
      messages[error.code] ||
      (error.status === 404
        ? '요청한 정보를 찾을 수 없습니다.'
        : error.status === 409
          ? '다른 요청과 충돌했습니다. 다시 시도해 주세요.'
          : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    )
  }
  return '서버에 연결할 수 없습니다. 연결 상태를 확인하고 다시 시도해 주세요.'
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: Credentials; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.auth) headers.Authorization = `Bearer ${options.auth.token}`
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  })
  if (!response.ok) {
    if (response.status === 401 && options.auth)
      window.dispatchEvent(new CustomEvent(AUTH_INVALID, { detail: options.auth }))
    const data = (await response.json().catch(() => ({}))) as { code?: string }
    throw new ApiError(response.status, data.code || 'UNKNOWN', 'API request failed')
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>)
}
const range = (from: string, to: string) => `?${new URLSearchParams({ from, to })}`
export const api = {
  create: (body: { name: string; description?: string; ownerNickname: string }) =>
    request<Membership>('/groups', { method: 'POST', body }),
  join: (body: { inviteCode: string; nickname: string }) =>
    request<Membership>('/groups/join', { method: 'POST', body }),
  me: (auth: Credentials) => request<Me>('/members/me', { auth }),
  group: (auth: Credentials) => request<Group>(`/groups/${auth.groupId}`, { auth }),
  members: (auth: Credentials) => request<Member[]>(`/groups/${auth.groupId}/members`, { auth }),
  invite: (auth: Credentials) =>
    request<{ groupId: number; inviteCode: string }>(`/groups/${auth.groupId}/invite`, { auth }),
  weekly: (auth: Credentials) =>
    request<WeeklySchedule>('/members/me/weekly-availability', { auth }),
  saveWeekly: (auth: Credentials, slots: WeeklySlot[]) =>
    request<WeeklySchedule>('/members/me/weekly-availability', {
      method: 'PUT',
      auth,
      body: { slots },
    }),
  overrides: (auth: Credentials, from: string, to: string) =>
    request<OverrideSchedule[]>(`/members/me/availability-overrides${range(from, to)}`, { auth }),
  saveOverride: (auth: Credentials, date: string, slots: Slot[]) =>
    request<OverrideSchedule>(`/members/me/availability-overrides/${date}`, {
      method: 'PUT',
      auth,
      body: { slots },
    }),
  deleteOverride: (auth: Credentials, date: string) =>
    request<void>(`/members/me/availability-overrides/${date}`, { method: 'DELETE', auth }),
  availability: (auth: Credentials, from: string, to: string) =>
    request<GroupAvailability>(`/groups/${auth.groupId}/availability${range(from, to)}`, { auth }),
  common: (auth: Credentials, from: string, to: string) =>
    request<CommonAvailability>(`/groups/${auth.groupId}/common-availability${range(from, to)}`, {
      auth,
    }),
}
