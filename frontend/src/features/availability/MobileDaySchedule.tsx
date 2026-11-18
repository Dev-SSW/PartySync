import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MemberAvailability } from '../../types/api'
import { DAY_LABELS, time, weekdayIndex, type ScheduleDay } from '../../utils/schedule'

const PERIODS = [
  { label: '새벽', from: 0, to: 8 }, { label: '오전', from: 8, to: 12 },
  { label: '오후', from: 12, to: 18 }, { label: '저녁', from: 18, to: 24 },
]
export interface TimeTarget { date: string; hour: number; revision: number }

/** 접기와 추천 이동은 표시만 바꾸고 편집 초안에는 손대지 않는다. */
export function MobileDaySchedule({ day, own, controls, renderCell, target, draft, onEdit }: {
  day: ScheduleDay; own?: MemberAvailability; controls?: ReactNode
  renderCell: (hour: number) => ReactNode; target: TimeTarget | null; draft?: boolean[]
  onEdit: () => void
}) {
  const [expanded, setExpanded] = useState([18])
  const rows = useRef(new Map<number, HTMLDivElement>())
  const lastScroll = useRef<TimeTarget | null>(null)
  useEffect(() => {
    if (target?.date !== day.date) return
    const period = PERIODS.find(period => target.hour >= period.from && target.hour < period.to)!
    setExpanded(current => current.includes(period.from) ? current : [...current, period.from])
  }, [target, day.date])
  useEffect(() => {
    if (!target || target.date !== day.date || lastScroll.current === target) return
    const row = rows.current.get(target.hour)
    if (!row) return
    lastScroll.current = target
    row.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    row.focus({ preventScroll: true })
  }, [target, day.date, expanded])
  return <section className="mobile-day-schedule" aria-label="하루 상세 일정">
    <div className="mobile-day-heading">
      <h3>{day.date.replaceAll('-', '.')} {DAY_LABELS[weekdayIndex(day.date)]}요일</h3>
      <p>{day.hasAll ? '전원 가능 시간 있음' : '전원 가능 시간 없음'} · {own?.slots.length ? '내 일정 있음' : '내 일정 없음'}</p>
      <p className="muted">{own?.source === 'OVERRIDE' ? '날짜별 예외 적용' : '주간 반복 일정 적용'}</p>
    </div>
    {controls}
    <div className="mobile-day-hours time-grid" role="region" aria-label={`${day.date} 하루 시간표`}>
      {PERIODS.map(period => {
        const open = expanded.includes(period.from)
        const selected = draft?.slice(period.from * 2, period.to * 2).some(Boolean)
        return <section className="mobile-period" key={period.from}>
          <button type="button" className="mobile-period-toggle" aria-expanded={open}
            aria-controls={`hours-${day.date}-${period.from}`}
            onClick={() => setExpanded(current => open ? current.filter(from => from !== period.from) : [...current, period.from])}>
            <span>{period.label} <small>{time(period.from * 60)}~{time(period.to * 60)}</small>{selected && <small> · 내 선택 있음</small>}</span>
            <span>{open ? '접기' : '펼치기'}</span>
          </button>
          {open && <div id={`hours-${day.date}-${period.from}`}>
            {Array.from({ length: period.to - period.from }, (_, i) => period.from + i).map(hour =>
              <div className="mobile-hour-row" key={hour} tabIndex={-1}
                ref={node => { if (node) rows.current.set(hour, node); else rows.current.delete(hour) }}>
                <span className="grid-time">{time(hour * 60)}</span>
                <div className="hour-cell" role="group" aria-label={`${day.date} ${time(hour * 60)}~${time((hour + 1) * 60)}`}>{renderCell(hour)}</div>
              </div>)}
          </div>}
        </section>
      })}
    </div>
    <p className="time-range-caption">1시간 전체 가능 인원 · ✓ 내 참여 · ◐ 30분 부분 가능</p>
    <button type="button" className="button full" onClick={onEdit}>이 날짜의 예외 일정 상세</button>
  </section>
}
