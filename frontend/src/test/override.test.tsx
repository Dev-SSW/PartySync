import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../features/member/Auth'
import { writeSessions } from '../features/member/storage'
import { OverrideEditor } from '../features/availability/OverrideEditor'
import type { Slot } from '../types/api'

function setup(override: Slot[] | null, fail = false) {
  writeSessions([{ groupId: 1, token: 'A'.repeat(43), name: '테스트', revision: 'one' }])
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
  const fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
    if (url.endsWith('/members/me'))
      return json({ memberId: 1, groupId: 1, nickname: '나', role: 'MEMBER' })
    if (options.method === 'PUT')
      return json(
        fail ? {} : { date: '2026-11-16', slots: JSON.parse(options.body as string).slots },
        fail ? 500 : 200,
      )
    if (options.method === 'DELETE') return new Response(null, { status: 204 })
    return json(override === null ? [] : [{ date: '2026-11-16', slots: override }])
  })
  vi.stubGlobal('fetch', fetch)
  const close = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(
    [
      {
        path: '/groups/:groupId',
        element: (
          <OverrideEditor
            date="2026-11-16"
            current={{
              memberId: 1,
              nickname: '나',
              source: override === null ? 'WEEKLY' : 'OVERRIDE',
              slots: [{ startMinute: 1140, endMinute: 1200 }],
            }}
            onClose={close}
          />
        ),
      },
    ],
    { initialEntries: ['/groups/1'] },
  )
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { fetch, close, client }
}
describe('날짜별 예외와 반복 일정의 구분', () => {
  it('예외 재조회 실패에도 선택한 초안을 유지하고 재시도할 수 있다', async () => {
    const { fetch, client } = setup([])
    const selected = await screen.findByRole('checkbox', { name: '2026-11-16 19:00~20:00' })
    await userEvent.click(selected)
    fetch.mockResolvedValueOnce(new Response('{}', { status: 503 }))
    await act(async () => {
      await client.refetchQueries({ queryKey: ['group', 1, 'one', 'overrides'] })
    })
    await screen.findByRole('alert')
    expect(screen.getByRole('checkbox', { name: '2026-11-16 19:00~20:00' })).toBe(selected)
    expect(selected).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(selected).toHaveAttribute('aria-checked', 'true')
  })
  it('예외가 없으면 반복 일정으로 시작하고 빈 예외를 PUT으로 저장한다', async () => {
    const { fetch, close } = setup(null)
    await screen.findByText('기본 반복 일정 적용 중')
    expect(screen.getByRole('checkbox', { name: '2026-11-16 19:00~20:00' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('button', { name: '예외 삭제 · 반복 일정 복원' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '하루 전체 불가능 선택' }))
    await userEvent.click(screen.getByRole('button', { name: '이 날짜의 예외 저장' }))
    await waitFor(() => expect(close).toHaveBeenCalled())
    const put = fetch.mock.calls.find((c) => c[1].method === 'PUT')!
    expect(JSON.parse(put[1].body)).toEqual({ slots: [] })
    expect(fetch.mock.calls.some((c) => c[1].method === 'DELETE')).toBe(false)
  })
  it('이미 존재하는 빈 예외를 불가능으로 표시하고 복원은 DELETE를 호출한다', async () => {
    const { fetch, close } = setup([])
    await screen.findByText('이 날짜는 하루 전체 참여 불가능합니다.')
    expect(screen.getByRole('checkbox', { name: '2026-11-16 19:00~20:00' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await userEvent.click(screen.getByRole('button', { name: '예외 삭제 · 반복 일정 복원' }))
    await waitFor(() => expect(close).toHaveBeenCalled())
    expect(fetch.mock.calls.some((c) => c[1].method === 'DELETE')).toBe(true)
    expect(fetch.mock.calls.some((c) => c[1].method === 'PUT')).toBe(false)
  })
  it('저장 실패 시 초안을 유지하며 Escape로 닫을 때도 확인한다', async () => {
    const { close } = setup([], true)
    const cell = await screen.findByRole('checkbox', { name: '2026-11-16 23:00~24:00' })
    await userEvent.click(cell)
    await userEvent.click(screen.getByRole('button', { name: '이 날짜의 예외 저장' }))
    await screen.findByRole('alert')
    expect(cell).toHaveAttribute('aria-checked', 'true')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    cell.focus()
    await userEvent.keyboard('{Escape}')
    expect(confirm).toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})
