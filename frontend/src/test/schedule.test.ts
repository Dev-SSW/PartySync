import { hourState, setHour, summarizeHour } from '../utils/schedule'
import {
  addDays,
  cellsToSlots,
  cellsToWeekly,
  emptyCells,
  expandCommon,
  monday,
  seoulToday,
  slotsToCells,
  time,
  weeklyToCells,
} from '../utils/schedule'

describe('30분 시간 표현과 날짜 경계', () => {
  it('시간 전체와 부분 가능을 구분하고 수정하지 않은 30분 구간을 보존한다', () => {
    const original = slotsToCells([
      { startMinute: 30, endMinute: 60 },
      { startMinute: 1140, endMinute: 1170 },
    ])
    expect(hourState(original, 19)).toBe('partial')
    const edited = setHour(original, 20, true)
    expect(cellsToSlots(edited)).toEqual([
      { startMinute: 30, endMinute: 60 },
      { startMinute: 1140, endMinute: 1170 },
      { startMinute: 1200, endMinute: 1260 },
    ])
    expect(hourState(setHour(edited, 19, true), 19)).toBe('full')
    expect(hourState(setHour(edited, 19, false), 19)).toBe('none')
  })
  it('각 반시간에 다른 사람만 가능하면 한 시간 가능 인원으로 합산하지 않는다', () => {
    const data = expandCommon([
      {
        startMinute: 1140,
        endMinute: 1170,
        availableCount: 1,
        availableMemberIds: [1],
        allAvailable: false,
      },
      {
        startMinute: 1170,
        endMinute: 1200,
        availableCount: 1,
        availableMemberIds: [2],
        allAvailable: false,
      },
    ])
    expect(summarizeHour(data, 19, 2)).toMatchObject({
      ids: [],
      count: 0,
      partialIds: [1, 2],
      all: false,
    })
    expect(summarizeHour([], 19, 0).all).toBe(false)
  })
  it('한 시간 전체에 있는 멤버와 일부에만 있는 멤버를 구분한다', () => {
    const data = expandCommon([
      {
        startMinute: 0,
        endMinute: 30,
        availableCount: 2,
        availableMemberIds: [1, 2],
        allAvailable: false,
      },
      {
        startMinute: 30,
        endMinute: 60,
        availableCount: 2,
        availableMemberIds: [1, 3],
        allAvailable: false,
      },
    ])
    expect(summarizeHour(data, 0, 3)).toMatchObject({
      ids: [1],
      count: 1,
      partialIds: [2, 3],
      all: false,
    })
    expect(cellsToSlots(setHour(emptyCells(), 23, true))).toEqual([
      { startMinute: 1380, endMinute: 1440 },
    ])
  })
  it('00:00과 24:00을 포함한 구간을 왕복 변환한다', () => {
    const slots = [
      { startMinute: 0, endMinute: 60 },
      { startMinute: 1380, endMinute: 1440 },
    ]
    expect(cellsToSlots(slotsToCells(slots))).toEqual(slots)
    expect(time(1440)).toBe('24:00')
  })
  it('인접한 선택 칸은 병합하고 떨어진 구간은 유지한다', () => {
    const cells = emptyCells()
    cells[38] = cells[39] = cells[42] = true
    expect(cellsToSlots(cells)).toEqual([
      { startMinute: 1140, endMinute: 1200 },
      { startMinute: 1260, endMinute: 1290 },
    ])
  })
  it('빈 배열은 빈 슬롯 목록이 된다', () => expect(cellsToSlots(emptyCells())).toEqual([]))
  it('여러 요일과 하루 전체 가능을 손실 없이 변환한다', () => {
    const slots = [
      { dayOfWeek: 'MONDAY' as const, startMinute: 0, endMinute: 1440 },
      { dayOfWeek: 'SUNDAY' as const, startMinute: 1410, endMinute: 1440 },
    ]
    expect(cellsToWeekly(weeklyToCells(slots))).toEqual(slots)
  })
  it('월요일 시작과 연도 경계를 처리한다', () => {
    expect(monday('2026-11-15')).toBe('2026-11-09')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-11-09', -1)).toBe('2026-11-08')
  })
  it('서울 날짜는 UTC 자정 전후에도 한국 기준이다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-12T16:00:00Z'))
    expect(seoulToday()).toBe('2026-11-13')
    vi.useRealTimers()
  })
  it('서버 공통 시간의 인원과 멤버 목록을 그대로 48칸에 반영한다', () => {
    const slots = [
      {
        startMinute: 0,
        endMinute: 60,
        availableCount: 2,
        availableMemberIds: [1, 9],
        allAvailable: true,
      },
      {
        startMinute: 60,
        endMinute: 1440,
        availableCount: 0,
        availableMemberIds: [],
        allAvailable: false,
      },
    ]
    const cells = expandCommon(slots)
    expect(cells).toHaveLength(48)
    expect(cells[0]).toBe(slots[0])
    expect(cells[1]).toBe(slots[0])
    expect(cells[2]).toBe(slots[1])
    expect(cells[47]?.allAvailable).toBe(false)
  })
})
