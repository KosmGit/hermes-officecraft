import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { placePopover, scrollCloses } from '../core/popover.js'

/**
 * The one popover of the page (help « ? », alert details, the legend). A button that opens a small card next to it; the card is
 * placed with `position: fixed` from the button's box (the panel and the stage clip what overflows them), flips above when it does not fit
 * below, and closes on Escape (the focus goes back to the button), on a click outside, on scroll and on resize. Nothing animates but a fade.
 * The text is explanation, never a paragraph on the page: this is where the long sentences live. A card taller than the room it has
 * is capped and scrolls inside itself (src/core/popover.js); scrolling the card does not close it, scrolling the page does.
 */

export function usePopover() {
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  const card = useRef(null)
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!open || !anchor.current || !card.current) { setPos(null); return }
    const a = anchor.current.getBoundingClientRect()
    setPos(placePopover({
      anchor: { top: a.top, bottom: a.bottom, left: a.left, width: a.width },
      card: { w: card.current.offsetWidth, h: card.current.scrollHeight + 2 },   // the natural height (the CSS cap does not shorten scrollHeight)
      view: { w: window.innerWidth, h: window.innerHeight }
    }))
  }, [open])
  // a card that scrolls is reachable by keyboard (the arrows scroll it once it has the focus)
  useEffect(() => {
    const c = card.current
    if (c && pos && c.scrollHeight > c.clientHeight + 1) c.tabIndex = 0
  }, [pos])
  useEffect(() => {
    if (!open) return undefined
    const close = () => setOpen(false)
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); anchor.current?.focus() } }
    const onDown = e => { if (!card.current?.contains(e.target) && !anchor.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', close)
    const onScroll = e => { if (scrollCloses({ insideCard: Boolean(card.current && e.target instanceof Node && card.current.contains(e.target)) })) close() }
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
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
      style={pop.pos ? { left: pop.pos.left, top: pop.pos.top, maxHeight: pop.pos.maxH } : { left: 0, top: 0, visibility: 'hidden' }}
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
