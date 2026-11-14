import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../App'
import { AuthProvider } from '../features/member/Auth'
import { inviteHash, readSessions, STORAGE_KEY, writeSessions } from '../features/member/storage'
import { SlotEditor } from '../components/SlotEditor'
import { Calendar } from '../features/availability/Calendar'
import { useState } from 'react'

const session = { groupId: 1, name: '레이드', token: 'A'.repeat(43), revision: 'one' }
function app(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { router, client }
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const me = { memberId: 10, groupId: 1, nickname: '테스터', role: 'MEMBER' }
const group = {
  groupId: 1,
  name: '레이드',
  description: '테스트 그룹',
  memberCount: 1,
  createdAt: '2026-11-13T00:00:00',
}
function dashboardFetch(role = 'MEMBER') {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith('/members/me')) return json({ ...me, role })
    if (url.endsWith('/members')) return json([{ ...me, role, joinedAt: '2026-11-13T00:00:00' }])
    if (url.includes('common-availability')) return json({ groupId: 1, days: [] })
    if (url.includes('/availability?')) return json({ groupId: 1, days: [] })
    if (url.endsWith('/invite')) return json({ groupId: 1, inviteCode: 'invitation' })
    return json(group)
  })
}

describe('그룹 참여와 인증 복원', () => {
  it('기존 인증 정보가 있어도 재검증에서 401이면 접근을 차단한다', async () => {
    writeSessions([session])
    const fetch = dashboardFetch()
    vi.stubGlobal('fetch', fetch)
    const { client } = app('/groups/1')
    await screen.findByRole('heading', { name: '레이드' })
    fetch.mockResolvedValueOnce(json({}, 401))
    await act(async () => {
      await client.refetchQueries({ queryKey: ['group', 1, 'one', 'me'], exact: true })
    })
    await screen.findByText('그룹 참여가 필요해요')
    expect(readSessions()).toEqual([])
    expect(screen.queryByRole('heading', { name: '레이드' })).toBeNull()
  })
  it('전체 초대 링크에서 추출한 코드만 가입 API로 전송한다', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ code: 'NICKNAME_CONFLICT' }, 409))
    vi.stubGlobal('fetch', fetch)
    app('/join')
    await userEvent.type(
      screen.getByLabelText(/초대 코드 또는 초대 링크/),
      'https://party.example/join/Only_Code',
    )
    await userEvent.type(screen.getByLabelText(/내 닉네임/), '가입자')
    await userEvent.click(screen.getByRole('button', { name: '파티 참여하기' }))
    await screen.findByText(/이미 사용 중/)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      inviteCode: 'Only_Code',
      nickname: '가입자',
    })
  })
  it('링크를 붙여넣어도 저장된 그룹을 인식하고 재가입 요청은 하지 않는다', async () => {
    writeSessions([{ ...session, inviteHash: await inviteHash('known-code') }])
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    app('/join')
    await userEvent.type(
      screen.getByLabelText(/초대 코드 또는 초대 링크/),
      'http://localhost:5173/join/known-code',
    )
    await screen.findByText(/이미 이 브라우저에서 참여한 파티/)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('지원하지 않는 링크는 API 요청 전에 명확히 거절한다', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    app('/join')
    await userEvent.type(
      screen.getByLabelText(/초대 코드 또는 초대 링크/),
      'https://party.example/groups/123',
    )
    await userEvent.type(screen.getByLabelText(/내 닉네임/), '가입자')
    await userEvent.click(screen.getByRole('button', { name: '파티 참여하기' }))
    expect(screen.getByRole('alert')).toHaveTextContent('올바른 초대 링크')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('저장된 그룹 정보를 새로 읽고 잘못된 저장값은 무시한다', () => {
    writeSessions([session, { ...session, groupId: 2, revision: 'two', token: 'B'.repeat(43) }])
    expect(readSessions().map((s) => s.groupId)).toEqual([1, 2])
    localStorage.setItem(STORAGE_KEY, '{broken')
    expect(readSessions()).toEqual([])
  })
  it('공백뿐인 필수 입력은 API를 호출하지 않는다', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    app('/groups/new')
    await userEvent.type(screen.getByLabelText(/그룹 이름/), '   ')
    await userEvent.type(screen.getByLabelText(/내 닉네임/), '   ')
    await userEvent.click(screen.getByRole('button', { name: '파티 만들기' }))
    expect(screen.getByRole('alert')).toHaveTextContent('필수 항목')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('생성 성공 토큰을 저장하고 실제 그룹 화면으로 이동한다', async () => {
    const fetch = dashboardFetch('OWNER')
    fetch.mockImplementationOnce(async () =>
      json({
        group,
        member: { ...me, role: 'OWNER' },
        memberAccessToken: session.token,
        inviteCode: 'new-invite',
      }),
    )
    vi.stubGlobal('fetch', fetch)
    app('/groups/new')
    await userEvent.type(screen.getByLabelText(/그룹 이름/), '레이드')
    await userEvent.type(screen.getByLabelText(/내 닉네임/), '테스터')
    await userEvent.click(screen.getByRole('button', { name: '파티 만들기' }))
    await screen.findByRole('heading', { name: '레이드' })
    expect(readSessions()[0].token).toBe(session.token)
    expect(fetch.mock.calls[0][0]).toBe('/api/groups')
  })
  it('초대 가입 중 닉네임 충돌 시 입력을 유지한다', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ code: 'NICKNAME_CONFLICT' }, 409))
    vi.stubGlobal('fetch', fetch)
    app('/join/special-code')
    await userEvent.type(screen.getByLabelText(/내 닉네임/), '중복닉네임')
    await userEvent.click(screen.getByRole('button', { name: '파티 참여하기' }))
    await screen.findByText(/이미 사용 중/)
    expect(screen.getByLabelText(/내 닉네임/)).toHaveValue('중복닉네임')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      inviteCode: 'special-code',
      nickname: '중복닉네임',
    })
  })
  it('저장된 토큰은 /me로 검증하고 MEMBER는 초대 조회 API를 호출하지 않는다', async () => {
    writeSessions([session])
    const fetch = dashboardFetch()
    vi.stubGlobal('fetch', fetch)
    app('/groups/1')
    await screen.findByRole('heading', { name: '레이드' })
    expect(screen.queryByRole('button', { name: '초대 링크 복사' })).not.toBeInTheDocument()
    expect(fetch.mock.calls.some((c) => c[0].endsWith('/invite'))).toBe(false)
    expect(fetch.mock.calls.some((c) => c[0].endsWith('/members/me'))).toBe(true)
  })
  it('OWNER에게만 초대 복사 기능을 제공한다', async () => {
    writeSessions([session])
    const fetch = dashboardFetch('OWNER')
    vi.stubGlobal('fetch', fetch)
    app('/groups/1')
    await screen.findByRole('button', { name: '초대 링크 복사' })
    expect(fetch.mock.calls.some((c) => c[0].endsWith('/invite'))).toBe(false)
  })
  it('401은 해당 그룹만 제거하고 다른 그룹의 인증은 유지한다', async () => {
    writeSessions([session, { ...session, groupId: 2, revision: 'two' }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 401)))
    app('/groups/1')
    await screen.findByText('그룹 참여가 필요해요')
    expect(readSessions().map((s) => s.groupId)).toEqual([2])
  })
  it('다른 그룹 경로에서는 저장된 타 그룹 토큰을 사용하지 않는다', async () => {
    writeSessions([session])
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    app('/groups/2')
    await screen.findByText('그룹 참여가 필요해요')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('서버가 다른 그룹의 /me를 반환하면 조회를 차단한다', async () => {
    writeSessions([session])
    const fetch = vi.fn().mockResolvedValue(json({ ...me, groupId: 2 }))
    vi.stubGlobal('fetch', fetch)
    app('/groups/1')
    await screen.findByRole('alert')
    expect(fetch).toHaveBeenCalledOnce()
  })
})
describe('일정 UI', () => {
  it('반복 일정 재조회 실패에도 수정 중인 선택을 유지한다', async () => {
    writeSessions([session])
    const fetch = vi
      .fn()
      .mockImplementation(async (url: string) =>
        json(url.endsWith('/members/me') ? me : { slots: [] }),
      )
    vi.stubGlobal('fetch', fetch)
    const { client } = app('/groups/1/schedule/weekly')
    const selected = await screen.findByRole('checkbox', { name: '월요일 19:00~20:00' })
    await userEvent.click(selected)
    fetch.mockRejectedValueOnce(new TypeError('offline'))
    await act(async () => {
      await client.refetchQueries({ queryKey: ['group', 1, 'one', 'weekly'] })
    })
    await screen.findByRole('alert')
    expect(screen.getByRole('checkbox', { name: '월요일 19:00~20:00' })).toBe(selected)
    expect(selected).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(selected).toHaveAttribute('aria-checked', 'true')
  })
  it('탭·키보드 클릭으로 30분 칸을 선택하고 해제한다', async () => {
    function Harness() {
      const [cells, setCells] = useState(Array(48).fill(false))
      return <SlotEditor label="월요일" cells={cells} onChange={setCells} />
    }
    render(<Harness />)
    const first = screen.getByRole('checkbox', { name: '월요일 00:00~01:00' })
    await userEvent.click(first)
    expect(first).toHaveAttribute('aria-checked', 'true')
    first.focus()
    await userEvent.keyboard(' ')
    expect(first).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('checkbox', { name: '월요일 23:00~24:00' }))
    expect(screen.getByRole('checkbox', { name: '월요일 23:00~24:00' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })
  it('인원수와 전원 가능을 표시하고 칸 선택 시 실제 멤버를 보여준다', async () => {
    render(
      <Calendar
        memberId={10}
        members={[{ ...me, role: 'MEMBER', joinedAt: '' }]}
        availability={{
          groupId: 1,
          days: [{ date: '2026-11-09', members: [{ ...me, source: 'OVERRIDE', slots: [] }] }],
        }}
        common={{
          groupId: 1,
          days: [
            {
              date: '2026-11-09',
              totalMembers: 1,
              timeSlots: [
                {
                  startMinute: 0,
                  endMinute: 1440,
                  availableCount: 1,
                  availableMemberIds: [10],
                  allAvailable: true,
                },
              ],
            },
          ],
        }}
        onEdit={vi.fn()}
      />,
    )
    const cell = screen.getByRole('button', {
      name: '2026-11-09 00:00 1/1명 전원 가능, 본인 참여 가능',
    })
    expect(cell).toHaveClass('all')
    expect(screen.getByText(/내 예외 적용/)).toBeInTheDocument()
    await userEvent.click(cell)
    expect(screen.getByRole('dialog')).toHaveTextContent('테스터')
  })
  it('반복 일정 저장 실패 시 수정한 선택을 유지한다', async () => {
    writeSessions([session])
    const fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
      if (url.endsWith('/members/me')) return json(me)
      if (options.method === 'PUT') return json({}, 500)
      return json({ slots: [] })
    })
    vi.stubGlobal('fetch', fetch)
    app('/groups/1/schedule/weekly')
    const cell = await screen.findByRole('checkbox', { name: '월요일 00:00~01:00' })
    await userEvent.click(cell)
    await userEvent.click(screen.getByRole('button', { name: '반복 일정 저장' }))
    await screen.findByRole('alert')
    expect(cell).toHaveAttribute('aria-checked', 'true')
    const put = fetch.mock.calls.find((c) => c[1].method === 'PUT')!
    expect(JSON.parse(put[1].body as string)).toEqual({
      slots: [{ dayOfWeek: 'MONDAY', startMinute: 0, endMinute: 60 }],
    })
    fireEvent.click(screen.getByRole('button', { name: /전체 비우기/ }))
    await waitFor(() => expect(cell).toHaveAttribute('aria-checked', 'false'))
  })
})
