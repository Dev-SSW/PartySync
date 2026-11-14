import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, isTemporaryError } from '../../api/client'
import { useGroupSession } from '../member/Auth'
import { Modal } from '../../components/Modal'
import { Feedback, Loading } from '../../components/Feedback'
import { SlotEditor } from '../../components/SlotEditor'
import { cellsToSlots, emptyCells, slotsToCells } from '../../utils/schedule'
import type { MemberAvailability, OverrideSchedule } from '../../types/api'
import { useUnsaved } from '../../hooks/useUnsaved'

export function OverrideEditor({
  date,
  current,
  onClose,
}: {
  date: string
  current: MemberAvailability
  onClose: () => void
}) {
  const { session, key } = useGroupSession()
  const query = useQuery({
    queryKey: [...key, 'overrides', date],
    queryFn: () => api.overrides(session!, date, date),
  })
  if (query.isPending || !query.data || (query.error && !isTemporaryError(query.error)))
    return (
      <Modal title={`${date} · 내 일정`} onClose={onClose}>
        {query.isPending ? (
          <Loading />
        ) : (
          <Feedback error={query.error} retry={() => void query.refetch()} />
        )}
      </Modal>
    )
  return (
    <OverrideForm
      date={date}
      current={current}
      override={query.data[0]}
      onClose={onClose}
      refreshError={query.error}
      retry={() => void query.refetch()}
    />
  )
}
function OverrideForm({
  date,
  current,
  override,
  onClose,
  refreshError,
  retry,
}: {
  date: string
  current: MemberAvailability
  override?: OverrideSchedule
  onClose: () => void
  refreshError: unknown
  retry: () => void
}) {
  const { session, key } = useGroupSession()
  const client = useQueryClient()
  const [cells, setCells] = useState(() => slotsToCells(override ? override.slots : current.slots))
  const [initial] = useState(() => JSON.stringify(cells))
  const [done, setDone] = useState(false)
  const dirty = !done && initial !== JSON.stringify(cells)
  useUnsaved(dirty)
  const mutation = useMutation({
    mutationFn: async (action: 'save' | 'delete'): Promise<void> => {
      if (action === 'delete') await api.deleteOverride(session!, date)
      else await api.saveOverride(session!, date, cellsToSlots(cells))
    },
    onSuccess: async () => {
      setDone(true)
      await client.invalidateQueries({ queryKey: key })
      onClose()
    },
  })
  const close = () => {
    if (!mutation.isPending && (!dirty || window.confirm('수정한 내용을 버리고 닫을까요?')))
      onClose()
  }
  return (
    <Modal title={`${date} · 내 일정`} onClose={close}>
      {!!refreshError && <Feedback error={refreshError} retry={retry} />}
      <div className={`feedback ${override ? 'violet-note' : ''}`}>
        <span>{override ? '날짜별 예외 적용 중' : '기본 반복 일정 적용 중'}</span>
        <span className="small-text">
          {override?.slots.length === 0
            ? '이 날짜는 하루 전체 참여 불가능합니다.'
            : '이 날짜만 변경되며 다음 주의 반복 일정은 유지됩니다.'}
        </span>
      </div>
      <SlotEditor
        label={`${date}`}
        cells={cells}
        onChange={setCells}
        disabled={mutation.isPending}
      />
      <p className="small-text muted">
        선택한 시간이 없으면 이 날짜를 하루 전체 불가능으로 저장합니다.
      </p>
      <div className="actions wrap">
        <button
          className="button small"
          disabled={mutation.isPending}
          onClick={() => setCells(emptyCells())}
        >
          하루 전체 불가능 선택
        </button>
        <button
          className="button small"
          disabled={mutation.isPending || !override}
          onClick={() => mutation.mutate('delete')}
        >
          예외 삭제 · 반복 일정 복원
        </button>
      </div>
      {mutation.error && <Feedback error={mutation.error} />}
      <div className="editor-bottom">
        <button
          className="button"
          disabled={mutation.isPending}
          onClick={() => {
            if (!dirty || window.confirm('수정한 내용을 버리고 닫을까요?')) onClose()
          }}
        >
          취소
        </button>
        <button
          className="button primary"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate('save')}
        >
          {mutation.isPending ? '저장 중…' : '이 날짜의 예외 저장'}
        </button>
      </div>
    </Modal>
  )
}
