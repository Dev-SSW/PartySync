import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = ref.current!
    element.focus()
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      }
      if (e.key !== 'Tab') return
      const items = Array.from(
        element.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length > 0)
      const first = items[0],
        last = items.at(-1)
      if (!first) {
        e.preventDefault()
        return
      }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === element)) {
        e.preventDefault()
        last?.focus()
      } else if (
        !e.shiftKey &&
        (document.activeElement === last || document.activeElement === element)
      ) {
        e.preventDefault()
        first.focus()
      }
    }
    element.addEventListener('keydown', key)
    return () => {
      element.removeEventListener('keydown', key)
      document.body.style.overflow = original
      previous?.focus()
    }
  }, [])
  return (
    <div className="overlay">
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="section-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" aria-label="닫기" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
