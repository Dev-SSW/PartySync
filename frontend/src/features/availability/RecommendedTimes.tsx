import { DAY_LABELS, time, weekdayIndex, type RecommendedTime } from '../../utils/schedule'

/** 서버 집계로 계산한 추천만 표시하고 선택한 시간으로 이동한다. */
export function RecommendedTimes({ times, onSelect }: {
  times: RecommendedTime[]; onSelect: (time: RecommendedTime) => void
}) {
  return <section className="recommended-times" aria-label="이번 주 모이기 좋은 시간">
    <h3>이번 주 모이기 좋은 시간 <span className="muted small-text">TOP 3</span></h3>
    {times.length ? <ol>{times.map(slot => <li key={`${slot.date}-${slot.hour}`}>
      <button type="button" onClick={() => onSelect(slot)}>
        <span>{DAY_LABELS[weekdayIndex(slot.date)]} {slot.date.slice(5).replace('-', '.')}<strong>{time(slot.hour * 60)}~{time((slot.hour + 1) * 60)}</strong></span>
        <span className={slot.all ? 'recommendation-all' : ''}>{slot.count}/{slot.total}</span>
      </button>
    </li>)}</ol> : <p className="muted">아직 추천할 만한 시간이 없습니다.</p>}
  </section>
}
