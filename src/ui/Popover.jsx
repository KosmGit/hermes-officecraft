import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

/**
 * The one popover of the page (help « ? », alert details, the legend). A button that opens a small card next to it; the card is
 * placed with `position: fixed` from the button's box (the panel and the stage clip what overflows them), flips above when it does not fit
 * below, and closes on Escape (the focus goes back to the button), on a click outside, on scroll and on resize. Nothing animates but a fade.
 * The text is explanation, never a paragraph on the page: this is where the long sentences live.
 */
const GAP = 8
const EDGE = 8

export function usePopover() {
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  const card = useRef(null)
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!open || !anchor.current || !card.current) { setPos(null); return }
    const a = anchor.current.getBoundingClientRect()
    const w = card.current.offsetWidth
    const h = card.current.offsetHeight
    const left = Math.min(Math.max(EDGE, a.left + a.width / 2 - w / 2), Math.max(EDGE, window.innerWidth - w - EDGE))
    let top = a.bottom + GAP
    if (top + h > window.innerHeight - EDGE) top = Math.max(EDGE, a.top - h - GAP)
    setPos({ left, top })
  }, [open])
  useEffect(() => {
    if (!open) return undefined
    const close = () => setOpen(false)
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); anchor.current?.focus() } }
    const onDown = e => { if (!card.current?.contains(e.target) && !anchor.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])
  return { open, setOpen, anchor, card, pos }
}

/** The card of a popover (rendered next to its button, positioned by usePopover). */
export function PopCard({ pop, id, label, children, className = '', role = 'group', ...rest }) {
  if (!pop.open) return null
  return (
    <div
      ref={pop.card}
      id={id}
      role={role}
      aria-label={label}
      {...rest}
      className={`ux-pop ${className}`}
      style={pop.pos ? { left: pop.pos.left, top: pop.pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {children}
    </div>
  )
}

/** « ? » next to a title: its text opens on click or Enter, and only then. `label` names what it explains (aria-label). */
export function Help({ label, children, title = '', className = '' }) {
  const pop = usePopover()
  const id = useId()
  return (
    <span className="ux-helpwrap">
      <button
        ref={pop.anchor}
        type="button"
        className={`ux-help ${className}`}
        aria-expanded={pop.open}
        aria-controls={pop.open ? id : undefined}
        aria-label={label}
        data-help
        onClick={() => pop.setOpen(v => !v)}
      >
        ?
      </button>
      <PopCard pop={pop} id={id} label={label}>
        {title ? <h5>{title}</h5> : null}
        {children}
      </PopCard>
    </span>
  )
}
