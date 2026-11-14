import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'

interface Painting {
  enabled: boolean
  get: (column: number, slot: number) => boolean
  set: (column: number, slot: number, selected: boolean) => void
  start?: () => void
  end?: () => void
}

/** 드래그 방향은 시작 칸에서 결정하며 같은 칸은 한 번만 처리합니다. */
export function useSlotDrag(config: Painting) {
  const current = useRef(config)
  const gesture = useRef<{ value: boolean; visited: Set<string> } | null>(null)
  const skipClick = useRef(false)
  useEffect(() => {
    current.current = config
  }, [config])
  useEffect(() => {
    const finish = () => {
      if (!gesture.current) return
      gesture.current = null
      current.current.end?.()
    }
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      finish()
    }
  }, [])
  function paint(column: number, slot: number) {
    const active = gesture.current,
      key = `${column}:${slot}`
    if (!active || active.visited.has(key)) return
    active.visited.add(key)
    current.current.set(column, slot, active.value)
  }
  return (column: number, slot: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      skipClick.current = false
      // 터치는 클릭으로 처리해 세로 스크롤을 시작할 때 일정이 바뀌지 않도록 합니다.
      if (!current.current.enabled || event.button !== 0 || event.pointerType === 'touch') return
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      skipClick.current = true
      current.current.start?.()
      gesture.current = { value: !current.current.get(column, slot), visited: new Set() }
      paint(column, slot)
    },
    onPointerEnter: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (current.current.enabled && event.buttons === 1 && event.pointerType !== 'touch')
        paint(column, slot)
    },
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!current.current.enabled || (event.detail !== 0 && skipClick.current)) return
      current.current.start?.()
      current.current.set(column, slot, !current.current.get(column, slot))
      current.current.end?.()
    },
    onDragStart: (event: React.DragEvent<HTMLButtonElement>) => event.preventDefault(),
  })
}
