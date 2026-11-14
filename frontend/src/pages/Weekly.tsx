import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Save, RotateCcw } from 'lucide-react'
import { api, isTemporaryError } from '../api/client'
import { useGroupSession } from '../features/member/Auth'
import { Feedback, Loading } from '../components/Feedback'
import { WeeklySlotEditor } from '../components/SlotEditor'
import { cellsToWeekly, emptyCells, weeklyToCells } from '../utils/schedule'
import { useUnsaved } from '../hooks/useUnsaved'
import type { WeeklySchedule } from '../types/api'

export function Weekly() {
  const { session, key } = useGroupSession()
  const query = useQuery({ queryKey: [...key, 'weekly'], queryFn: () => api.weekly(session!) })
  if (query.isPending) return <Loading />
  if (!query.data || (query.error && !isTemporaryError(query.error)))
    return <Feedback error={query.error} retry={() => void query.refetch()} />
  return (
    <>
      {query.error && <Feedback error={query.error} retry={() => void query.refetch()} />}
      <WeeklyEditor key={session!.revision} initial={query.data} />
    </>
  )
}
function WeeklyEditor({ initial }: { initial: WeeklySchedule }) {
  const { session, key } = useGroupSession()
  const client = useQueryClient()
  const [cells, setCells] = useState(() => weeklyToCells(initial.slots))
  const [saved, setSaved] = useState(() => JSON.stringify(cellsToWeekly(cells)))
  const [success, setSuccess] = useState(false)
  const dirty = saved !== JSON.stringify(cellsToWeekly(cells))
  useUnsaved(dirty)
  const save = useMutation({
    mutationFn: () => api.saveWeekly(session!, cellsToWeekly(cells)),
    onSuccess: async (data) => {
      setSaved(JSON.stringify(data.slots))
      setCells(weeklyToCells(data.slots))
      setSuccess(true)
      await client.invalidateQueries({ queryKey: key })
    },
  })
  return (
    <section className="page">
      <Link className="back-link" to={`/groups/${session!.groupId}`}>
        <ArrowLeft size={16} /> 대시보드
      </Link>
      <div className="section-head editor-heading">
        <div>
          <div className="eyebrow">MY WEEKLY SCHEDULE</div>
          <h1>나의 주간 반복 일정</h1>
          <p className="muted">
            매주 가능한 시간을 선택하세요. 날짜별 예외는 대시보드에서 따로 설정할 수 있어요.
          </p>
        </div>
        <span className="badge">1시간 선택 · KST</span>
      </div>
      <div className="card editor-card">
        <div className="section-head">
          <div>
            <strong>가능한 시간 선택</strong>
            <p className="small-text muted">
              칸을 누르거나 마우스로 이어서 선택하세요. 선택된 칸을 다시 누르면 해제됩니다.
            </p>
          </div>
          <button
            className="button small"
            disabled={save.isPending}
            onClick={() => {
              setCells(Array.from({ length: 7 }, emptyCells))
              setSuccess(false)
            }}
          >
            <RotateCcw size={15} /> 전체 비우기
          </button>
        </div>
        <WeeklySlotEditor
          cells={cells}
          disabled={save.isPending}
          onChange={(next) => {
            setCells(next)
            setSuccess(false)
          }}
        />
        <div className="editor-bottom">
          <span className="small-text muted">
            {dirty ? '아직 저장하지 않은 변경 사항이 있어요.' : '현재 저장된 일정입니다.'}
          </span>
          <button
            className="button primary"
            disabled={save.isPending || !dirty}
            onClick={() => save.mutate()}
          >
            <Save size={17} />
            {save.isPending ? '저장 중…' : '반복 일정 저장'}
          </button>
        </div>
        {save.error && <Feedback error={save.error} />}
        {success && (
          <p role="status" className="feedback success">
            반복 일정을 저장했어요. 그룹 시간표에도 반영됩니다.
          </p>
        )}
      </div>
    </section>
  )
}
