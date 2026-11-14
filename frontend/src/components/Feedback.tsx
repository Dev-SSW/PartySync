import { AlertCircle, LoaderCircle } from 'lucide-react'
import { errorMessage } from '../api/client'
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> 정보를 불러오는 중…
    </div>
  )
}
export function Feedback({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="feedback error" role="alert">
      <AlertCircle size={18} />
      <span>{errorMessage(error)}</span>
      {retry && (
        <button className="button small" onClick={retry}>
          다시 시도
        </button>
      )}
    </div>
  )
}
