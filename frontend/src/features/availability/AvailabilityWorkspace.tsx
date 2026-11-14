import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useBlocker } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { Feedback, Loading } from '../../components/Feedback'
import { useGroupSession } from '../member/Auth'
import {
  cellsToSlots,
  cellsToWeekly,
  DAY_LABELS,
  slotsToCells,
  setHour,
  weeklyToCells,
} from '../../utils/schedule'
import { Calendar, type CalendarProps } from './Calendar'
import { SaveQueue } from './SaveQueue'

type Command =
  | { kind: 'date'; date: string; cells: boolean[] }
  | { kind: 'weekly'; cells: boolean[][] }
  | { kind: 'restore'; date: string; cells: boolean[] }

/** 캘린더 초안과 자동 저장을 관리합니다. 인원 계산은 서버 응답만 사용합니다. */
export function AvailabilityWorkspace({
  onBusy,
  ...props
}: CalendarProps & { onBusy: (busy: boolean) => void }) {
  const { session, key } = useGroupSession()
  const client = useQueryClient()
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [scope, setScope] = useState<'date' | 'weekly'>('date')
  const [drafts, setDrafts] = useState<Record<string, Command>>({})
  const draftsRef = useRef(drafts)
  const weekly = useQuery({
    queryKey: [...key, 'weekly'],
    queryFn: () => api.weekly(session!),
    enabled: mode === 'edit',
    refetchOnWindowFocus: false,
  })
  const [queue] = useState(
    () =>
      new SaveQueue<Command>(
        async (_id, command) => {
          if (command.kind === 'weekly') {
            const saved = await api.saveWeekly(session!, cellsToWeekly(command.cells))
            client.setQueryData([...key, 'weekly'], saved)
          } else if (command.kind === 'restore') {
            await api.deleteOverride(session!, command.date)
            client.setQueryData([...key, 'overrides', command.date], [])
          } else {
            const saved = await api.saveOverride(
              session!,
              command.date,
              cellsToSlots(command.cells),
            )
            client.setQueryData([...key, 'overrides', command.date], [saved])
          }
          if (command.kind !== 'weekly')
            await client.invalidateQueries({ queryKey: [...key, 'overrides'], refetchType: 'none' })
        },
        (id, command) => {
          if (draftsRef.current[id] !== command) return
          const next = { ...draftsRef.current }
          delete next[id]
          draftsRef.current = next
          setDrafts(next)
        },
        800,
        async () => {
          await Promise.all([
            client.invalidateQueries(
              { queryKey: [...key, 'availability'] },
              { throwOnError: true },
            ),
            client.invalidateQueries({ queryKey: [...key, 'common'] }, { throwOnError: true }),
          ])
        },
      ),
  )
  const status = useSyncExternalStore(queue.subscribe, queue.getSnapshot)
  const blocker = useBlocker(status.pending)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let active = true
    void queue.flush().then((ok) => {
      if (active) {
        if (ok) blocker.proceed()
        else blocker.reset()
      }
    })
    return () => {
      active = false
    }
  }, [blocker, queue])
  useEffect(() => {
    onBusy(status.pending)
    const leave = (event: BeforeUnloadEvent) => {
      if (status.pending) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [onBusy, status.pending])
  function enqueue(id: string, command: Command) {
    const next = { ...draftsRef.current, [id]: command }
    draftsRef.current = next
    setDrafts(next)
    queue.enqueue(id, command)
  }
  function dateCells(date: string) {
    const draft = draftsRef.current[date]
    if (draft && draft.kind !== 'weekly') return draft.cells
    return slotsToCells(
      props.availability.days
        .find((d) => d.date === date)
        ?.members.find((m) => m.memberId === props.memberId)?.slots || [],
    )
  }
  function weeklyCells() {
    const draft = draftsRef.current.weekly
    return draft?.kind === 'weekly' ? draft.cells : weeklyToCells(weekly.data?.slots || [])
  }
  const editReady = mode === 'edit' && !!weekly.data
  return (
    <>
      <div className="editing-toolbar">
        <div className="segmented" role="group" aria-label="캘린더 모드">
          <button
            aria-pressed={mode === 'view'}
            onClick={() => {
              if (!status.pending) setMode('view')
            }}
            disabled={status.pending}
          >
            일정 보기
          </button>
          <button aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>
            내 일정 수정
          </button>
        </div>
        {mode === 'edit' && (
          <label>
            수정 범위
            <select
              aria-label="수정 범위"
              value={scope}
              disabled={status.pending}
              onChange={(e) => setScope(e.target.value as 'date' | 'weekly')}
            >
              <option value="date">이번 날짜만 수정</option>
              <option value="weekly">매주 반복 일정 수정</option>
            </select>
          </label>
        )}
        <span role="status" className="autosave-status">
          {status.error
            ? '저장 실패 · 선택은 유지됩니다'
            : status.paused
              ? '드래그 중 · 놓으면 자동 저장'
              : status.saving
                ? '저장 중…'
                : status.pending
                  ? '변경 사항 저장 대기…'
                  : status.saved
                    ? '저장 완료'
                    : mode === 'edit'
                      ? '클릭하면 자동 저장'
                      : ''}
        </span>
      </div>
      {mode === 'edit' && (
        <div className="calendar-notice">
          {scope === 'date'
            ? '이번 날짜만 수정합니다. 다른 날짜와 매주 반복 일정은 유지됩니다.'
            : '매주 반복되는 원본 설정을 수정합니다. 테두리는 반복 설정, 체크·인원은 실제 참여입니다. 날짜별 예외가 있으면 해당 날짜에는 예외가 우선합니다.'}
          {status.pending && (
            <strong>
              {scope === 'weekly'
                ? ' · 반복 표시는 편집 초안이며 실제 참여 체크와 인원은 서버 저장 결과입니다.'
                : ' · 체크는 편집 초안이며 참여 인원은 서버 저장 결과입니다.'}
            </strong>
          )}
        </div>
      )}
      {status.error && <Feedback error={status.error} retry={() => void queue.flush()} />}
      {mode === 'edit' && weekly.error && (
        <Feedback error={weekly.error} retry={() => void weekly.refetch()} />
      )}
      {mode === 'edit' && weekly.isPending ? (
        <Loading />
      ) : (
        <Calendar
          {...props}
          onEdit={(date) => {
            void queue.flush().then((ok) => {
              if (ok) props.onEdit(date)
            })
          }}
          editing={
            editReady
              ? {
                  scope,
                  start: () => queue.pause(),
                  end: () => queue.resume(),
                  cells: (date, col) => (scope === 'date' ? dateCells(date) : weeklyCells()[col]),
                  set: (date, col, row, selected) => {
                    if (scope === 'date') {
                      queue.seed(date, { kind: 'date', date, cells: dateCells(date) })
                      const cells = setHour(dateCells(date), row, selected)
                      enqueue(date, { kind: 'date', date, cells })
                    } else {
                      queue.seed('weekly', { kind: 'weekly', cells: weeklyCells() })
                      const cells = weeklyCells().map((day, index) =>
                        index === col ? setHour(day, row, selected) : day,
                      )
                      enqueue('weekly', { kind: 'weekly', cells })
                    }
                  },
                }
              : undefined
          }
        />
      )}
      {editReady && scope === 'date' && (
        <div className="restore-days">
          <span className="small-text muted">날짜별 예외 삭제:</span>
          {props.availability.days
            .filter((day) =>
              day.members.some((m) => m.memberId === props.memberId && m.source === 'OVERRIDE'),
            )
            .map((day) => (
              <button
                className="button small"
                key={day.date}
                onClick={() => {
                  const col = props.common.days.findIndex((d) => d.date === day.date)
                  enqueue(day.date, { kind: 'restore', date: day.date, cells: weeklyCells()[col] })
                }}
              >
                {DAY_LABELS[props.common.days.findIndex((d) => d.date === day.date)]}{' '}
                {day.date.slice(5)} 반복 일정으로 복원
              </button>
            ))}
        </div>
      )}
    </>
  )
}
