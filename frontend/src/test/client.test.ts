import { api, ApiError, AUTH_INVALID, errorMessage, request } from '../api/client'
const auth = { groupId: 4, token: 'secret-token' }
describe('공통 API 클라이언트', () => {
  it('선택한 그룹의 Bearer를 헤더로만 보낸다', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ memberId: 1 })))
    vi.stubGlobal('fetch', fetch)
    await api.me(auth)
    expect(fetch).toHaveBeenCalledWith(
      '/api/members/me',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer secret-token' },
        credentials: 'omit',
      }),
    )
    expect(fetch.mock.calls[0][0]).not.toContain(auth.token)
  })
  it('공개 생성·참여 요청은 Authorization을 보내지 않는다', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetch)
    await api.create({ name: '파티', ownerNickname: '오너' })
    await api.join({ inviteCode: 'code', nickname: '새멤버' })
    for (const call of fetch.mock.calls) expect(call[1].headers).not.toHaveProperty('Authorization')
  })
  it('204 DELETE를 JSON 파싱하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await expect(api.deleteOverride(auth, '2026-11-13')).resolves.toBeUndefined()
  })
  it.each([400, 403, 404, 409, 500])(
    '%i 오류를 구분하고 서버 내부 메시지는 노출하지 않는다',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ code: 'UNKNOWN', message: 'SELECT secret FROM tokens' }),
              { status },
            ),
          ),
      )
      try {
        await request('/groups/4', { auth })
        throw new Error('expected failure')
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError)
        expect((e as ApiError).status).toBe(status)
        expect(errorMessage(e)).not.toContain('SELECT')
      }
    },
  )
  it('401에서만 해당 그룹의 인증 실패 이벤트를 발생시킨다', async () => {
    const listener = vi.fn()
    window.addEventListener(AUTH_INVALID, listener)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await expect(api.me(auth)).rejects.toMatchObject({ status: 401 })
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0].detail.groupId).toBe(4)
    window.removeEventListener(AUTH_INVALID, listener)
  })
  it('네트워크 오류를 한국어로 안내한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api.me(auth)).rejects.toThrow('Failed to fetch')
    expect(errorMessage(new TypeError())).toContain('연결')
  })
  it('닉네임 중복을 이해할 수 있게 안내한다', () =>
    expect(errorMessage(new ApiError(409, 'NICKNAME_CONFLICT', 'internal'))).toContain(
      '이미 사용 중',
    ))
})
