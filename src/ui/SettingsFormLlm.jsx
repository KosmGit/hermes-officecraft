import { newId as randomUuid } from '../data/uuid.js'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { capReached, costKind, formatUsd, outfitsBody, parseCap, settingsBody, spendView } from '../core/llm.js'
import { modelChoices, pickFromValue, settingsView, shortModel } from '../core/llmSettings.js'
import { ringDash } from '../core/settings.js'
import { artBody } from '../core/wallart.js'
import { useLlm, useLlmActions } from '../data/llm.js'
import { held, hold } from './hold.js'
import { useModelOptions } from './ModelPicker.jsx'
import { HelpTip, SettingsIcon, Switch, WhereLine } from './SettingsKit.jsx'
import { useT } from './useT.js'

const STATE_TONE = { off: 'off', ready: 'ok', unavailable: 'warn', outdated: 'warn', cap: 'warn', error: 'warn' }
const GAUGE_R = 34

/** « Last call » line of one function: what Hermes estimated, said as an estimate, never as a bill. */
function lastLine(state, feature, t) {
  const c = state.costs[feature]
  if (!c?.status) return ''
  if (c.status === 'error') return t('llm.lastError')
  if ((c.status === 'estimated' || c.status === 'actual') && c.lastUsd != null) return t('llm.lastKnown', formatUsd(c.lastUsd, t.lang))
  return t('llm.lastUnknown')
}

/**
 * The month's spend as a ring (the cap that counts: dollars when the price is known, calls otherwise). The colour never carries it alone:
 * the figure is in the middle and the sentence is the meter's text.
 */
function Gauge({ pct, hit, value, of, label, text }) {
  const { length, offset } = ringDash(pct, GAUGE_R)
  return (
    <svg className="oc-sx-gauge" viewBox="0 0 88 88" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-valuetext={text} data-hit={hit ? 'true' : 'false'}>
      <circle className="bg" cx="44" cy="44" r={GAUGE_R} />
      <circle className="fg" cx="44" cy="44" r={GAUGE_R} strokeDasharray={length} strokeDashoffset={offset} />
      <text x="44" y="40" textAnchor="middle" dominantBaseline="middle">{value}</text>
      <text className="u" x="44" y="56" textAnchor="middle" dominantBaseline="middle">{of}</text>
    </svg>
  )
}

/** The model a function will take, as a chip: its lane and the model, or Hermes' own when there is no grant (the lane says which task to set). */
function LaneChip({ row, t }) {
  const r = row.route
  const lane = t(`llm.lane.${row.lane}`)
  const host = r.kind !== 'model'
  const tip = host ? t('llm.chipTipHost', row.lane) : t('llm.chipTip', lane, r.model)
  return (
    <span className={`oc-lm-lane ${row.lane}${host ? ' host' : ''}`} title={tip} data-llm-route={host ? 'host' : 'model'} data-lane={row.lane}>
      <i aria-hidden="true" />{t('llm.chip', lane, host ? t('llm.chipHost') : shortModel(r.model))}
    </span>
  )
}

/**
 * One of the two lists (strong, light): « the one of Hermes » or a model of the list Hermes gave for the recruitment (`model.options`, grouped
 * by provider). Greyed without the grant. A choice that is not in the list (a provider removed, a list that could not be read) is still shown
 * and kept: the list never empties it in silence. Nothing typed: a pair is always one of the rows.
 */
function ModelSelect({ lane, sel, choices, busy, onPick, tipped }) {
  const t = useT()
  const id = useId()
  const groups = []
  choices.forEach((c, i) => {
    let g = groups.find(x => x.provider === c.provider)
    if (!g) { g = { provider: c.provider, name: c.providerName, items: [] }; groups.push(g) }
    g.items.push({ ...c, i })
  })
  return (
    <div className={`oc-lm-mod${sel.disabled ? ' dis' : ''}`} data-llm-lane={lane}>
      <span className="oc-lm-modh">
        <label htmlFor={`${id}-s`}>{t(`llm.models.${lane}.name`)}</label>
        {tipped ? (
          <HelpTip name={t('llm.models.help')}>
            <p><b>{t('llm.models.strong.short')}</b> : {t('llm.models.tipStrong')} <b>{t('llm.models.light.short')}</b> : {t('llm.models.tipLight')}</p>
            <p>{t('llm.models.tipOne')}</p>
          </HelpTip>
        ) : null}
      </span>
      <select id={`${id}-s`} className="oc-lm-sel oc-fc" data-llm-model={lane} value={sel.selected} disabled={sel.disabled} {...held(busy)} aria-describedby={`${id}-u`}
        onChange={hold(busy, e => { const pick = pickFromValue(e.target.value, choices); if (pick !== undefined) onPick(lane, pick) })}>
        <option value="hermes">{t('llm.models.hermes')}</option>
        {sel.stored ? <option value="stored">{t('llm.models.stored', shortModel(sel.pick.model), sel.pick.provider)}</option> : null}
        {groups.map(g => (
          <optgroup key={g.provider} label={g.name}>
            {g.items.map(c => <option key={c.i} value={String(c.i)}>{c.name}</option>)}
          </optgroup>
        ))}
      </select>
      <small id={`${id}-u`}>{t(`llm.models.${lane}.use`)}</small>
    </div>
  )
}

/**
 * The « LLM functions » tab of the settings form (shared by the gear and Hermes' settings page). On top: the month's
 * gauge and the two models (strong, light), « the one of Hermes » by default, chosen from the list the recruitment reads (`model.options`);
 * greyed, with the way to grant it, when Hermes has not given the agreement (`GET /llm` `override`). Below: the ten functions in two groups
 * (work, decor), each with its state, ONE line « Sends: … », the model it will take, its « ? » (what it does, what is sent in full, what it
 * costs) and its switch; the button of a function sits in its row when it is on and ready. All OFF until the user turns one on. Switches,
 * models, caps and spend live ON THE SERVER (several browsers, the Desktop app).
 * `actions` (only the page's gear gives it): { skip: profiles whose role was chosen by hand, onDecorate / onSeating: open a window,
 * pendingArt }. Nothing here calls a model on its own: the buttons are the gestures.
 */
export function SettingsFormLlm({ actions = null }) {
  const t = useT()
  const query = useLlm()
  const { save, call } = useLlmActions()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [running, setRunning] = useState(null)   // 'outfits' / 'art' while its call is out
  const [outcome, setOutcome] = useState(null)   // { feature, answer } of the last call made from here
  const [usdText, setUsdText] = useState('')
  const [callsText, setCallsText] = useState('')
  const [copied, setCopied] = useState(false)
  const state = query.data ?? null
  // the list of models is read only when it can be used (the agreement is given): never for greyed lists
  const modelOpts = useModelOptions(state?.override === 'granted')
  const list = useMemo(() => modelChoices(modelOpts), [modelOpts])
  const errorRef = useRef(null)
  const id = useId()
  // the caps are text fields until they are committed (blur or Enter); they follow the server's value when it changes
  useEffect(() => {
    if (!state) return
    setUsdText(String(state.settings.capUsd))
    setCallsText(String(state.settings.callCap))
  }, [state?.settings.capUsd, state?.settings.callCap])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [error])

  const title = <WhereLine where="server" name={t('llm.title')} tip={t('llm.hint')} />
  // an agent half without the routes (older, or not restarted): nothing LLM at all, said once
  if (query.isError) return <>{title}<p className="oc-sx-warn" data-llm-unavailable>{t('llm.unavailable')}</p></>
  if (!state) return title

  const apply = async change => {
    if (saving) return   // one save at a time: a second gesture while one is out is dropped (the controls stay focusable, see hold.js)
    setSaving(true)
    setError(null)
    const res = await save(settingsBody(state, change))
    setSaving(false)
    if (!res.ok) setError('saveFailed')
  }
  const commit = (kind, text) => {
    const n = parseCap(text, kind)
    if (n == null) {
      setError('capInvalid')
      setUsdText(String(state.settings.capUsd))
      setCallsText(String(state.settings.callCap))
      return
    }
    setError(null)
    if (kind === 'calls' ? n !== state.settings.callCap : n !== state.settings.capUsd) apply(kind === 'calls' ? { callCap: n } : { capUsd: n })
  }
  const paint = async () => {
    const body = artBody(randomUuid(), actions?.pendingArt ?? [], t.lang)
    if (!body) return
    setRunning('art')
    setOutcome(null)
    const answer = await call('/llm/art', body)
    setRunning(null)
    setOutcome({ feature: 'art', answer })
  }
  const dress = async () => {
    setRunning('outfits')
    setOutcome(null)
    const answer = await call('/llm/outfits', outfitsBody(randomUuid(), actions?.skip ?? [], t.lang))
    setRunning(null)
    setOutcome({ feature: 'outfits', answer })
  }

  const view = settingsView(state, list, outcome ? { [outcome.feature]: outcome.answer } : {})
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(view.command)
      setCopied(true)
    } catch { setCopied(false) }
  }
  const spend = spendView(state)
  const capHit = view.on > 0 ? capReached(state, 'decor') : null
  const usdLabel = formatUsd(spend.usd, t.lang)
  const capLabel = formatUsd(spend.capUsd, t.lang)
  const inUsd = spend.mode === 'usd'

  // a plain function (not a component): its « ? » keeps its open state across the form's renders
  const renderRow = row => {
    const f = row.key
    const st = row.state
    const hit = row.cap
    const last = lastLine(state, f, t)
    const done = outcome?.feature === f ? outcome.answer : null
    const name = t(`llm.f.${f}.name`)
    let action = null
    if (f === 'decor' && actions?.onDecorate && st === 'ready') action = <button type="button" className="oc-sx-btn" data-llm-open-decor onClick={actions.onDecorate}>{t('llm.decor.open')}</button>
    else if (f === 'outfits' && actions && st === 'ready') action = <button type="button" className="oc-sx-btn" data-llm-run-outfits aria-disabled={running ? true : undefined} onClick={() => { if (!running) dress() }}>{running ? t('llm.outfits.running') : t('llm.outfits.run')}</button>
    else if (f === 'art' && actions && st === 'ready') {
      action = actions.pendingArt?.length
        ? <button type="button" className="oc-sx-btn" data-llm-run-art aria-disabled={running ? true : undefined} onClick={() => { if (!running) paint() }}>{running === 'art' ? t('llm.art.running') : t('llm.art.run', actions.pendingArt.length)}</button>
        : <small data-llm-art-none>{t('llm.art.none')}</small>
    } else if (f === 'seating' && actions?.onSeating && st === 'ready') action = <button type="button" className="oc-sx-btn" data-llm-open-seating onClick={actions.onSeating}>{t('llm.seating.open')}</button>
    const status = done ? (done.kind === 'done' ? (f === 'art' ? t('llm.art.done', done.fiche?.posters?.length ?? 0) : t('llm.outfits.done', done.fiche?.outfits?.length ?? 0)) : t(`llm.reason.${done.reason}`)) : ''
    const cost = done && costKind(done) === 'known' ? ` ${t('llm.decor.costKnown', formatUsd(done.costUsd, t.lang))}` : done && costKind(done) === 'unknown' ? ` ${t('llm.decor.costUnknown')}` : ''
    // « no model » is said once, at the top of the tab (`data-llm-nomodel`), not under every row
    const warn = st === 'cap' && hit ? t(`llm.capReached.${hit}`) : st === 'error' && !done ? t('llm.lastError') : ''
    // a switch that is off says so by itself; a state the whole group shares is said once by the group (the row is only dimmed)
    const pill = st !== 'off' && !row.quiet
    return (
      <div key={f} className="oc-lm-row" role="group" aria-label={name} data-llm-feature={f} data-state={st} data-on={row.on ? 'true' : 'false'} data-quiet={row.quiet ? 'true' : undefined}>
        <span className="oc-lm-mc">
          <span className="oc-sx-name">
            <label htmlFor={`${id}-${f}`} id={`${id}-${f}-n`}>{name}</label>
            {pill ? <span className="oc-sx-state" data-tone={STATE_TONE[st]} data-llm-state id={`${id}-${f}-s`}>{t(`llm.state.${st}`)}</span> : null}
          </span>
          <small id={`${id}-${f}-d`} data-llm-sends>{t('llm.sends', t(`llm.f.${f}.sends`))}<span className="oc-lm-calls" data-llm-calls> · {t(`llm.f.${f}.calls`)}</span></small>
        </span>
        <span className="oc-lm-lc">{row.chip ? <LaneChip row={row} t={t} /> : null}</span>
        <span className="oc-lm-ac">{action}</span>
        <span className="oc-lm-ctl">
          <HelpTip name={name}>
            <p>{t(`llm.f.${f}.what`)}</p>
            <p>{t('llm.sendsLine', t(`llm.f.${f}.detail`))}</p>
            <p data-llm-cost>{t('llm.cost', t(`llm.f.${f}.cost`))}{last ? ` ${last}` : ''}</p>
            {f === 'thoughts' ? <p>{t('llm.thoughts.note')}</p> : null}
          </HelpTip>
          <Switch id={`${id}-${f}`} labelledBy={`${id}-${f}-n`} describedBy={pill ? `${id}-${f}-s ${id}-${f}-d` : `${id}-${f}-d`} checked={row.on} disabled={!row.switchable} {...held(saving)}
            onChange={hold(saving, checked => apply({ features: { [f]: checked } }))} data-llm-switch={f} />
        </span>
        <span className="oc-lm-fx">
          {warn ? <span className="oc-sx-warn" role="status" data-llm-cap={st === 'cap' ? hit : undefined} data-llm-error={st === 'error' ? '' : undefined}>{warn}</span> : null}
          <span role="status" aria-live="polite" data-llm-outcome={f}>{status}{cost}</span>
        </span>
      </div>
    )
  }

  return (
    <div data-llm data-llm-override={view.override}>
      {title}
      <p className="oc-lm-pay" data-llm-pay>{t('llm.pay')}</p>
      {!state.available ? <p className="oc-sx-warn" role="status" data-llm-nomodel>{t('llm.noModel')}</p> : null}

      <div className="oc-lm-top" data-llm-top data-grant={view.granted ? 'yes' : 'no'}>
        <div className="oc-lm-bud" data-llm-spend data-mode={spend.mode}>
          <Gauge pct={inUsd ? spend.usdPct : spend.callsPct} hit={Boolean(capHit)} label={t('llm.month')}
            value={inUsd ? usdLabel : String(spend.unpriced)} of={t('llm.gaugeOf', inUsd ? capLabel : spend.callCap)}
            text={inUsd ? t('llm.gaugeUsd', usdLabel, capLabel) : t('llm.gaugeCalls', spend.unpriced, spend.callCap)} />
          <div className="oc-lm-budt">
            <span className="oc-sx-name">
              {t('llm.month')}
              <HelpTip name={t('llm.month')}>
                {inUsd ? null : <p>{t('llm.unknownPrice', spend.unpriced, spend.callCap)}</p>}
                <p>{t('llm.capHint')}</p>
              </HelpTip>
            </span>
            {inUsd ? <small data-llm-usd>{t('llm.spendUsd', usdLabel, capLabel)}</small> : <small data-llm-unknown-price>{t('llm.priceUnknown')}</small>}
            {inUsd && spend.unpriced > 0 ? <small>{t('llm.spendCalls', spend.unpriced, spend.callCap)}</small> : null}
            <details className="oc-sx-cap">
              <summary>{t('llm.capSummary')}</summary>
              <div className="oc-sx-capg">
                <label htmlFor={`${id}-usd`}>{t('llm.capUsd')}</label>
                <label htmlFor={`${id}-calls`}>{t('llm.capCalls')}</label>
                <input id={`${id}-usd`} className="oc-fc" data-llm-cap-usd inputMode="decimal" value={usdText} {...held(saving, { text: true })}
                  onChange={hold(saving, e => setUsdText(e.target.value))} onBlur={() => commit('usd', usdText)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit('usd', usdText) } }} />
                <input id={`${id}-calls`} className="oc-fc" data-llm-cap-calls inputMode="numeric" value={callsText} {...held(saving, { text: true })}
                  onChange={hold(saving, e => setCallsText(e.target.value))} onBlur={() => commit('calls', callsText)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit('calls', callsText) } }} />
              </div>
            </details>
          </div>
        </div>
        {view.lists ? (
          <>
            <ModelSelect lane="strong" sel={view.selects.strong} choices={list.choices} busy={saving} onPick={(lane, pick) => apply({ models: { [lane]: pick } })} tipped />
            <ModelSelect lane="light" sel={view.selects.light} choices={list.choices} busy={saving} onPick={(lane, pick) => apply({ models: { [lane]: pick } })} />
          </>
        ) : <p className="oc-sx-warn oc-lm-wide" role="status" data-llm-too-old>{t('llm.grant.tooOld')}</p>}
        {view.needsGrant ? (
          <div className="oc-lm-grant oc-lm-wide" role="note" data-llm-grant>
            <SettingsIcon id="lock" size={16} />
            <span>{t('llm.grant.lead')}</span>
            <span className="oc-lm-cmd">
              <code data-llm-command>{view.command}</code>
              <button type="button" className="oc-lm-ib" data-llm-copy aria-label={t('llm.grant.copy')} title={t('llm.grant.copyTitle')} onClick={copyCommand}><SettingsIcon id="copy" size={16} /></button>
            </span>
            <HelpTip name={t('llm.grant.help')}>
              <p>{t('llm.grant.tipWhy')}</p>
              <p>{t('llm.grant.tipFall')}</p>
            </HelpTip>
            <span className="oc-lm-copied" role="status" aria-live="polite">{copied ? t('llm.grant.copied') : ''}</span>
          </div>
        ) : null}
        {view.granted && view.list.fallback ? <p className="oc-sx-warn oc-lm-wide" role="status" data-llm-list-fallback={view.list.fallback}>{t(`llm.models.fallback.${view.list.fallback}`)}</p> : null}
        {view.granted && list.state === 'loading' ? <p className="oc-lm-wide oc-lm-load" role="status" data-llm-list-loading>{t('llm.models.loading')}</p> : null}
      </div>

      <div className="oc-lm-list">
        {['work', 'decor'].map(g => (
          <section key={g} className="oc-lm-grp" aria-labelledby={`${id}-g-${g}`} data-llm-group={g}>
            <h4 className="oc-lm-g" id={`${id}-g-${g}`}>{t(`llm.groups.${g}.name`)}<span className="n">{t(`llm.groups.${g}.note`)}</span><span className="ln" aria-hidden="true" /></h4>
            {view.notices[g] ? <p className="oc-sx-warn oc-lm-gn" role="status" data-llm-group-notice={view.notices[g]}>{t('llm.groupOutdated')}</p> : null}
            {view.groups[g].map(renderRow)}
          </section>
        ))}
      </div>
      {error ? <p ref={errorRef} className="oc-sx-warn" role="alert" data-llm-error-save>{t(error === 'capInvalid' ? 'llm.capInvalid' : 'llm.saveFailed')}</p> : null}
    </div>
  )
}
