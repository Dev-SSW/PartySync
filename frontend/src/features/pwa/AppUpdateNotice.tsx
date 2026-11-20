import { useSyncExternalStore } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { appUpdates } from './appUpdates'
import { updateSafety } from './updateSafety'

export function AppUpdateNotice() {
  const update = useSyncExternalStore(appUpdates.subscribe, appUpdates.getSnapshot)
  const unsaved = useSyncExternalStore(updateSafety.subscribe, updateSafety.getSnapshot)
  const mutating = useIsMutating() > 0
  if (!update.version) return null
  const blocked = unsaved || mutating
  return <aside className="card app-update-notice" aria-label="앱 업데이트">
    <div><strong>새 버전의 PartySync가 있습니다</strong>
      <p className="muted small-text">{blocked ? '변경 내용을 저장한 뒤 업데이트할 수 있어요.' : '재설치 없이 최신 버전으로 업데이트하세요. 로그인과 파티 설정은 유지됩니다.'}</p>
    </div>
    <button className="button primary small" disabled={blocked || update.applying} onClick={() => { if (!updateSafety.getSnapshot() && !mutating) appUpdates.apply() }}>{update.applying ? '업데이트 중…' : '업데이트하기'}</button>
  </aside>
}
