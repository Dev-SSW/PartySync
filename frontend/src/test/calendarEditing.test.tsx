import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../App'
import { AuthProvider } from '../features/member/Auth'
import { writeSessions } from '../features/member/storage'
import { monday, seoulToday, slotsToCells, weekDates } from '../utils/schedule'
import { DAYS, type Slot, type WeeklySlot } from '../types/api'

function setup({
  fail = false,
  mobile = false,
  override,
}: { fail?: boolean; mobile?: boolean; override?: Slot[] } = {}) {
  if (mobile)
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  const dates = weekDates(monday(seoulToday()))
  let weekly: WeeklySlot[] = [
    { dayOfWeek: 'MONDAY', startMinute: 0, endMinute: 60 },
    { dayOfWeek: 'MONDAY', startMinute: 1140, endMinute: 1200 },
    { dayOfWeek: 'TUESDAY', startMinute: 1200, endMinute: 1260 },
  ]
  const overrides = new Map<string, Slot[]>()
  if (override !== undefined) overrides.set(dates[0], override)
  const members = [
    { memberId: 10, nickname: '나', role: 'MEMBER', joinedAt: '' },
    { memberId: 99, nickname: '다른멤버', role: 'OWNER', joinedAt: '' },
  ]
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
  let shouldFail = fail
  const fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
    if (url.endsWith('/members/me')) return json({ ...members[0], groupId: 1 })
    if (url.endsWith('/members')) return json(members)
    if (options.method === 'PUT') {
      if (shouldFail) {
        shouldFail = false
        return json({}, 500)
      }
      const data = JSON.parse(options.body as string)
      if (url.endsWith('/weekly-availability')) {
        weekly = data.slots
        return json(data)
      }
      const date = url.split('/').at(-1)!
      overrides.set(date, data.slots)
      return json({ date, slots: data.slots })
    }
    if (options.method === 'DELETE') {
      overrides.delete(url.split('/').at(-1)!)
      return new Response(null, { status: 204 })
    }
    if (url.endsWith('/weekly-availability')) return json({ slots: weekly })
    if (url.includes('/availability-overrides?'))
      return json([...overrides].map(([date, slots]) => ({ date, slots })))
    const days = dates.map((date, col) => ({
      date,
      members: [
        {
          ...members[0],
          source: overrides.has(date) ? 'OVERRIDE' : 'WEEKLY',
          slots: overrides.get(date) ?? weekly.filter((s) => s.dayOfWeek === DAYS[col]),
        },
        {
          ...members[1],
          source: 'WEEKLY',
          slots: col === 0 ? [{ startMinute: 1140, endMinute: 1260 }] : [],
        },
      ],
    }))
    if (url.includes('/common-availability?'))
      return json({
        groupId: 1,
        days: days.map((day) => ({
          date: day.date,
          totalMembers: 2,
          timeSlots: Array.from({ length: 48 }, (_, row) => {
            const ids = day.members.filter((m) => slotsToCells(m.slots)[row]).map((m) => m.memberId)
            return {
              startMinute: row * 30,
              endMinute: (row + 1) * 30,
              availableCount: ids.length,
              availableMemberIds: ids,
              allAvailable: ids.length === 2,
            }
          }),
        })),
      })
    if (url.includes('/availability?')) return json({ groupId: 1, days })
    return json({
      groupId: 1,
      name: '편집 테스트 파티',
      memberCount: 2,
      description: '',
      createdAt: '',
    })
  })
  vi.stubGlobal('fetch', fetch)
  writeSessions([{ groupId: 1, name: '편집 테스트 파티', token: 'A'.repeat(43), revision: 'edit' }])
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(routes, { initialEntries: ['/groups/1'] })
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  const writes = () =>
    fetch.mock.calls.filter((c) => c[1].method === 'PUT' || c[1].method === 'DELETE')
  return { dates, fetch, writes, overrides, router, client }
}
const cell = (date: string, clock: string) =>
  screen.getByRole('checkbox', { name: new RegExp(`${date} ${clock} `) })
describe('캘린더 조회와 본인 식별', () => {
  it('기존 30분 가능은 전체 체크 없이 부분 표시하고 반시간별 실제 인원을 보여준다', async () => {
    const { dates, writes } = setup({ override: [{ startMinute: 1140, endMinute: 1170 }] })
    const partial = await screen.findByRole('button', {
      name: new RegExp(`${dates[0]} 19:00 1/2명, 본인 참여 일부 가능`),
    })
    expect(partial).not.toHaveTextContent('✓')
    expect(partial).toHaveTextContent('◐')
    expect(writes()).toHaveLength(0)
    await userEvent.click(partial)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('19:00~19:30 · 2/2명')
    expect(dialog).toHaveTextContent('19:30~20:00 · 1/2명')
  })
  it('접힌 새벽은 내 일정만 안내하고 시간별 인원을 합산하지 않는다', async () => {
    const { dates } = setup({ override: [{ startMinute: 180, endMinute: 210 }] })
    await screen.findByRole('button', { name: /새벽 시간대 펼치기/ })
    expect(screen.getByText(/내 일정 있음/)).toBeInTheDocument()
    expect(document.querySelector('.night-fold')).not.toHaveTextContent(/\d+\/\d+/)
    expect(screen.queryByRole('button', { name: new RegExp(`${dates[0]} 03:00 `) })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /새벽 시간대 펼치기/ }))
    expect(
      screen.getByRole('button', {
        name: new RegExp(`${dates[0]} 03:00 0/2명, 본인 참여 일부 가능`),
      }),
    ).toHaveTextContent('◐')
    expect(
      screen.getByRole('button', { name: new RegExp(`${dates[0]} 00:00 0/2명, 본인 참여 불가능`) }),
    ).toBeInTheDocument()
  })
  it('기본 18개 시간 행과 한 개의 시간 셀을 표시하고 새벽을 펼치면 24행이다', async () => {
    const { dates } = setup()
    await screen.findByRole('heading', { name: '편집 테스트 파티' })
    const grid = await screen.findByRole('region', { name: '주간 가능 시간표' })
    expect(grid.querySelectorAll('.grid-time')).toHaveLength(18)
    expect(
      screen.getByRole('button', {
        name: new RegExp(`${dates[0]} 19:00 2/2명 전원 가능, 본인 참여 가능`),
      }),
    ).toHaveTextContent('✓')
    const onlyOther = screen.getByRole('button', {
      name: new RegExp(`${dates[0]} 20:00 1/2명, 본인 참여 불가능`),
    })
    expect(onlyOther).not.toHaveTextContent('✓')
    expect(
      screen.getByRole('button', { name: new RegExp(`${dates[1]} 19:00 0/2명`) }),
    ).toHaveTextContent('0/2')
    await userEvent.click(screen.getByRole('button', { name: /새벽 시간대 펼치기/ }))
    expect(grid.querySelectorAll('.grid-time')).toHaveLength(24)
    await userEvent.click(screen.getByRole('button', { name: /새벽 시간대 접기/ }))
    expect(grid.querySelectorAll('.grid-time')).toHaveLength(18)
  })
  it('빈 Override는 반복 가능 시간을 무시하고 체크를 지운다', async () => {
    const { dates } = setup({ override: [] })
    const button = await screen.findByRole('button', {
      name: new RegExp(`${dates[0]} 19:00 1/2명, 본인 참여 불가능`),
    })
    expect(button).not.toHaveTextContent('✓')
    expect(screen.getByText('내 예외 적용')).toBeInTheDocument()
  })
  it('모바일은 하루만 표시하고 요일 탭으로 전환한다', async () => {
    const { dates } = setup({ mobile: true })
    await screen.findByRole('region', { name: '주간 가능 시간표' })
    expect(screen.getAllByRole('button', { name: new RegExp(`${dates[0]} 19:00`) })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: new RegExp(`${dates[1]} 19:00`) })).toBeNull()
    await userEvent.click(
      within(screen.getByRole('group', { name: '표시 요일' })).getByRole('button', { name: /^화/ }),
    )
    expect(
      screen.getByRole('button', { name: new RegExp(`${dates[1]} 19:00`) }),
    ).toBeInTheDocument()
  })
})
describe('메인 화면 자동 저장', () => {
  it('부분 가능 시간을 수정하면 한 시간 전체로 바꾸고 다른 기존 30분 구간은 유지한다', async () => {
    const { dates, writes } = setup({
      override: [
        { startMinute: 30, endMinute: 60 },
        { startMinute: 210, endMinute: 240 },
        { startMinute: 1140, endMinute: 1170 },
      ],
    })
    await screen.findByRole('button', { name: '내 일정 수정' })
    await userEvent.click(screen.getByRole('button', { name: '내 일정 수정' }))
    const partial = await screen.findByRole('checkbox', { name: new RegExp(`${dates[0]} 19:00`) })
    expect(partial).toHaveAttribute('aria-checked', 'mixed')
    await userEvent.click(partial)
    await screen.findByText('저장 완료')
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      slots: [
        { startMinute: 30, endMinute: 60 },
        { startMinute: 210, endMinute: 240 },
        { startMinute: 1140, endMinute: 1200 },
      ],
    })
  })
  it('빠른 연속 클릭은 PUT 1회와 그룹 GET 2회로 묶고 반복 일정 추가 조회는 하지 않는다', async () => {
    const { dates, fetch, writes } = setup()
    await screen.findByRole('button', { name: '내 일정 수정' })
    await userEvent.click(screen.getByRole('button', { name: '내 일정 수정' }))
    await screen.findByRole('checkbox', { name: new RegExp(`${dates[0]} 19:00`) })
    const before = fetch.mock.calls.length
    await userEvent.click(cell(dates[0], '20:00'))
    await userEvent.click(cell(dates[0], '21:00'))
    expect(writes()).toHaveLength(0)
    await screen.findByText('저장 완료')
    const calls = fetch.mock.calls.slice(before)
    expect(calls.filter((call) => call[1].method === 'PUT')).toHaveLength(1)
    expect(calls.filter((call) => call[1].method === 'GET')).toHaveLength(2)
    expect(calls.some((call) => call[0].endsWith('/weekly-availability'))).toBe(false)
  })
  it('원래 선택으로 돌아오면 PUT과 그룹 재조회를 생략한다', async () => {
    const { dates, fetch, writes } = setup()
    await screen.findByRole('button', { name: '내 일정 수정' })
    await userEvent.click(screen.getByRole('button', { name: '내 일정 수정' }))
    await screen.findByRole('checkbox', { name: new RegExp(`${dates[0]} 19:00`) })
    const before = fetch.mock.calls.length
    await userEvent.click(cell(dates[0], '20:00'))
    await userEvent.click(cell(dates[0], '20:00'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 850))
    })
    expect(writes()).toHaveLength(0)
    expect(fetch.mock.calls).toHaveLength(before)
  })
  it.each(['me', 'members', 'details', 'availability', 'common'])(
    '%s 재조회 실패에도 미저장 초안을 유지한다',
    async (key) => {
      const { dates, fetch, writes, client } = setup({ fail: true })
      await screen.findByRole('button', { name: '내 일정 수정' })
      await userEvent.click(screen.getByRole('button', { name: '내 일정 수정' }))
      await screen.findByRole('checkbox', { name: new RegExp(`${dates[0]} 19:00`) })
      const selected = cell(dates[0], '20:00')
      await userEvent.click(selected)
      await screen.findByText('저장 실패 · 선택은 유지됩니다')
      if (key === 'me') fetch.mockRejectedValueOnce(new TypeError('offline'))
      else fetch.mockResolvedValueOnce(new Response('{}', { status: 503 }))
      await act(async () => {
        await client.refetchQueries({ queryKey: ['group', 1, 'edit', key] })
      })
      await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
      expect(cell(dates[0], '20:00')).toBe(selected)
      expect(selected).toHaveAttribute('aria-checked', 'true')
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
      await act(async () => {
        await client.refetchQueries({ queryKey: ['group', 1, 'edit', key] })
      })
      await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1))
      await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
      await screen.findByText('저장 완료')
      expect(writes()).toHaveLength(2)
      expect(cell(dates[0], '20:00')).toHaveAccessibleName(/본인 참여 가능/)
    },
  )
  it.each(['date', 'weekly'] as const)(
    '%s 드래그 중에는 전송하지 않고 놓은 뒤 시간 셀을 일괄 저장한다',
    async (scope) => {
      vi.stubGlobal(
        'PointerEvent',
        class extends MouseEvent {
          pointerType = 'mouse'
        },
      )
      const { dates, writes } = setup()
      await screen.findByRole('button', { name: '내 일정 수정' })
      await userEvent.click(screen.getByRole('button', { name: '내 일정 수정' }))
      await screen.findByRole('checkbox', { name: new RegExp(`${dates[0]} 19:00`) })
      if (scope === 'weekly')
        await userEvent.selectOptions(screen.getByRole('combobox', { name: '수정 범위' }), 'weekly')
      const left = cell(dates[0], '20:00'),
        right = cell(dates[0], '21:00')
      fireEvent.pointerDown(left, { button: 0, buttons: 1 })
      fireEvent.pointerOver(right, { buttons: 1 })
      fireEvent.pointerOver(left, { buttons: 1 })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 450))
      })
      expect(writes()).toHaveLength(0)
      expect(left).toHaveAttribute('aria-checked', 'true')
      expect(right).toHaveAttribute('aria-checked', 'true')
      fireEvent.pointerUp(window)
      await screen.findByText('저장 완료')
      expect(writes()).toHaveLength(1)
      expect(JSON.parse(writes()[0][1].body).slots).toContainEqual({
        ...(scope === 'weekly' ? { dayOfWeek: 'MONDAY' } : {}),
        startMinute: 1140,
        endMinute: 1320,
      })
      expect(left).toHaveAccessibleName(/2\/2명 전원 가능, 본인 참여 가능/)
    },
  )
  it('여러 셀 변경을 병합하고 보이지 않는 시간 구간도 보존한다', async () => {
    const { dates, writes } = setup()
    await screen.findByRole('button', { name: '내 일정 수정' })
    await userEvent.click(screen.getByRole('button', { name: '내 일정 수정' }))
    await screen.findByRole('checkbox', { name: new RegExp(`${dates[0]} 19:00`) })
    await userEvent.click(cell(dates[0], '20:00'))
    await userEvent.click(cell(dates[0], '21:00'))
    expect(cell(dates[0], '20:00')).toHaveAttribute('aria-checked', 'true')
    await screen.findByText('저장 완료')
    expect(writes()).toHaveLength(1)
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      slots: [
        { startMinute: 0, endMinute: 60 },
        { startMinute: 1140, endMinute: 1320 },
      ],
    })
    expect(cell(dates[0], '20:00')).toHaveAccessibleName(/2\/2명 전원 가능, 본인 참여 가능/)
  })
  it('기존 Override를 기준으로 수정하고 빈 예외도 저장한다', async () => {
    const { dates, writes } = setup({ override: [{ startMinute: 1140, endMinute: 1200 }] })
    await screen.findByRole('button', { name: '내 일정 수정' })
    await userEvent.click(screen.getByRole('button', { name: '내 일정 수정' }))
    await screen.findByRole('checkbox', { name: new RegExp(`${dates[0]} 19:00`) })
    await userEvent.click(cell(dates[0], '19:00'))
    await screen.findByText('저장 완료')
    expect(JSON.parse(writes()[0][1].body)).toEqual({ slots: [] })
    expect(cell(dates[0], '19:00')).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('button', { name: /반복 일정으로 복원/ }))
    await waitFor(() => expect(writes().some((c) => c[1].method === 'DELETE')).toBe(true))
    await waitFor(() => expect(cell(dates[0], '19:00')).toHaveAttribute('aria-checked', 'true'))
  })
  it('반복 원본을 수정하며 다른 요일을 보존하고 예외 우선순위를 안내한다', async () => {
    const { dates, writes } = setup({ override: [] })
    await screen.findByRole('button', { name: '내 일정 수정' })
    await userEvent.click(screen.getByRole('button', { name: '내 일정 수정' }))
    await screen.findByRole('checkbox', { name: new RegExp(`${dates[0]} 19:00`) })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '수정 범위' }), 'weekly')
    expect(cell(dates[0], '19:00')).toHaveAttribute('aria-checked', 'true')
    expect(cell(dates[0], '19:00').querySelector('.my-check')).toHaveTextContent('')
    expect(cell(dates[0], '19:00')).toHaveAttribute(
      'title',
      expect.stringContaining('반복 설정 가능'),
    )
    expect(screen.getByText(/원본 설정을 수정/)).toBeInTheDocument()
    await userEvent.click(cell(dates[0], '20:00'))
    await screen.findByText('저장 완료')
    const body = JSON.parse(writes()[0][1].body)
    expect(body.slots).toContainEqual({ dayOfWeek: 'TUESDAY', startMinute: 1200, endMinute: 1260 })
    expect(body.slots).toContainEqual({ dayOfWeek: 'MONDAY', startMinute: 0, endMinute: 60 })
    expect(writes()[0][0]).toContain('weekly-availability')
    await userEvent.click(screen.getByRole('button', { name: '일정 보기' }))
    expect(
      screen.getByRole('button', { name: new RegExp(`${dates[0]} 19:00 1/2명, 본인 참여 불가능`) }),
    ).not.toHaveTextContent('✓')
  })
  it('저장 실패 시 최신 선택을 유지하고 재시도한다', async () => {
    const { dates, writes } = setup({ fail: true })
    await screen.findByRole('button', { name: '내 일정 수정' })
    await userEvent.click(screen.getByRole('button', { name: '내 일정 수정' }))
    await screen.findByRole('checkbox', { name: new RegExp(`${dates[0]} 19:00`) })
    await userEvent.click(cell(dates[0], '20:00'))
    await screen.findByRole('alert')
    expect(cell(dates[0], '20:00')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: '다음 주' })).toBeDisabled()
    await userEvent.click(cell(dates[0], '21:00'))
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await screen.findByText('저장 완료')
    expect(writes()).toHaveLength(2)
    expect(JSON.parse(writes()[1][1].body).slots).toContainEqual({
      startMinute: 1140,
      endMinute: 1320,
    })
  })
  it('경로 이동은 debounce를 기다리지 않고 저장을 완료한 뒤 진행한다', async () => {
    const { dates, writes, router } = setup()
    await screen.findByRole('button', { name: '내 일정 수정' })
    await userEvent.click(screen.getByRole('button', { name: '내 일정 수정' }))
    await screen.findByRole('checkbox', { name: new RegExp(`${dates[0]} 19:00`) })
    await userEvent.click(cell(dates[0], '20:00'))
    await userEvent.click(screen.getByRole('link', { name: '내 반복 일정 설정' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/1/schedule/weekly'))
    expect(writes()).toHaveLength(1)
  })
})
