import { useState } from 'react'
import type { CommonAvailability, GroupAvailability, Member } from '../../types/api'
import { DAY_LABELS, expandCommon, hourState, summarizeHour, time } from '../../utils/schedule'
import { Modal } from '../../components/Modal'
import { TimeGrid } from '../../components/TimeGrid'
import { useSlotDrag } from '../../hooks/useSlotDrag'

export interface CalendarEditing {
  scope: 'date' | 'weekly'
  cells: (date: string, column: number) => boolean[]
  set: (date: string, column: number, row: number, selected: boolean) => void
  start: () => void
  end: () => void
}
export interface CalendarProps {
  common: CommonAvailability
  availability: GroupAvailability
  members: Member[]
  memberId: number
  onEdit: (date: string) => void
  editing?: CalendarEditing
}
export function Calendar({
  common,
  availability,
  members,
  memberId,
  onEdit,
  editing,
}: CalendarProps) {
  const [view, setView] = useState('all')
  const [detail, setDetail] = useState<{
    date: string
    minute: number
    ids: number[]
    total: number
    halves: { minute: number; ids: number[] }[]
  } | null>(null)
  const expanded = common.days.map((day) => expandCommon(day.timeSlots))
  const bind = useSlotDrag({
    enabled: !!editing,
    get: (col, row) =>
      !!editing && hourState(editing.cells(common.days[col].date, col), row) === 'full',
    set: (col, row, value) => editing?.set(common.days[col].date, col, row, value),
    start: () => editing?.start(),
    end: () => editing?.end(),
  })
  const anyAll = common.days.some((d) => d.timeSlots.some((s) => s.allAvailable))
  return (
    <>
      <div className="calendar-toolbar">
        <div className="legend">
          <span>
            <i className="legend-box all" /> 전원 가능
          </span>
          <span>
            <i className="legend-box some" /> 일부 가능
          </span>
          <span>✓ 1시간 전체 가능 · ◐ 30분 일부 가능</span>
        </div>
        {!editing && (
          <label className="view-label">
            표시
            <select
              aria-label="시간표 표시 멤버"
              value={view}
              onChange={(e) => setView(e.target.value)}
            >
              <option value="all">그룹 전체</option>
              {members.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.nickname}
                  {m.memberId === memberId ? ' (나)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!anyAll && (
        <p className="calendar-notice">
          이번 주는 아직 전원이 가능한 시간이 없어요. 내 일정을 설정하거나 날짜별로 조정해 보세요.
        </p>
      )}
      <TimeGrid
        label="주간 가능 시간표"
        hiddenNote={(col) => {
          const actual = expanded[col]
            .slice(4, 16)
            .some((slot) => slot?.availableMemberIds.includes(memberId))
          const draft = editing?.cells(common.days[col].date, col).slice(4, 16).some(Boolean)
          return actual
            ? '내 일정 있음'
            : draft
              ? editing?.scope === 'weekly'
                ? '반복 설정 있음'
                : '수정 중인 일정 있음'
              : undefined
        }}
        columns={common.days.map((day, i) => {
          const own = availability.days
            .find((d) => d.date === day.date)
            ?.members.find((m) => m.memberId === memberId)
          return {
            id: day.date,
            label: `${DAY_LABELS[i]} ${day.date.slice(5)}`,
            header: (
              <button
                className="grid-date-button"
                onClick={() => onEdit(day.date)}
                aria-label={`${day.date} 내 예외 일정 수정`}
              >
                <span>
                  {DAY_LABELS[i]} {day.date.slice(5).replace('-', '.')}
                </span>
                <small>{own?.source === 'OVERRIDE' ? '내 예외 적용' : '내 일정 상세'}</small>
              </button>
            ),
          }
        })}
        renderCell={(col, hour) => {
          const day = common.days[col],
            summary = summarizeHour(expanded[col], hour, day.totalMembers)
          const mine = summary.ids.includes(memberId),
            myPartial = summary.partialIds.includes(memberId)
          const draftState = editing
            ? hourState(editing.cells(day.date, col), hour)
            : mine
              ? 'full'
              : myPartial
                ? 'partial'
                : 'none'
          const checked = draftState === 'full'
          const actualLabel = mine ? '가능' : myPartial ? '일부 가능' : '불가능'
          const personal = !editing && view !== 'all' && summary.ids.includes(Number(view))
          const style = summary.all
            ? 'all'
            : summary.count
              ? summary.count / Math.max(day.totalMembers, 1) > 0.5
                ? 'many'
                : 'some'
              : ''
          return (
            <button
              type="button"
              className={`calendar-cell ${style} ${personal ? 'personal-view' : ''} ${editing ? 'editing-cell' : ''} ${checked ? 'my-available' : ''} ${summary.partialIds.length || draftState === 'partial' ? 'partial' : ''}`}
              title={`${time(hour * 60)}~${time((hour + 1) * 60)} · 1시간 전체 ${summary.count}/${day.totalMembers}명 · 30분 일부 가능 ${summary.partialIds.length}명${editing ? ` · ${editing.scope === 'weekly' ? '반복 설정' : '예외 초안'} ${draftState === 'full' ? '가능' : draftState === 'partial' ? '일부 가능' : '불가'}` : ''}`}
              role={editing ? 'checkbox' : undefined}
              aria-checked={editing ? (draftState === 'partial' ? 'mixed' : checked) : undefined}
              aria-label={`${day.date} ${time(hour * 60)} ${summary.count}/${day.totalMembers}명${summary.all ? ' 전원 가능' : ''}, 본인 참여 ${actualLabel}${summary.partialIds.length ? `, 30분 일부 가능 ${summary.partialIds.length}명` : ''}${editing ? `, ${editing.scope === 'weekly' ? '반복 설정' : '예외 초안'} ${draftState === 'full' ? '가능' : draftState === 'partial' ? '일부 가능' : '불가능'}` : ''}`}
              {...bind(col, hour)}
              onClick={(event) =>
                editing
                  ? bind(col, hour).onClick(event)
                  : setDetail({
                      date: day.date,
                      minute: hour * 60,
                      ids: summary.ids,
                      total: day.totalMembers,
                      halves: summary.halves.map((slot, i) => ({
                        minute: hour * 60 + i * 30,
                        ids: slot?.availableMemberIds || [],
                      })),
                    })
              }
            >
              <span className="my-check" aria-hidden="true">
                {(editing?.scope === 'weekly' ? mine : checked)
                  ? '✓'
                  : (editing?.scope === 'weekly' ? myPartial : draftState === 'partial')
                    ? '◐'
                    : ''}
              </span>
              <span>
                {summary.count}/{day.totalMembers}
              </span>
              {summary.partialIds.length > 0 && (
                <span className="partial-label" title="30분 일부 가능">
                  ◐
                </span>
              )}
            </button>
          )
        }}
      />
      {detail && (
        <Modal
          title={`${detail.date} · ${time(detail.minute)}–${time(detail.minute + 60)}`}
          onClose={() => setDetail(null)}
        >
          <p className="muted">
            참여 가능{' '}
            <strong className="accent">
              {detail.ids.length}/{detail.total}명
            </strong>
          </p>
          <div className="half-details">
            {detail.halves.map((half) => (
              <p key={half.minute}>
                {time(half.minute)}~{time(half.minute + 30)} · {half.ids.length}/{detail.total}명:{' '}
                {half.ids
                  .map((id) => members.find((m) => m.memberId === id)?.nickname || `멤버 ${id}`)
                  .join(', ') || '참여 가능 인원 없음'}
              </p>
            ))}
          </div>
          {detail.ids.length ? (
            <ul className="detail-members">
              {detail.ids.map((id) => (
                <li key={id}>
                  <span className="avatar">
                    {members.find((m) => m.memberId === id)?.nickname.slice(0, 1) || '?'}
                  </span>
                  {members.find((m) => m.memberId === id)?.nickname || `멤버 ${id}`}
                  {id === memberId && <span className="badge">나</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-message">이 시간에 참여 가능한 멤버가 없습니다.</p>
          )}
          <button
            className="button primary full"
            onClick={() => {
              onEdit(detail.date)
              setDetail(null)
            }}
          >
            이 날짜의 내 일정 수정
          </button>
        </Modal>
      )}
    </>
  )
}
