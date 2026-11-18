import { ApiError, request, restoreAccount } from '../api/client'
import { readAccount, storeAccount } from '../features/account/accountStorage'

const login = { user: { userId: 1, loginId: 'member', createdAt: '' }, accountAccessToken: 'u_' + 'A'.repeat(43), expiresAt: '2030-01-01T00:00:00Z' }
describe('쿠키 기반 계정 복원', () => {
  it('동시 복원은 한 번만 요청하고 토큰을 localStorage에 저장하지 않는다', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(login)))
    vi.stubGlobal('fetch', fetch)
    await Promise.all([restoreAccount(), restoreAccount(), restoreAccount()])
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', headers: { 'X-PartySync-Client': 'web' } })
    expect(readAccount()?.token).toBe(login.accountAccessToken)
    expect(localStorage.length).toBe(0)
  })
  it('일시적인 갱신 장애는 저장된 계정을 폐기하지 않는다', async () => {
    storeAccount({ token: login.accountAccessToken, user: login.user, expiresAt: login.expiresAt, revision: 'old' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    await expect(restoreAccount()).rejects.toMatchObject({ status: 503 })
    expect(readAccount()?.token).toBe(login.accountAccessToken)
  })
  it('401 계정 요청을 갱신하고 새 Bearer로 한 번만 재시도한다', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return new Response(JSON.stringify(login))
      return (init.headers as Record<string, string>).Authorization === `Bearer ${login.accountAccessToken}` ? new Response('{}') : new Response('{}', { status: 401 })
    })
    vi.stubGlobal('fetch', fetch)
    await request('/account/me', { auth: { account: true, token: 'u_' + 'B'.repeat(43) } })
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('만료 쿠키는 복원하지 않으며 잘못된 응답을 로그인으로 수락하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    expect(await restoreAccount()).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    await expect(restoreAccount()).rejects.toBeInstanceOf(ApiError)
    expect(readAccount()).toBeNull()
  })
})
