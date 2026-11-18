import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { useT } from './useT.js'

/**
 * The small parts every settings tab is made of: a row = label, ONE line of help, a « ? » for the rest, the
 * control on the right; a switch; a segmented choice; line icons. Theme variables only (the look is settingsStyles.js).
 */

// Line icons, 24 x 24 viewBox, stroked with currentColor: no emoji, no colour literal. Decorative: the word is always next to them.
const ICONS = {
  gear: 'M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z M12 2.5l1.4 2.4 2.7-.6.9 2.6 2.6.9-.6 2.7L21.5 12l-2.5 1.5.6 2.7-2.6.9-.9 2.6-2.7-.6L12 21.5l-1.4-2.4-2.7.6-.9-2.6-2.6-.9.6-2.7L2.5 12 5 10.5l-.6-2.7 2.6-.9.9-2.6 2.7.6Z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3 12h18 M12 3c2.5 2.5 3.7 5.5 3.7 9S14.500 18.500 12 21c-2.500-2.500-3.700-5.500-3.700-9S9.500 5.500 12 3Z',
  game: 'M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.200 2L14.500 14h-5L8.200 15A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4Z M8 10.500v2 M7 11.500h2 M16 11h.01 M18 12.500h.01',
  moon: 'M20 14.500A8.500 8.500 0 0 1 9.500 4 8.500 8.500 0 1 0 20 14.500Z',
  bell: 'M6 9a6 6 0 0 1 12 0c0 6 2 7.500 2 7.500H4S6 15 6 9Z M10 20a2 2 0 0 0 4 0',
  spark: 'M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800Z M18.500 15.500l.8 2.200 2.200.8-2.200.8-.8 2.200-.8-2.200-2.200-.8 2.200-.8Z',
  decor: 'M4 5h16v6H4Z M12 11v3 M9 14h6v6H9Z',
  outfits: 'M9 4l-5 3 2 4 2-1v10h8V10l2 1 2-4-5-3a3 3 0 0 1-6 0Z',
  art: 'M4 5h16v14H4Z M7 16l4-5 3 3 2-2 2 4 M8.500 8.500h.01',
  seating: 'M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3 M4 11h16v5H4Z M6 16v3 M18 16v3',
  thoughts: 'M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M8 10h.01 M12 10h.01 M16 10h.01',
  // one line icon per kind of notification (the preview draws them where the message has its symbol)
  pause: 'M8 5v14 M16 5v14',
  mute: 'M4 9v6h4l5 4V5L8 9H4Z M17 9l4 6 M21 9l-4 6',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6Z',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z M12 8v4l3 2',
  rocket: 'M12 3c3 2 5 5 5 9l-2 3H9l-2-3c0-4 2-7 5-9Z M10 18l-1 3 M14 18l1 3 M12 9.500h.01',
  back: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  card: 'M3 6h18v12H3Z M3 10h18 M7 15h3',
  cup: 'M7 4h10v5a5 5 0 0 1-10 0Z M7 6H4v2a3 3 0 0 0 3 3 M17 6h3v2a3 3 0 0 1-3 3 M12 14v4 M8 20h8',
  x: 'M6 6l12 12 M18 6L6 18',
  // the grant to give (a lock), the command to copy
  lock: 'M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v9H5Z M12 15v2',
  copy: 'M9 9h10v11H9Z M5 15V4h10',
  ext: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'
}

export function SettingsIcon({ id, size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[id] ?? ICONS.spark} />
    </svg>
  )
}

/**
 * The « ? » of a setting: a toggletip. The button says what it is about (`name`), `aria-expanded` says whether the note is shown, the note
 * is a real element next to the button (in reading order, not a hover). Escape closes the note ALONE (it does not close the window under it:
 * the key is stopped here), a click elsewhere closes it too. It is positioned against the row, so it is never clipped by the side.
 */
export function HelpTip({ name, children }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef(null)
  const btn = useRef(null)
  const note = useRef(null)
  const [up, setUp] = useState(false)
  // no room below the row (the scroller's foot or the screen's): the note opens above it instead, so it is never read by scrolling
  useLayoutEffect(() => {
    if (!open) { setUp(false); return }
    const el = note.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const scroller = el.closest('.oc-sf-panel')?.getBoundingClientRect()
    const limit = Math.min(scroller?.bottom ?? Infinity, window.innerHeight) - 4
    const rowTop = el.offsetParent?.getBoundingClientRect().top ?? r.top
    // above, the note's top would sit at the row's top + 4 - its own height: it must still be inside the scroller
    if (r.bottom > limit && rowTop + 4 - r.height >= Math.max(scroller?.top ?? 0, 0) + 4) setUp(true)
    else if (r.bottom > limit) el.scrollIntoView?.({ block: 'nearest' })   // neither side has room: the scroller moves so the note is read whole
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
    <span ref={wrap} onKeyDown={onKeyDown}>
      <button ref={btn} type="button" className="oc-sx-help" data-help aria-expanded={open} aria-controls={open ? id : undefined} aria-label={t('settings.helpFor', name)} onClick={() => setOpen(v => !v)}>?</button>
      {open ? <span id={id} ref={note} className={`oc-sx-tip${up ? ' oc-sx-tip-up' : ''}`} role="note" data-help-note>{children}</span> : null}
    </span>
  )
}

/**
 * One setting: label (+ the « ? »), at most ONE line of help, the control at the right. `control` is a function of the ids the control
 * must carry (its id, so the label is its label, and the id of the help line, so a screen reader reads it as its description).
 */
export function SettingsRow({ id, label, help = null, helpRole = undefined, tip = null, group = false, control }) {
  const hid = `${id}-help`
  return (
    <div className="oc-sx-row">
      <div className="oc-sx-lab">
        <span className="oc-sx-name">
          {group ? <span>{label}</span> : <label htmlFor={id}>{label}</label>}
          {tip ? <HelpTip name={label}>{tip}</HelpTip> : null}
        </span>
        {help ? <small id={hid} role={helpRole}>{help}</small> : null}
      </div>
      <div className="oc-sx-ctl">{control({ id, describedBy: help ? hid : undefined })}</div>
    </div>
  )
}

/** A section's title and where its settings are kept (« this computer » / « Hermes server »): the user knows what a change reaches. */
export function SectionTitle({ label, where, tip = null }) {
  const t = useT()
  return (
    <h3>
      {label}
      <span className="oc-sf-where" data-where={where}>{t(where === 'server' ? 'settings.server' : 'settings.local')}</span>
      {tip ? <HelpTip name={label}>{tip}</HelpTip> : null}
    </h3>
  )
}

/** A switch (a native checkbox with role=switch: keyboard, label and state for free). */
export function Switch({ id, checked, onChange, disabled = false, describedBy, labelledBy, ...rest }) {
  return (
    <input id={id} type="checkbox" role="switch" className="oc-sx-sw" checked={checked} disabled={disabled} aria-describedby={describedBy} aria-labelledby={labelledBy}
      onChange={event => onChange(event.target.checked)} {...rest} />
  )
}

/** A choice among a few words (real radio buttons: arrows move, the group is named by `label`). */
export function Segmented({ label, value, options, onChange, describedBy }) {
  const name = useId()
  return (
    <span className="oc-sx-seg" role="radiogroup" aria-label={label} aria-describedby={describedBy}>
      {options.map(([code, text]) => (
        <label key={code}>
          <input type="radio" name={name} value={code} checked={value === code} onChange={() => onChange(code)} />
          <span>{text}</span>
        </label>
      ))}
    </span>
  )
}
