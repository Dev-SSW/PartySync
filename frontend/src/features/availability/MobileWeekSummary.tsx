import { DAY_LABELS, weekdayIndex, type ScheduleDay } from '../../utils/schedule'

/** 날짜별 최고 인원을 비율로 표시하고 상세 의미는 접근성 설명에 남긴다. */
export function MobileWeekSummary({ days, selected, onSelect }: {
  days: ScheduleDay[]; selected: string; onSelect: (date: string) => void
}) {
  return <section className="mobile-week-summary" aria-label="주간 요약">
    <div className="mobile-week-days" role="group" aria-label="표시 날짜">
      {days.map(day => <button key={day.date} type="button" aria-pressed={day.date === selected}
        className={day.hasAll ? 'all' : day.peak || day.hasPartial ? 'some' : 'none'}
        aria-label={`${DAY_LABELS[weekdayIndex(day.date)]} ${day.date}, 1시간 전체 가능 최고 ${day.peak}/${day.totalMembers}명${day.hasAll ? ', 전원 가능 시간 있음' : ''}${day.hasPartial ? ', 30분 부분 가능 있음' : ''}`}
        onClick={() => onSelect(day.date)}>
        <span>{DAY_LABELS[weekdayIndex(day.date)]}</span><strong>{Number(day.date.slice(8))}일</strong>
        <span className="day-peak">{day.peak}/{day.totalMembers}</span>
      </button>)}
    </div>
  </section>
}
