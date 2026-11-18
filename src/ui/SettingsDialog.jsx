import * as sdk from '@hermes/plugin-sdk'
import { useEffect, useId, useRef } from 'react'

import { $motionPref } from '../data/prefs.js'
import { escapeCloses } from './dialogKeys.js'
import { SettingsForm } from './SettingsForm.jsx'
import { SettingsIcon } from './SettingsKit.jsx'
import { SETTINGS_CSS } from './settingsStyles.js'
import { useT } from './useT.js'

/**
 * The gear's window (one frame, header / body / foot). A native modal <dialog>: the focus is trapped in it, the
 * page behind is inert, Escape closes it (read here too: under 900 px the host's webapp swallows the browser's own Escape).
 * The body is the very form Settings → Plugins → Officecraft shows. A « ? » that is open takes Escape first (it stops the key).
 * Mounted only while open, so nothing is read from the server for a window nobody opened.
 */
export function SettingsDialog({ onClose, llm = null, href = null, sheet = false }) {
  const t = useT()
  const ref = useRef(null)
  const id = useId()
  const motion = sdk.useValue($motionPref)
  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) { try { dlg.showModal() } catch { /* already open */ } }
    dlg.querySelector('[role="tab"][aria-selected="true"]')?.focus()
  }, [])
  return (
    <dialog ref={ref} className="oc-sd" aria-labelledby={`${id}-t`} data-settings-panel data-sheet={sheet ? '' : undefined} data-motion={motion}
      onCancel={e => { e.preventDefault(); onClose() }}
      onKeyDown={e => { if (escapeCloses(e)) { e.preventDefault(); e.stopPropagation(); onClose() } }}
      onClick={e => { if (e.target === ref.current) onClose() }}
      onClose={onClose}>
      <style>{SETTINGS_CSS}</style>
      <header className="oc-sd-h">
        <SettingsIcon id="gear" size={20} />
        <h2 id={`${id}-t`}>{t('settings.gear')}</h2>
        <button type="button" className="oc-sd-x" data-settings-close aria-label={t('settings.close')} onClick={onClose}><SettingsIcon id="x" /></button>
      </header>
      <div className="oc-sd-b">
        <SettingsForm llm={llm} />
      </div>
      <footer className="oc-sd-f">
        {href ? (
          <button type="button" className="oc-sx-link" data-settings-link onClick={() => { onClose(); sdk.host.navigate(href) }}>
            <SettingsIcon id="ext" size={14} />
            {t('settings.openInHermes')}
          </button>
        ) : null}
        <span className="grow" />
        <span className="oc-sd-saved">{t('settings.saved')}</span>
        <button type="button" className="oc-sx-btn" onClick={onClose}>{t('settings.close')}</button>
      </footer>
    </dialog>
  )
}
