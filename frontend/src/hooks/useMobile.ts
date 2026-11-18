import { useEffect, useState } from 'react'

/** CSS와 같은 760px 기준으로 모바일 렌더링을 전환한다. */
export function useMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 760px)').matches ?? false)
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 760px)')
    if (!query) return
    const change = () => setMobile(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return mobile
}
