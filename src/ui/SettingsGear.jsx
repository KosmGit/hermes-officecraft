import * as sdk from '@hermes/plugin-sdk'
import { useCallback, useRef, useState } from 'react'

import { PLUGIN_ID } from '../constants.js'
import { SettingsDialog } from './SettingsDialog.jsx'
import { useT } from './useT.js'

// A gear drawn as an SVG path (8 teeth), stroked with currentColor: no emoji, no colour literal.
function gearPath() {
  const pts = []
  const outer = 9.5
  const inner = 7
  const n = 8
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n
    const w = Math.PI / n
    for (const [da, rad] of [[-0.62 * w, inner], [-0.38 * w, outer], [0.38 * w, outer], [0.62 * w, inner]]) {
      pts.push([12 + Math.cos(a + da) * rad, 12 + Math.sin(a + da) * rad])
    }
  }
  return `M${pts.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L')}Z`
}
const GEAR = gearPath()

/**
 * The gear at the right of the header. Opens the settings in a window (SettingsDialog: tabs on the side, the same form as
 * Settings → Plugins → Officecraft). Escape, the close button, a click on the backdrop close it, and the focus returns to the gear. The
 * LLM buttons of the form (decorate, seating) open another window over the page, so this one closes first and does not take the focus back.
 */
export function SettingsGear({ sheet, llm = null }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const btn = useRef(null)
  const close = useCallback(() => {
    setOpen(false)
    setTimeout(() => btn.current?.focus(), 0)
  }, [])
  const hand = useCallback(fn => () => { setOpen(false); fn() }, [])
  const llmActions = llm ? { ...llm, onDecorate: llm.onDecorate ? hand(llm.onDecorate) : null, onSeating: llm.onSeating ? hand(llm.onSeating) : null } : null
  // not an invented path: the link only exists when this host exports pluginSettingsHref (checked in the installed SDK)
  const href = typeof sdk.pluginSettingsHref === 'function' ? sdk.pluginSettingsHref(PLUGIN_ID, 'settings') : null
  return (
    <span className="oc-gearwrap" data-settings>
      <button ref={btn} type="button" className="oc-gear" data-gear aria-haspopup="dialog" aria-expanded={open} title={t('settings.gearTip')} aria-label={t('settings.gear')} onClick={() => setOpen(v => !v)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <path d={GEAR} />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
      </button>
      {open ? <SettingsDialog onClose={close} llm={llmActions} href={href} sheet={sheet} /> : null}
    </span>
  )
}
