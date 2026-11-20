import { useEffect, useState } from 'react'

const locks = new Set<symbol>()
const listeners = new Set<() => void>()
export const updateSafety = {
  getSnapshot: () => locks.size > 0,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  set: (key: symbol, blocked: boolean) => {
    if (blocked) locks.add(key); else locks.delete(key)
    listeners.forEach(listener => listener())
  },
}

export function useUpdateSafety(blocked: boolean) {
  const [key] = useState(() => Symbol('unsaved-changes'))
  useEffect(() => {
    updateSafety.set(key, blocked)
    return () => updateSafety.set(key, false)
  }, [key, blocked])
}
