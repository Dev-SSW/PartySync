import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Calendar, type CalendarProps } from '../features/availability/Calendar'
import { addDays, emptyCells, monday, seoulToday, setHour, weekDates } from '../utils/schedule'

function viewport(width = 390) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 760px)' && width <= 760,
    addEventListener: vi.fn(), removeEventListener: vi.fn() }))
}
function data(start = monday(seoulToday())): CalendarProps {
  const dates = weekDates(start)
  return {
    memberId: 1, onEdit: vi.fn(), members: [
      { memberId: 1, nickname: '나', role: 'MEMBER', joinedAt: '' },
      { memberId: 2, nickname: '친구', role: 'OWNER', joinedAt: '' },
    ],
    common: { groupId: 1, days: dates.map((date, i) => ({ date, totalMembers: 2,
      timeSlots: [{ startMinute: i === 2 ? 540 : 1140, endMinute: i === 2 ? 600 : 1200,
        availableCount: i === 2 ? 2 : 1, availableMemberIds: i === 2 ? [1, 2] : [1], allAvailable: i === 2 }],
    })) },
    availability: { groupId: 1, days: dates.map(date => ({ date, members: [
      { memberId: 1, nickname: '나', source: 'OVERRIDE', slots: [{ startMinute: 1140, endMinute: 1170 }] },
    ] })) },
  }
}
const pick = (date: string) => within(screen.getByRole('group', { name: '표시 날짜' }))
  .getByRole('button', { name: new RegExp(date) })

describe('모바일 주간 요약과 하루 상세', () => {
  it.each([320, 360, 390, 430, 760])('%ipx에서는 7일 요약과 선택한 하루만 표시한다', width => {
    viewport(width)
    render(<Calendar {...data()} />)
    expect(screen.getByRole('region', { name: '주간 요약' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: '표시 날짜' })).getAllByRole('button')).toHaveLength(7)
    expect(screen.getByRole('region', { name: `${seoulToday()} 하루 시간표` })).toBeInTheDocument()
    expect(pick(seoulToday())).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('region', { name: '주간 가능 시간표' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.mobile-hour-row')).toHaveLength(6)
    expect(screen.queryByText('한눈에 보는 이번 주')).not.toBeInTheDocument()
    const first = within(screen.getByRole('group', { name: '표시 날짜' })).getAllByRole('button')[0]
    expect(first.querySelector('.day-peak')).toHaveTextContent('1/2')
    expect(first).not.toHaveTextContent('최고')
    expect(first).not.toHaveTextContent('전원 가능')
    const detail = screen.getByRole('region', { name: '하루 상세 일정' })
    const recommended = screen.getByRole('region', { name: '이번 주 모이기 좋은 시간' })
    expect(detail.compareDocumentPosition(recommended) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it.each([761, 1440])('%ipx에서는 기존 7일 전체 시간표와 새벽 접기를 유지한다', width => {
    viewport(width)
    render(<Calendar {...data()} />)
    expect(screen.queryByRole('region', { name: '주간 요약' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '주간 가능 시간표' }).querySelectorAll('.grid-heading')).toHaveLength(7)
    expect(document.querySelectorAll('.hour-cell')).toHaveLength(7 * 18)
    expect(screen.getByRole('button', { name: /새벽 시간대 펼치기/ })).toBeInTheDocument()
  })
  it('추천은 해당 날짜의 접힌 구간을 펼치고 시간 행으로 이동한다', async () => {
    viewport()
    const props = data(), date = props.common.days[2].date
    render(<Calendar {...props} />)
    const recommendations = screen.getByRole('region', { name: '이번 주 모이기 좋은 시간' })
    await userEvent.click(within(recommendations).getAllByRole('button')[0])
    expect(pick(date)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /오전 08:00~12:00/ })).toHaveAttribute('aria-expanded', 'true')
    const hour = screen.getByRole('button', { name: new RegExp(`${date} 09:00 2/2명`) })
    expect(hour.closest('.mobile-hour-row')).toHaveFocus()
    await userEvent.click(hour)
    expect(screen.getByRole('dialog')).toHaveTextContent('09:00~09:30 · 2/2명')
    expect(screen.getByRole('dialog')).toHaveTextContent('친구')
  })
  it('날짜·주 이동과 응답 순서 변경에도 올바른 날짜를 고른다', async () => {
    viewport()
    const props = data(), date = props.common.days[5].date
    const { rerender } = render(<Calendar {...props} />)
    await userEvent.click(pick(date))
    expect(screen.getByRole('region', { name: `${date} 하루 시간표` })).toBeInTheDocument()
    expect(screen.getByText('날짜별 예외 적용')).toBeInTheDocument()
    rerender(<Calendar {...props} common={{ ...props.common, days: [...props.common.days].reverse() }} />)
    expect(pick(date)).toHaveAttribute('aria-pressed', 'true')
    const next = data(addDays(props.common.days[0].date, 7))
    rerender(<Calendar {...next} />)
    expect(pick(next.common.days[0].date)).toHaveAttribute('aria-pressed', 'true')
    rerender(<Calendar {...props} />)
    expect(pick(seoulToday())).toHaveAttribute('aria-pressed', 'true')
  })
  it('새벽 추천과 연말 주간도 날짜·시간을 정확히 표시한다', async () => {
    viewport()
    const props = data('2026-12-28'), day = props.common.days[4]
    day.timeSlots = [{ startMinute: 180, endMinute: 240, availableCount: 2, availableMemberIds: [1, 2], allAvailable: true }]
    props.common.days[2].timeSlots = []
    render(<Calendar {...props} />)
    await userEvent.click(within(screen.getByRole('region', { name: '이번 주 모이기 좋은 시간' })).getAllByRole('button')[0])
    expect(screen.getByRole('heading', { name: '2027.01.01 금요일' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2027-01-01 03:00 2\/2명/ })).toBeInTheDocument()
  })
  it('추천이 없으면 빈 카드 대신 안내를 표시한다', () => {
    viewport()
    const props = data()
    props.common.days.forEach(day => { day.timeSlots = [] })
    render(<Calendar {...props} />)
    expect(screen.getByText('아직 추천할 만한 시간이 없습니다.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '이번 주 모이기 좋은 시간' })).queryAllByRole('button')).toHaveLength(0)
  })
  it('터치 스크롤·취소는 수정하지 않고 탭과 구간 접기는 초안을 보존한다', async () => {
    viewport()
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      pointerType: string
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType || 'touch' }
    })
    const props = data()
    function Harness() {
      const [cells, setCells] = useState(() => { const cells = emptyCells(); cells[38] = true; return cells })
      return <Calendar {...props} editing={{ scope: 'date', cells: () => cells,
        set: (_date, _col, hour, value) => setCells(current => setHour(current, hour, value)), start: vi.fn(), end: vi.fn() }} />
    }
    render(<Harness />)
    const cell = screen.getByRole('checkbox', { name: new RegExp(`${seoulToday()} 20:00`) })
    fireEvent.pointerDown(cell, { pointerType: 'touch', clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerMove(cell, { pointerType: 'touch', clientX: 10, clientY: 50 })
    fireEvent.click(cell, { detail: 1 })
    expect(cell).toHaveAttribute('aria-checked', 'false')
    fireEvent.pointerDown(cell, { pointerType: 'touch', clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerCancel(cell)
    fireEvent.click(cell, { detail: 1 })
    expect(cell).toHaveAttribute('aria-checked', 'false')
    fireEvent.pointerDown(cell, { pointerType: 'touch', button: 0 })
    fireEvent.pointerUp(cell, { pointerType: 'touch' })
    fireEvent.click(cell, { detail: 1 })
    expect(cell).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('button', { name: /저녁 18:00~24:00/ }))
    await userEvent.click(screen.getByRole('button', { name: /저녁 18:00~24:00/ }))
    expect(screen.getByRole('checkbox', { name: new RegExp(`${seoulToday()} 20:00`) })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: new RegExp(`${seoulToday()} 19:00`) })).toHaveAttribute('aria-checked', 'mixed')
  })
})
