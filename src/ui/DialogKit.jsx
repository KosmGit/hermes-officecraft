import * as sdk from '@hermes/plugin-sdk'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { $motionPref } from '../data/prefs.js'
import { DIALOG_CSS } from './dialogStyles.js'
import { useT } from './useT.js'

/**
 * The ONE frame of every window of the plugin (header / body / foot). A native modal <dialog>: the focus is
 * trapped in it, the page behind is inert, Escape is read by each window itself (dialogKeys.escapeCloses: under 900 px the host's
 * webapp swallows the browser's own Escape). Header = icon + title + optional risk chip + close; foot = what helps on the left
 * (a link, a « ? »), the actions on the right (Cancel, then the named action). Under 560 px the window is a full sheet.
 * Used by recruitment, the Decorator, the Seating, Resources; the settings window has its own file but the same look.
 * Theme variables only (dialogStyles.js). `onKeyDown` is the caller's: each window states its own Escape rule.
 */

// Line icons, 24 x 24, stroked with currentColor: decorative (the title is next to them), no emoji, no colour literal.
const ICONS = {
  trophy: 'M7 4h10v4a5 5 0 0 1-10 0Z M7 6H4a3 3 0 0 0 3 4 M17 6h3a3 3 0 0 1-3 4 M12 13v4 M8 21h8 M9 17h6',
  hire: 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M3 20v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1 M19 8v6 M16 11h6',
  decor: 'M4 5h16v6H4Z M12 11v3 M9 14h6v6H9Z',
  seating: 'M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3 M4 11h16v5H4Z M6 16v3 M18 16v3',
  usage: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  x: 'M6 6l12 12 M18 6L6 18',
  ext: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  chev: 'M6 9l6 6 6-6',
  check: 'M5 12.5l4.500 4.500L19 7.500',
  spark: 'M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800Z M18.500 15.500l.8 2.200 2.200.8-2.200.8-.8 2.200-.8-2.200-2.200-.8 2.200-.8Z',
  tokens: 'M12 3l8 4.500v9L12 21l-8-4.500v-9Z M12 12l8-4.500 M12 12v9 M12 12L4 7.500',
  calls: 'M5 12h4l2-6 3 12 2-6h3',
  sessions: 'M4 5h16v11H9l-5 4Z',
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  moon: 'M20 14.500A8.500 8.500 0 0 1 9.500 4 8.500 8.500 0 1 0 20 14.500Z',
  user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1',
  alert: 'M12 4l9 16H3Z M12 10v4 M12 17h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 11v5 M12 8h.01',
  campaign: 'M12 3l9 5-9 5-9-5Z M3 13l9 5 9-5'
}

export function DlgIcon({ id, size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[id] ?? ICONS.spark} />
    </svg>
  )
}

/** The class of risk of an action, said by a word and a dot (never by the colour alone): final / reversible / safe. */
export function DlgChip({ risk }) {
  const t = useT()
  return <span className={`oc-dg-chip oc-dg-${risk}`} title={t(`orders.riskTip.${risk}`)}>{t(`orders.risk.${risk}`)}</span>
}

/**
 * The « ? » of a line: a toggletip. The button says what it is about, `aria-expanded` says whether the note is shown, the note is a real
 * element next to the button (reading order, not a hover). Escape closes the note ALONE (the key stops here, the window stays), a click
 * elsewhere closes it too. It opens under the button, flips above or to the left when the window would cut it.
 */
export function DlgTip({ name, children }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState({ up: false, dx: 0 })
  const id = useId()
  const wrap = useRef(null)
  const btn = useRef(null)
  const note = useRef(null)
  useLayoutEffect(() => {
    if (!open) { setPlace({ up: false, dx: 0 }); return }
    const el = note.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const box = el.closest('dialog, [data-panel], .oc-rp')?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight }
    const limit = Math.min(box.bottom, window.innerHeight) - 4
    // under the button, shifted sideways only as far as needed to stay inside the window (and the screen)
    const lo = Math.max(box.left, 0) + 8
    const hi = Math.min(box.right, window.innerWidth) - 8
    let dx = 0
    if (r.right > hi) dx = hi - r.right
    if (r.left + dx < lo) dx = lo - r.left
    setPlace({ up: r.bottom > limit && r.top - r.height - 28 > box.top, dx })
  }, [open])
  useEffect(() => {
    if (!open) return undefined
    const onDown = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  const onKeyDown = e => {
    if (e.key !== 'Escape' || !open) return
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    btn.current?.focus()
  }
  return (
    <span ref={wrap} className="oc-dg-tipw" onKeyDown={onKeyDown}>
      <button ref={btn} type="button" className="oc-dg-help" data-help aria-expanded={open} aria-controls={open ? id : undefined} aria-label={t('dlg.helpFor', name)} onClick={() => setOpen(v => !v)}>?</button>
      {open ? <span id={id} ref={note} className={`oc-dg-tip${place.up ? ' up' : ''}`} style={place.dx ? { transform: `translateX(${Math.round(place.dx)}px)` } : undefined} role="note" data-help-note>{children}</span> : null}
    </span>
  )
}

/** A message inside a window: a refusal, a failure, a state. One shape for « empty » and « error » (tone = neutral / warn / bad). */
export function Notice({ tone = 'neutral', icon = null, children, ...rest }) {
  return (
    <p className={`oc-dg-note oc-dg-${tone}`} {...rest}>
      {icon ? <DlgIcon id={icon} size={16} /> : null}
      <span>{children}</span>
    </p>
  )
}

/** A numbered card of a stepped form: number, title, a short summary at the right, the body below. */
export function Step({ n, title, summary = null, children, ...rest }) {
  const id = useId()
  return (
    <section className="oc-dg-step" aria-labelledby={id} {...rest}>
      <div className="oc-dg-sh"><span className="oc-dg-num" aria-hidden="true">{n}</span><h3 id={id}>{title}</h3>{summary ? <span className="oc-dg-sum">{summary}</span> : null}</div>
      <div className="oc-dg-sb">{children}</div>
    </section>
  )
}

/** A segmented choice of real buttons (aria-pressed): the Seating's three orders, the Resources' windows. */
export function Seg({ label, items, value, onPick, disabled = false, attr }) {
  return (
    <span className="oc-dg-seg" role="group" aria-label={label}>
      {items.map(([code, text, off, title]) => (
        <button key={code} type="button" title={title} disabled={disabled || off || undefined} aria-pressed={value === code} {...{ [attr]: code }} onClick={() => onPick(code)}>{text}</button>
      ))}
    </span>
  )
}

/**
 * The frame. `title` + `icon` + `chip` (a risk) make the header, `children` the body (it alone scrolls), `alert` a message kept in view between the body and the foot (a form error must not hide below the fold), `start` / `actions` the foot
 * (no foot when both are missing). `onSubmit` makes the frame a <form> (Enter sends); a read-only window passes none. `size`: s / m / l.
 */
export function Dlg({
  open = true, onClose, title, icon, chip = null, size = 'm', onSubmit = null, onKeyDown, onCancel = null, backdrop = false,
  focus = null, alert = null, start = null, actions = null, closeProps = {}, still = false, className = '', children, ...rest
}) {
  const t = useT()
  const ref = useRef(null)
  const id = useId()
  const motion = sdk.useValue($motionPref)
  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) { try { dlg.showModal() } catch { /* a dialog already open */ } }
    if (!open && dlg.open) dlg.close()
  }, [open])
  useEffect(() => { if (open && focus) setTimeout(() => ref.current?.querySelector(focus)?.focus(), 0) }, [open, focus])
  const Body = onSubmit ? 'form' : 'div'
  const bodyProps = onSubmit ? { onSubmit, noValidate: true } : {}
  return (
    <dialog ref={ref} className={`oc-dg oc-dg-${size} ${className}`.trim()} aria-labelledby={`${id}-t`} data-motion={motion} data-still={still ? '' : undefined}
      onCancel={e => { e.preventDefault(); if (onCancel) onCancel(); else onClose() }} onKeyDown={onKeyDown}
      onClick={backdrop ? e => { if (e.target === ref.current) onClose() } : undefined}
      onClose={() => { if (open) onClose() }} {...rest}>
      <style>{DIALOG_CSS}</style>
      <Body className="oc-dg-frame" {...bodyProps}>
        <header className="oc-dg-h">
          {icon ? <span className="oc-dg-ico"><DlgIcon id={icon} size={20} /></span> : null}
          <h2 id={`${id}-t`}>{title}</h2>
          {chip}
          <button type="button" className="oc-dg-x" aria-label={t('dlg.close')} onClick={onClose} {...closeProps}><DlgIcon id="x" /></button>
        </header>
        <div className="oc-dg-b">{children}</div>
        {alert}
        {start || actions ? <footer className="oc-dg-f"><span className="oc-dg-fs">{start}</span><span className="oc-dg-fa">{actions}</span></footer> : null}
      </Body>
    </dialog>
  )
}
