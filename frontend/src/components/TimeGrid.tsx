import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { time } from '../utils/schedule'

export interface TimeColumn {
  id: string
  label: string
  header?: ReactNode
}

/** 한 시간 행을 하나의 셀로 표시합니다. 접기는 표시만 바꿉니다. */
export function TimeGrid({
  columns,
  renderCell,
  label,
  hiddenNote,
}: {
  columns: TimeColumn[]
  renderCell: (column: number, slot: number) => ReactNode
  label: string
  hiddenNote?: (column: number) => string | undefined
}) {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState(0)
  const [mobile, setMobile] = useState(
    () => window.matchMedia?.('(max-width: 760px)').matches ?? false,
  )
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 760px)')
    if (!query) return
    const change = () => setMobile(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  const visible = columns
    .map((column, index) => ({ column, index }))
    .filter(({ index }) => !mobile || index === Math.min(selected, columns.length - 1))
  const hours = Array.from({ length: 24 }, (_, hour) => hour).filter(
    (hour) => expanded || hour < 2 || hour >= 8,
  )
  const notes = visible.flatMap(({ column, index }) => {
    const text = hiddenNote?.(index)
    return text ? [`${column.label}: ${text}`] : []
  })
  return (
    <div className="time-grid-container">
      {mobile && columns.length > 1 && (
        <div className="mobile-days" role="group" aria-label="표시 요일">
          {columns.map((column, index) => (
            <button
              type="button"
              key={column.id}
              aria-pressed={selected === index}
              onClick={() => setSelected(index)}
            >
              {column.label}
            </button>
          ))}
        </div>
      )}
      <div className="time-grid-scroll" role="region" aria-label={label} tabIndex={0}>
        <div
          className="time-grid"
          style={{
            gridTemplateColumns: `52px repeat(${Math.max(visible.length, 1)}, minmax(0,1fr))`,
          }}
        >
          <div className="grid-corner">KST</div>
          {visible.map(({ column }) => (
            <div className="grid-heading" key={column.id}>
              {column.header || column.label}
            </div>
          ))}
          {hours.map((hour) => (
            <Fragment key={hour}>
              {hour === (expanded ? 2 : 8) && (
                <div className="night-fold">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded ? '새벽 시간대 접기' : '새벽 시간대 펼치기'} <span>02:00–08:00</span>
                  </button>
                  {!expanded && notes.length > 0 && (
                    <span className="night-notes" title={notes.join(' · ')}>
                      {notes.join(' · ')}
                    </span>
                  )}
                </div>
              )}
              <div className="grid-time" data-hour={hour}>
                {time(hour * 60)}
              </div>
              {visible.map(({ column, index }) => (
                <div
                  className="hour-cell"
                  key={column.id}
                  role="group"
                  aria-label={`${column.label} ${time(hour * 60)}~${time((hour + 1) * 60)}`}
                  data-hour={hour}
                >
                  {renderCell(index, hour)}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      <p className="time-range-caption">
        1시간 단위 선택 · ◐ 기존 30분 부분 가능 · 수정하지 않은 시간은 유지됩니다.
      </p>
    </div>
  )
}
