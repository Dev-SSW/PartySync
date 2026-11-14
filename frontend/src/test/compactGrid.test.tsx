import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SlotEditor, WeeklySlotEditor } from '../components/SlotEditor'
import { emptyCells } from '../utils/schedule'

function Harness({ night = false }: { night?: boolean }) {
  const [cells, setCells] = useState(() => {
    const initial = emptyCells()
    initial[4] = night
    return initial
  })
  return <SlotEditor label="월요일" cells={cells} onChange={setCells} />
}
const slot = (label: string) => screen.getByRole('checkbox', { name: `월요일 ${label}` })
describe('압축형 시간 선택', () => {
  it('한 행에는 한 시간 셀만 표시하고 시간별로 독립 토글한다', async () => {
    render(<Harness />)
    const row = screen.getByRole('group', { name: '월요일 19:00~20:00' })
    expect(within(row).getAllByRole('checkbox')).toHaveLength(1)
    await userEvent.click(slot('19:00~20:00'))
    expect(slot('19:00~20:00')).toHaveAttribute('aria-checked', 'true')
    expect(slot('20:00~21:00')).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(slot('20:00~21:00'))
    await userEvent.click(slot('19:00~20:00'))
    expect(slot('19:00~20:00')).toHaveAttribute('aria-checked', 'false')
    expect(slot('20:00~21:00')).toHaveAttribute('aria-checked', 'true')
  })
  it('새벽 6개 행만 기본 접기하며 자정과 24시 경계는 그대로 유지한다', async () => {
    render(<Harness night />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(18)
    expect(screen.queryByRole('checkbox', { name: '월요일 02:00~03:00' })).toBeNull()
    expect(slot('00:00~01:00')).toBeInTheDocument()
    expect(slot('01:00~02:00')).toBeInTheDocument()
    expect(slot('08:00~09:00')).toBeInTheDocument()
    expect(slot('23:00~24:00')).toBeInTheDocument()
    expect(screen.getByText(/선택 있음/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /새벽 시간대 펼치기/ }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(24)
    expect(slot('02:00~03:00')).toHaveAttribute('aria-checked', 'mixed')
    expect(slot('07:00~08:00')).toBeInTheDocument()
    await userEvent.click(slot('03:00~04:00'))
    await userEvent.click(screen.getByRole('button', { name: /새벽 시간대 접기/ }))
    await userEvent.click(screen.getByRole('button', { name: /새벽 시간대 펼치기/ }))
    expect(slot('03:00~04:00')).toHaveAttribute('aria-checked', 'true')
  })
  it('드래그 방향을 고정하고 다시 지난 칸을 중복 반전하지 않는다', () => {
    vi.stubGlobal(
      'PointerEvent',
      class extends MouseEvent {
        pointerType = 'mouse'
      },
    )
    render(<Harness />)
    const left = slot('19:00~20:00'),
      right = slot('20:00~21:00')
    fireEvent.pointerDown(left, { button: 0, buttons: 1 })
    fireEvent.pointerOver(right, { buttons: 1 })
    fireEvent.pointerOver(left, { buttons: 1 })
    fireEvent.pointerUp(window)
    expect(left).toHaveAttribute('aria-checked', 'true')
    expect(right).toHaveAttribute('aria-checked', 'true')
    fireEvent.pointerDown(left, { button: 0, buttons: 1 })
    fireEvent.pointerOver(right, { buttons: 1 })
    fireEvent.pointerOver(left, { buttons: 1 })
    fireEvent.pointerUp(window)
    expect(left).toHaveAttribute('aria-checked', 'false')
    expect(right).toHaveAttribute('aria-checked', 'false')
  })
  it('반복 일정 편집도 일곱 요일에 같은 1시간 시간축을 사용한다', () => {
    render(<WeeklySlotEditor cells={Array.from({ length: 7 }, emptyCells)} onChange={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(7 * 18)
    expect(screen.getByRole('group', { name: '일요일 23:00~24:00' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '표시 시간대' })).toBeNull()
  })
})
