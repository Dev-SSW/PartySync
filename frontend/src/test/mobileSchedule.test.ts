import { recommendTimes, summarizeWeek, weekdayIndex } from '../utils/schedule'
import type { CommonDay } from '../types/api'

const day = (date: string, total: number, ids: number[], hour = 19, all = ids.length === total): CommonDay => ({
  date, totalMembers: total, timeSlots: [{ startMinute: hour * 60, endMinute: (hour + 1) * 60,
    availableMemberIds: ids, availableCount: ids.length, allAvailable: all }],
})
describe('주간 요약과 추천 시간 계산', () => {
  it('전체 인원, 전원 가능, 날짜와 시작 시간 순으로 TOP 3을 고른다', () => {
    const days = summarizeWeek({ groupId: 1, days: [
      day('2026-11-22', 4, [1, 2, 3, 4]), day('2026-11-21', 4, [1, 2, 3]),
      day('2026-11-20', 3, [1, 2, 3], 20), day('2026-11-19', 3, [1, 2, 3], 21),
      day('2026-11-18', 0, []), day('2026-11-17', 4, [1]),
    ] })
    expect(recommendTimes(days).map(slot => [slot.date, slot.hour, slot.count])).toEqual([
      ['2026-11-22', 19, 4], ['2026-11-19', 21, 3], ['2026-11-20', 20, 3],
    ])
    expect(days[0].date).toBe('2026-11-17')
  })
  it('서로 다른 30분 참여자는 1시간 전체 인원으로 합산하지 않는다', () => {
    const partial = day('2026-11-16', 2, [])
    partial.timeSlots = [
      { startMinute: 1140, endMinute: 1170, availableCount: 1, availableMemberIds: [1], allAvailable: false },
      { startMinute: 1170, endMinute: 1200, availableCount: 1, availableMemberIds: [2], allAvailable: false },
    ]
    const days = summarizeWeek({ groupId: 1, days: [partial] })
    expect(days[0]).toMatchObject({ peak: 0, hasAll: false, hasPartial: true })
    expect(days[0].hours[19].partialIds).toEqual([1, 2])
    expect(recommendTimes(days)).toEqual([])
  })
  it('동일 날짜와 시간은 중복 추천하지 않고 시간 순서를 유지한다', () => {
    const same = day('2026-11-16', 1, [1], 18)
    same.timeSlots.push({ ...same.timeSlots[0], startMinute: 19 * 60, endMinute: 20 * 60 })
    const times = recommendTimes(summarizeWeek({ groupId: 1, days: [same, same] }))
    expect(times.map(slot => slot.hour)).toEqual([18, 19])
  })
  it('0명은 추천하지 않으며 1명 그룹의 실제 전원 가능은 유지한다', () => {
    expect(recommendTimes(summarizeWeek({ groupId: 1, days: [day('2026-11-16', 0, [])] }))).toEqual([])
    expect(recommendTimes(summarizeWeek({ groupId: 1, days: [day('2026-11-16', 1, [8])] }))[0]).toMatchObject({ count: 1, total: 1, all: true })
  })
  it('연말·연초 날짜의 실제 요일을 구한다', () => {
    expect(weekdayIndex('2026-12-31')).toBe(3)
    expect(weekdayIndex('2027-01-01')).toBe(4)
    expect(weekdayIndex('2027-01-04')).toBe(0)
  })
})
