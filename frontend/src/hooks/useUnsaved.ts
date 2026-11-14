import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'
export function useUnsaved(dirty: boolean) {
  const blocker = useBlocker(dirty)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('저장하지 않은 변경 사항이 있습니다. 나가시겠어요?')) blocker.proceed()
      else blocker.reset()
    }
  }, [blocker])
}
