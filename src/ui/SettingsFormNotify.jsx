import { host } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'

import {
  NOTIFY_TYPES, changeBody, cooldownUntil, hourChoices, previewOf, previewPieces, previewPlatform, quietSentence, sameForAll, sharedRoute,
  testState, testView, toggleRoute, typesWithoutRoute
} from '../core/notify.js'
import { sendTest, useNotify, useSaveNotify } from '../data/notify.js'
import { held, hold } from './hold.js'
import { SectionTitle, SettingsIcon, SettingsRow, Switch } from './SettingsKit.jsx'
import { CARD, FIELD_EDGE, FIELD_RADIUS } from './tokens.js'
import { useT } from './useT.js'

const MESSAGING_PATH = '/messaging'   // Hermes' page of the messaging apps (apps/desktop MESSAGING_ROUTE): the connection is made there, never here

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

const canOpenHermes = () => typeof host?.navigate === 'function'

/** A recipient as the form says it everywhere: its platform and the masked label Hermes gives (never a chat id). */
const whoOf = (t, target) => t('notify.targetLabel', target.platform, target.label)

/** A choice among a few words, many at once: a real checkbox per word, drawn as a chip (keyboard, state and label for free). */
function Chip({ checked, disabled = false, busy = false, onChange, title, children, ...rest }) {
  return (
    <label className="oc-nt-chip" title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} {...held(busy)} onChange={hold(busy, event => onChange(event.target.checked))} {...rest} />
      <span>{children}</span>
    </label>
  )
}

const GLYPH_ICON = { decision: 'pause', silent: 'mute', gateway: 'bolt', cron: 'clock', campaign: 'rocket', review: 'back', llm_cap: 'card', trophy: 'cup', quiet: 'moon' }

/**
 * The message as the page draws it: the parts the platform sets in bold are <b>, and the symbol of each kind of fact (an emoji in the
 * real message) is a line icon: no emoji in the interface, and nothing missing on a machine that has no emoji font.
 */
function Bubble({ text, ...rest }) {
  return (
    <p className="oc-nt-bubble" {...rest}>
      {previewPieces(text).map(([piece, bold, glyph], i) => {
        if (glyph) return <span key={i} className="oc-nt-gl" data-glyph={glyph}><SettingsIcon id={GLYPH_ICON[glyph]} size={16} /></span>
        return bold ? <b key={i}>{piece}</b> : <span key={i}>{piece}</span>
      })}
    </p>
  )
}

/** Ticks once a second while `until` is in the future (the minute between two tests), then stops: no timer when nothing is waiting. */
function useNow(until) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!(until > Date.now())) return undefined
    const id = setInterval(() => {
      const at = Date.now()
      setNow(at)
      if (at >= until) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [until])
  return now
}

/**
 * The « Notifications » tab of the settings form (shared by the gear and Hermes' settings page). Kept ON THE
 * SERVER: the gateway reads it with no page open. Everything is off until the user turns it on; a recipient is chosen among those Hermes
 * already knows (never typed, never a chat id). Recipients (with a test each), one row per type (switch + recipients), the quiet
 * hours, and the preview of the message as it will go. A change posts the whole board and shows what the server answered.
 */
export function SettingsFormNotify() {
  const t = useT()
  const query = useNotify()
  const save = useSaveNotify()
  const [state, setState] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [tests, setTests] = useState({})
  const [cool, setCool] = useState(0)
  const now = useNow(Math.max(cool, ...Object.values(tests).map(s => (s?.kind === 'wait' ? s.until : 0))))
  useEffect(() => { if (query.data) setState(query.data) }, [query.data])
  // a refused save looks like a warning and comes into view
  const errorRef = useRef(null)
  useEffect(() => { if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [error])

  const title = <SectionTitle label={t('notify.title')} where="server" />
  if (query.isError) return <>{title}<p className="oc-sx-warn" data-notify-unavailable>{t('notify.unavailable')}</p></>
  if (!state) return title

  const apply = async change => {
    if (saving) return   // one save at a time (the controls stay focusable while it is out, see hold.js)
    setSaving(true)
    setError(null)
    const res = await save(changeBody(state, change, t.lang))
    setSaving(false)
    if (res.ok) setState(res.state)
    else setError(res.reason)
  }

  const runTest = async key => {
    setTests(s => ({ ...s, [key]: { kind: 'sending' } }))
    const answer = await sendTest(key)
    const at = Date.now()
    const next = testState(answer, at)
    setTests(s => ({ ...s, [key]: next }))
    // a test that reached the sender counts for the minute, whoever it was for: every button waits
    if (next.kind === 'sent' || answer.reason === 'send_failed') setCool(cooldownUntil(at))
    else if (next.kind === 'wait') setCool(next.until)
  }

  const typeName = type => t(`notify.type.${type}`)
  const noRoute = typesWithoutRoute(state)
  const shared = sharedRoute(state)
  const allEmpty = NOTIFY_TYPES.every(type => state.routes[type].length === 0)
  const words = Object.fromEntries(['mark', 'board', 'decision', 'silent', 'cron', 'campaign', 'review', 'trophy'].map(k => [k, t(`notify.sample.${k}`)]))
  const preview = previewOf(state, t.lang, words, previewPlatform(state))
  const quiet = state.quiet
  const sentence = quietSentence(quiet)
  const zone = state.timezone ? `${state.timezone.name} ${state.timezone.offset}`.trim() : null
  const urgentNames = sentence ? sentence.urgent.map(type => typeName(type).toLocaleLowerCase(t.lang)).join(', ') : ''

  const lastLine = target => {
    const last = state.lastBy[target.key]
    return last?.at ? `${t('notify.last', last.success, last.count)} · ${t.ago(last.at * 1000)}` : null
  }
  const testLine = view => {
    if (!view.line) return null
    const { key } = view.line
    if (key === 'sent') return t('notify.tested.sent', new Date(view.line.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    if (key === 'wait') return t('notify.tested.wait', view.line.seconds)
    return t(`notify.tested.${key}`)
  }

  return (
    <div data-notify>
      <SectionTitle label={t('notify.title')} where="server" tip={t('notify.hint', state.cap)} />

      <h4 className="oc-nt-sub" data-notify-recipients>{t('notify.recipients')}</h4>
      {state.targets.map((target, i) => {
        const view = testView(tests[target.key], now, cool)
        const failed = tests[target.key]?.kind === 'error'
        return (
          <SettingsRow key={target.key} id={`officecraft-notify-test-${i}`} label={whoOf(t, target)} help={testLine(view) || lastLine(target)} helpRole={failed ? 'alert' : 'status'}
            control={({ id, describedBy }) => (
              <button id={id} type="button" className="oc-sx-btn" data-notify-test={target.key} aria-describedby={describedBy} aria-disabled={view.disabled}
                aria-label={t(view.busy ? 'notify.testingFor' : 'notify.testFor', whoOf(t, target))} onClick={() => { if (!view.disabled) runTest(target.key) }}>
                {view.busy ? t('notify.testing') : t('notify.test')}
              </button>
            )} />
        )
      })}
      {state.targets.length > 0 ? (
        <SettingsRow id="officecraft-notify-all" label={t('notify.sameForAll')} help={t('notify.sameForAllHint')}
          control={({ id, describedBy }) => (
            <select id={id} className="oc-fc" data-notify-all aria-describedby={describedBy} value={shared ?? (allEmpty ? '' : '__mixed')} {...held(saving)} style={selectStyle}
              onChange={hold(saving, event => apply({ routes: sameForAll(event.target.value || null) }))}>
              {!shared && !allEmpty ? <option value="__mixed" disabled>{t('notify.mixed')}</option> : null}
              <option value="">{t('notify.noneChosen')}</option>
              {state.targets.map(target => <option key={target.key} value={target.key}>{whoOf(t, target)}</option>)}
            </select>
          )} />
      ) : null}
      <SettingsRow id="officecraft-notify-add" group label={state.targets.length === 0 ? t('notify.noTarget') : state.targets.length === 1 ? t('notify.oneRecipient') : t('notify.addAppNote')}
        help={state.targets.length < 2 ? t('notify.addAppNote') : null} helpRole={state.targets.length === 0 ? 'status' : undefined}
        control={() => (canOpenHermes() ? (
          <button type="button" className="oc-sx-link" data-notify-add onClick={() => host.navigate(MESSAGING_PATH)}>
            {t('notify.addApp')}
            <SettingsIcon id="ext" size={14} />
          </button>
        ) : null)} />

      <h4 className="oc-nt-sub">{t('notify.types')}</h4>
      {NOTIFY_TYPES.map(type => (
        <div key={type} className="oc-sx-row oc-nt-type" data-notify-type={type} data-on={state.types[type]}>
          <div className="oc-sx-lab">
            <span className="oc-sx-name"><label htmlFor={`officecraft-notify-${type}`}>{typeName(type)}</label></span>
            <small id={`officecraft-notify-${type}-help`}>{t(`notify.typeHint.${type}`)}</small>
          </div>
          <div className="oc-sx-ctl">
            <Switch id={`officecraft-notify-${type}`} describedBy={`officecraft-notify-${type}-help`} checked={state.types[type]} {...held(saving)} onChange={hold(saving, checked => apply({ types: { [type]: checked } }))} />
          </div>
          {state.targets.length > 0 ? (
            <div className="oc-nt-chips" role="group" aria-label={`${typeName(type)}: ${t('notify.recipients')}`}>
              {state.targets.map(target => {
                const on = state.routes[type].includes(target.key)
                const full = !on && state.routes[type].length >= state.max
                return (
                  <Chip key={target.key} checked={on} disabled={full} busy={saving} title={full ? t('notify.maxRoutes', state.max) : undefined} data-notify-route={`${type}:${target.key}`}
                    onChange={() => apply({ routes: { [type]: toggleRoute(state, type, target.key) } })}>
                    {whoOf(t, target)}
                  </Chip>
                )
              })}
            </div>
          ) : null}
          {noRoute.includes(type) ? <p className="oc-sx-warn" role="status" data-notify-noroute={type}>{t('notify.noRoute')}</p> : null}
        </div>
      ))}

      <h4 className="oc-nt-sub" data-notify-quiet-title>{t('notify.quiet.title')}</h4>
      <SettingsRow id="officecraft-notify-quiet" label={t('notify.quiet.on')} help={t('notify.quiet.onHint')}
        control={({ id, describedBy }) => <Switch id={id} describedBy={describedBy} checked={quiet.enabled} {...held(saving)} onChange={hold(saving, checked => apply({ quiet: { enabled: checked } }))} />} />
      {quiet.enabled ? (
        <>
          <SettingsRow id="officecraft-notify-range" group label={t('notify.quiet.range')} help={zone ? t('notify.quiet.clock', zone) : null}
            control={({ describedBy }) => (
              <>
                <select id="officecraft-notify-quiet-start" className="oc-fc" data-quiet-start aria-label={t('notify.quiet.start')} aria-describedby={describedBy} value={quiet.from} {...held(saving)}
                  onChange={hold(saving, event => apply({ quiet: { from: event.target.value } }))} style={selectStyle}>
                  {hourChoices(quiet.from).map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <span className="oc-sx-arrow" aria-hidden="true">→</span>
                <select id="officecraft-notify-quiet-end" className="oc-fc" data-quiet-end aria-label={t('notify.quiet.end')} aria-describedby={describedBy} value={quiet.to} {...held(saving)}
                  onChange={hold(saving, event => apply({ quiet: { to: event.target.value } }))} style={selectStyle}>
                  {hourChoices(quiet.to).map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </>
            )} />
          <div className="oc-sx-row">
            <div className="oc-sx-lab">
              <span className="oc-sx-name"><span id="officecraft-notify-urgent-name">{t('notify.quiet.urgent')}</span></span>
              <small>{t('notify.quiet.urgentHint')}</small>
            </div>
            <div className="oc-nt-chips" role="group" aria-labelledby="officecraft-notify-urgent-name">
              {NOTIFY_TYPES.map(type => (
                <Chip key={type} checked={quiet.urgent.includes(type)} busy={saving} data-notify-urgent={type}
                  onChange={checked => apply({ quiet: { urgent: checked ? [...quiet.urgent, type] : quiet.urgent.filter(x => x !== type) } })}>
                  {typeName(type)}
                </Chip>
              ))}
            </div>
          </div>
          <p className="oc-nt-sum" role="status" data-notify-quiet-sentence>
            <SettingsIcon id="moon" size={16} />
            <span>{sentence ? t('notify.quiet.summary', sentence.from, sentence.to, urgentNames) : t('notify.quiet.empty')}</span>
          </p>
        </>
      ) : null}

      <h4 className="oc-nt-sub" data-notify-preview-title>{t('notify.preview.title')}</h4>
      {preview ? (
        <div data-notify-preview-box>
          <Bubble text={preview.text} data-notify-preview lang={t.lang} />
          {preview.quietText ? (
            <>
              <p className="oc-nt-cap">{t('notify.preview.summary')}</p>
              <Bubble text={preview.quietText} data-notify-preview-quiet lang={t.lang} />
            </>
          ) : null}
          <p className="oc-nt-cap">{t('notify.preview.note')}</p>
        </div>
      ) : <p className="oc-nt-cap" data-notify-preview-empty>{t('notify.preview.empty')}</p>}

      {error ? <p ref={errorRef} className="oc-sx-warn" role="alert" data-notify-error>{t(error === 'unknown_target' ? 'notify.unknownTarget' : 'notify.saveFailed')}</p> : null}
    </div>
  )
}
