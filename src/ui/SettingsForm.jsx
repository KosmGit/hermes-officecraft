import { useValue } from '@hermes/plugin-sdk'
import { useEffect, useId, useState } from 'react'

import { LIGHT_PREFS, MOTION_PREFS } from '../core/daylight.js'
import { SUPPORTED_LOCALES, resolveLocale } from '../core/locale.js'
import { SETTINGS_TABS, llmTabBadge, tabAfterKey, tabOf } from '../core/settings.js'
import { notifyTabBadge } from '../core/notify.js'
import { useLlm } from '../data/llm.js'
import { useNotify } from '../data/notify.js'
import { $gameMode, $languagePref, $lightPref, $motionPref, $nightPref, setGameMode, setLanguagePref, setLightPref, setMotionPref, setNightPref } from '../data/prefs.js'
import { ENDONYMS } from '../i18n/index.js'
import { SettingsFormLlm } from './SettingsFormLlm.jsx'
import { SettingsFormNotify } from './SettingsFormNotify.jsx'
import { Segmented, SettingsIcon, SettingsRow, Switch, WhereLine } from './SettingsKit.jsx'
import { SETTINGS_CSS } from './settingsStyles.js'
import { CARD, FIELD_CSS, FIELD_EDGE, FIELD_RADIUS } from './tokens.js'
import { systemLocales, useAppLocale, useT } from './useT.js'

const selectStyle = {
  font: 'inherit',
  height: '32px',
  padding: '0 8px',
  maxWidth: '100%',
  borderRadius: FIELD_RADIUS,
  color: 'var(--foreground)',
  background: CARD,
  border: `1px solid ${FIELD_EDGE}`
}
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const TAB_ICON = { general: 'globe', notify: 'bell', llm: 'spark' }

/** The tab last used, for the next opening in this session (not a preference: nothing is stored, so no key to keep compatible). */
let lastTab = SETTINGS_TABS[0]

/**
 * The Officecraft settings, written once: Settings → Plugins → Officecraft renders it (SettingsPage) and so does the gear of the
 * page (SettingsGear). Tabs instead of one long scroll (General, with its Display, Game and Replay parts; Notifications; LLM functions:
 * each one click away, none under another), one line of help per setting, the rest behind its « ? ». With src/data/prefs.js, the only place that writes a
 * preference. The tabs sit on the side when the form is wide and on top when it is narrow (a container query: same component in the
 * gear's window and in Hermes' settings page).
 */
export function SettingsForm({ llm = null }) {
  const t = useT()
  const base = useId()
  const [tab, setTabState] = useState(() => tabOf(lastTab))
  const setTab = next => { lastTab = next; setTabState(next) }
  const pref = useValue($languagePref)
  const game = useValue($gameMode)
  const light = useValue($lightPref)
  const motion = useValue($motionPref)
  const night = useValue($nightPref)
  const detected = resolveLocale('auto', useAppLocale(), systemLocales())
  const counts = { llm: llmTabBadge(useLlm()), notify: notifyTabBadge(useNotify()) }
  // on a narrow strip (it scrolls) the chosen tab is brought into view
  useEffect(() => { document.getElementById(`${base}-tab-${tab}`)?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' }) }, [base, tab])

  const onKeyDown = event => {
    const next = tabAfterKey(tab, event.key)
    if (!next) return
    event.preventDefault()
    setTab(next)
    document.getElementById(`${base}-tab-${next}`)?.focus()
  }

  return (
    <div className="oc-sf" data-settings-form data-motion={motion} lang={t.lang}>
      <style>{FIELD_CSS}</style>
      <style>{SETTINGS_CSS}</style>
      <div className="oc-sf-in">
        <div className="oc-sf-nav" role="tablist" aria-orientation="vertical" aria-label={t('settings.tabs')} onKeyDown={onKeyDown}>
          {SETTINGS_TABS.map(code => (
            <button key={code} id={`${base}-tab-${code}`} type="button" role="tab" className="oc-sf-tab" data-set-tab={code} title={t(`settings.tab.${code}`)}
              aria-selected={tab === code} aria-controls={`${base}-panel`} tabIndex={tab === code ? 0 : -1} onClick={() => setTab(code)}>
              <SettingsIcon id={TAB_ICON[code]} />
              <span className="oc-sf-lb">{t(`settings.tab.${code}`)}</span>
              {counts[code] ? <span className="oc-sf-bd" {...{ [`data-${code}-count`]: '' }}>{`${counts[code].on}/${counts[code].of}`}</span> : null}
            </button>
          ))}
        </div>
        <div id={`${base}-panel`} className="oc-sf-panel" role="tabpanel" tabIndex={0} aria-labelledby={`${base}-tab-${tab}`} data-settings-tab={tab}>
          {tab === 'general' ? (
            <>
              <WhereLine where="local" />
              <h3 className="oc-sf-sec" data-sec="display">{t('settings.sec.display')}</h3>
              <SettingsRow id="officecraft-language" label={t('settings.language')} help={t('settings.languageHint')}
                control={({ id, describedBy }) => (
                  <select id={id} className="oc-fc" aria-describedby={describedBy} value={pref} onChange={event => setLanguagePref(event.target.value)} style={selectStyle}>
                    <option value="auto">{t('settings.auto', ENDONYMS[detected])}</option>
                    {SUPPORTED_LOCALES.map(code => (
                      <option key={code} value={code} lang={code}>
                        {ENDONYMS[code]}
                      </option>
                    ))}
                  </select>
                )} />
              <SettingsRow id="officecraft-light" group label={t('settings.light')} help={t('settings.lightHint')}
                control={({ describedBy }) => (
                  <Segmented label={t('settings.light')} describedBy={describedBy} value={light} onChange={setLightPref}
                    options={LIGHT_PREFS.map(code => [code, t(`settings.light${code[0].toUpperCase()}${code.slice(1)}`)])} />
                )} />
              <SettingsRow id="officecraft-motion" group label={t('settings.motion')} help={t('settings.motionHint')} tip={t('settings.motionTip')}
                control={({ describedBy }) => (
                  <Segmented label={t('settings.motion')} describedBy={describedBy} value={motion} onChange={setMotionPref}
                    options={MOTION_PREFS.map(code => [code, t(`settings.motion${code[0].toUpperCase()}${code.slice(1)}`)])} />
                )} />
              <h3 className="oc-sf-sec" data-sec="game">{t('settings.sec.game')}</h3>
              <SettingsRow id="officecraft-game" label={t('settings.gameOn')} help={t('settings.gameHint')} tip={t('settings.gameTip')}
                control={({ id, describedBy }) => <Switch id={id} describedBy={describedBy} checked={game} onChange={setGameMode} />} />
              <h3 className="oc-sf-sec" data-sec="replay">{t('settings.sec.replay')}</h3>
              <SettingsRow id="officecraft-night" group label={t('settings.night')} help={t('settings.nightHint')} tip={t('settings.nightTip')}
                control={({ describedBy }) => (
                  <>
                    <select id="officecraft-night-start" className="oc-fc" data-night-start aria-label={t('settings.nightFrom')} aria-describedby={describedBy} value={night.from}
                      onChange={event => setNightPref({ from: Number(event.target.value), to: night.to })} style={selectStyle}>
                      {HOURS.map(h => <option key={h} value={h}>{t('settings.nightHour', h)}</option>)}
                    </select>
                    <span className="oc-sx-arrow" aria-hidden="true">→</span>
                    <select id="officecraft-night-end" className="oc-fc" data-night-end aria-label={t('settings.nightTo')} aria-describedby={describedBy} value={night.to}
                      onChange={event => setNightPref({ from: night.from, to: Number(event.target.value) })} style={selectStyle}>
                      {HOURS.map(h => <option key={h} value={h}>{t('settings.nightHour', h)}</option>)}
                    </select>
                  </>
                )} />
            </>
          ) : null}

          {tab === 'notify' ? <SettingsFormNotify /> : null}

          {tab === 'llm' ? <SettingsFormLlm actions={llm} /> : null}
        </div>
      </div>
    </div>
  )
}
