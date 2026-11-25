import { useEffect, useId, useRef, useState } from 'react'

import { legendRows } from '../core/hud.js'
import { RECENT_WINDOW_MS, WORKER_LIVE_WINDOW_MS } from '../core/roster.js'
import { STALE_AFTER_MS } from '../core/office.js'
import { HALO } from '../scene/furniture.js'
import { Icon } from './icons.jsx'
import { StateIcon } from './StateIcon.jsx'
import { useT } from './useT.js'

/** A halo colour as a 10 px round swatch, painted pixel by pixel from the scene's own RGB triple (no colour string: the UI keeps to theme variables). */
function Swatch({ rgb }) {
  const ref = useRef(null)
  useEffect(() => {
    const g = ref.current?.getContext('2d')
    if (!g || !rgb) return
    const img = g.createImageData(10, 10)
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const d = Math.hypot(x - 4.5, y - 4.5)
        const i = (y * 10 + x) * 4
        const edge = d > 3.4 && d <= 4.9   // lighter rim: the halo is a soft disc on the floor
        img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]
        img.data[i + 3] = d > 4.9 ? 0 : edge ? 150 : 255
      }
    }
    g.putImageData(img, 0, 0)
  }, [rgb])
  if (!rgb) return <span className="oc-sw oc-sw-none" aria-hidden="true" />
  return <canvas ref={ref} className="oc-sw" width={10} height={10} aria-hidden="true" data-rgb={rgb.join(',')} />
}

/** « Legend », a named button at the end of the dock (the « ? » is the sign of a field's help): opens the legend of the halos (what each colour says), closed again by Escape, a second click or leaving it. */
export function Legend() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef(null)
  const rows = legendRows(HALO, { workingMs: WORKER_LIVE_WINDOW_MS, staleMs: STALE_AFTER_MS, activeMs: RECENT_WINDOW_MS })
  useEffect(() => {
    if (!open) return undefined
    // in the capture phase, ahead of the page's own Escape listener (the replay leaves on Escape): the legend takes the key, and says so
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); wrap.current?.querySelector('button')?.focus() } }
    const onDown = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false) }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown)
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown) }
  }, [open])
  return (
    <span className="oc-legend" ref={wrap} data-legend>
      <button type="button" className="oc-legend-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}><Icon name="info" size={14} /><span>{t('legend.button')}</span></button>
      {open ? (
        <div id={id} className="oc-legend-pop" role="group" aria-label={t('legend.title')}>
          <b>{t('legend.title')}</b>
          <ul>
            {rows.map(r => (
              <li key={r.state} data-legend-state={r.state}>
                <Swatch rgb={r.rgb} />
                <span className="oc-lg-sti"><StateIcon state={r.state} /></span>
                <span className="oc-lg-name">{t(`state.${r.state}`)}</span>
                <span className="oc-lg-hint">{r.arg == null ? t(r.hint) : t(r.hint, r.arg)}</span>
              </li>
            ))}
            <li data-legend-sign="wait">
              <span aria-hidden="true" />
              <span className="oc-lg-sti oc-lg-wait"><StateIcon state="waiting" /></span>
              <span className="oc-lg-name">{t('legend.waitName')}</span>
              <span className="oc-lg-hint">{t('legend.waitSign')}</span>
            </li>
          </ul>
        </div>
      ) : null}
    </span>
  )
}
