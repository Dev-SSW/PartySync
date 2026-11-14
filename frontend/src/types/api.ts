export type Role = 'OWNER' | 'MEMBER'
export interface Me {
  memberId: number
  groupId: number
  nickname: string
  role: Role
}
export interface Member {
  memberId: number
  nickname: string
  role: Role
  joinedAt: string
}
export interface Group {
  groupId: number
  name: string
  description: string | null
  memberCount: number
  createdAt: string
}
export interface Membership {
  group: Group
  member: Member
  memberAccessToken: string
  inviteCode?: string
}
export interface Slot {
  startMinute: number
  endMinute: number
}
export const DAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const
export type Day = (typeof DAYS)[number]
export interface WeeklySlot extends Slot {
  dayOfWeek: Day
}
export interface WeeklySchedule {
  slots: WeeklySlot[]
}
export interface OverrideSchedule {
  date: string
  slots: Slot[]
}
export interface MemberAvailability {
  memberId: number
  nickname: string
  source: 'WEEKLY' | 'OVERRIDE'
  slots: Slot[]
}
export interface GroupAvailability {
  groupId: number
  days: { date: string; members: MemberAvailability[] }[]
}
export interface CountedSlot extends Slot {
  availableCount: number
  availableMemberIds: number[]
  allAvailable: boolean
}
export interface CommonDay {
  date: string
  totalMembers: number
  timeSlots: CountedSlot[]
}
export interface CommonAvailability {
  groupId: number
  days: CommonDay[]
}
