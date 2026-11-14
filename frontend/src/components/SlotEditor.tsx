import { useRef } from 'react'
import { useSlotDrag } from '../hooks/useSlotDrag'
import { TimeGrid } from './TimeGrid'
import { DAY_LABELS, hourState, setHour, time } from '../utils/schedule'

export function SlotEditor({
  cells,
  onChange,
  label,
  disabled = false,
}: {
  cells: boolean[]
  onChange: (cells: boolean[]) => void
  label: string
  disabled?: boolean
}) {
  return (
    <SelectionGrid
      days={[cells]}
      labels={[label]}
      onChange={(next) => onChange(next[0])}
      disabled={disabled}
    />
  )
}
export function WeeklySlotEditor({
  cells,
  onChange,
  disabled = false,
}: {
  cells: boolean[][]
  onChange: (cells: boolean[][]) => void
  disabled?: boolean
}) {
  return (
    <SelectionGrid
      days={cells}
      labels={DAY_LABELS.map((day) => `${day}요일`)}
      onChange={onChange}
      disabled={disabled}
    />
  )
}
function SelectionGrid({
  days,
  labels,
  onChange,
  disabled,
}: {
  days: boolean[][]
  labels: string[]
  onChange: (days: boolean[][]) => void
  disabled: boolean
}) {
  const latest = useRef(days)
  latest.current = days
  const bind = useSlotDrag({
    enabled: !disabled,
    get: (col, row) => hourState(latest.current[col], row) === 'full',
    set: (col, row, value) => {
      const next = latest.current.map((day, i) => (i === col ? setHour(day, row, value) : day))
      latest.current = next
      onChange(next)
    },
  })
  return (
    <TimeGrid
      label="가능 시간 선택"
      hiddenNote={(col) => (days[col].slice(4, 16).some(Boolean) ? '선택 있음' : undefined)}
      columns={labels.map((label) => ({ id: label, label }))}
      renderCell={(col, row) => (
        <button
          type="button"
          role="checkbox"
          aria-checked={
            hourState(days[col], row) === 'partial' ? 'mixed' : hourState(days[col], row) === 'full'
          }
          disabled={disabled}
          aria-label={`${labels[col]} ${time(row * 60)}~${time((row + 1) * 60)}`}
          className={`calendar-cell selection-cell ${hourState(days[col], row) === 'full' ? 'selected' : hourState(days[col], row) === 'partial' ? 'partial' : ''}`}
          {...bind(col, row)}
        >
          <span className="my-check" aria-hidden="true">
            {hourState(days[col], row) === 'full'
              ? '✓'
              : hourState(days[col], row) === 'partial'
                ? '◐'
                : ''}
          </span>
          <span>
            {hourState(days[col], row) === 'full'
              ? '가능'
              : hourState(days[col], row) === 'partial'
                ? '부분 가능'
                : '선택'}
          </span>
        </button>
      )}
    />
  )
}
