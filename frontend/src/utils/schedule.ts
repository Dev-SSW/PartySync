import { DAYS, type CountedSlot, type Slot, type WeeklySlot } from '../types/api'

export const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']
export const time = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
export const seoulToday = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

// 날짜 전용 값은 UTC로 산술 연산해 브라우저 타임존의 날짜 이동을 방지합니다.
export function addDays(date: string, amount: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + amount)
  return d.toISOString().slice(0, 10)
}
export function monday(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return addDays(date, -((day + 6) % 7))
}
export const weekDates = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i))
export const emptyCells = () => Array<boolean>(48).fill(false)
export function hourState(cells: boolean[], hour: number): 'full' | 'partial' | 'none' {
  const left = !!cells[hour * 2],
    right = !!cells[hour * 2 + 1]
  return left && right ? 'full' : left || right ? 'partial' : 'none'
}
/** 수정한 시간의 두 30분만 바꾸며 기존의 부분 가능 시간은 그대로 보존합니다. */
export function setHour(cells: boolean[], hour: number, selected: boolean): boolean[] {
  return cells.map((value, index) => (Math.floor(index / 2) === hour ? selected : value))
}
/** 서버가 계산한 두 구간을 한 시간 표시로 투영합니다. 일부만 가능한 사람은 전체 인원에서 제외합니다. */
export function summarizeHour(
  slots: ReturnType<typeof expandCommon>,
  hour: number,
  totalMembers: number,
) {
  const first = slots[hour * 2],
    second = slots[hour * 2 + 1]
  const ids = (first?.availableMemberIds || []).filter((id) =>
    second?.availableMemberIds.includes(id),
  )
  const partialIds = [
    ...new Set([...(first?.availableMemberIds || []), ...(second?.availableMemberIds || [])]),
  ].filter((id) => !ids.includes(id))
  return {
    ids,
    partialIds,
    count: ids.length,
    all: totalMembers > 0 && !!first?.allAvailable && !!second?.allAvailable,
    halves: [first, second],
  }
}
export const slotsToCells = (slots: Slot[]) =>
  emptyCells().map((_, i) =>
    slots.some((s) => s.startMinute <= i * 30 && s.endMinute >= (i + 1) * 30),
  )
export function cellsToSlots(cells: boolean[]): Slot[] {
  const result: Slot[] = []
  for (let i = 0; i < 48; i++) {
    if (!cells[i]) continue
    const startMinute = i * 30
    while (i + 1 < 48 && cells[i + 1]) i++
    result.push({ startMinute, endMinute: (i + 1) * 30 })
  }
  return result
}
export const weeklyToCells = (slots: WeeklySlot[]) =>
  DAYS.map((day) => slotsToCells(slots.filter((s) => s.dayOfWeek === day)))
export const cellsToWeekly = (days: boolean[][]): WeeklySlot[] =>
  days.flatMap((cells, i) => cellsToSlots(cells).map((slot) => ({ dayOfWeek: DAYS[i], ...slot })))

// 서버가 계산한 인원/멤버 구간을 UI 셀로 펼칠 뿐, 교집합을 다시 계산하지 않습니다.
export const expandCommon = (slots: CountedSlot[]) =>
  Array.from({ length: 48 }, (_, i) =>
    slots.find((s) => s.startMinute <= i * 30 && s.endMinute >= (i + 1) * 30),
  )
