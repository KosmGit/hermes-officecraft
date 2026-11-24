import { newId as randomUuid } from '../data/uuid.js'
import { useEffect, useId, useRef, useState } from 'react'

import { STYLE_MAX, capReached, cleanStyle, costKind, decorAppliesNow, decorBody, decorResolveBody, featureState, formatUsd } from '../core/llm.js'
import { useLlm, useLlmActions } from '../data/llm.js'
import { drawnColors, hexOf, normalizeStyle } from '../scene/index.js'
import { Dlg, DlgIcon, DlgTip, Notice } from './DialogKit.jsx'
import { escapeCloses } from './dialogKeys.js'
import { held, hold } from './hold.js'
import { useT } from './useT.js'

const EXAMPLES = ['ex1', 'ex2', 'ex3']

/**
 * The colours a fiche sets, as labelled swatches (the colour alone says nothing to a screen reader: each has its word), then the floor and the view.
 * The swatch is the colour the office really draws (the engine keeps every surface inside the art direction), not the raw hex.
 */
function Sheet({ style, t }) {
  const d = drawnColors(style)
  const items = [
    ['left', d.left], ['back', d.back], ['wainscot', d.wainscot], ['planks', d.planks[0]], ['sofa', d.sofa], ['desk', d.desk], ['cabinets', d.cabinets]
  ].map(([k, c]) => [k, hexOf(c)])
  return (
    <div className="oc-dg-card" data-decor-sheet>
      <ul className="oc-dg-sw">
        {items.map(([k, color]) => (
          <li key={k}><i style={{ background: color }} aria-hidden="true" /><span>{t(`llm.decor.swatches.${k}`)}</span></li>
        ))}
      </ul>
      <p className="oc-dg-faint" data-decor-floor={style.floor} data-decor-view={style.view}>{t(`llm.decor.floor.${style.floor}`)} · {t(`llm.decor.view.${style.view}`)}</p>
    </div>
  )
}

/**
 * The decorator's window. The user describes a style, one model call returns a
 * closed fiche (the agent half validated it), the office draws it. The call is the button (never on open), the cost is shown after it,
 * « Keep » closes, « Back to the original decor » forgets the fiche (no model, works with the function off). The model draws no pixel:
 * the swatches below are the fiche's own colours, shown as data.
 */
export function DecorDialog({ open, onClose }) {
  const t = useT()
  const areaRef = useRef(null)
  const id = useId()
  const query = useLlm()
  const { call } = useLlmActions()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [ignored, setIgnored] = useState(false)
  const pendingRef = useRef(false)   // a call is in flight
  const closedRef = useRef(false)    // the window was closed while it was: its answer is kept, never applied by itself

  useEffect(() => {
    if (!open && pendingRef.current) closedRef.current = true
  }, [open])
  // leaving the page (or the LLM section going away) unmounts the window without closing it; a call still in flight is then
  // treated as closed too: its answer stays pending (« Apply / Ignore »), never applied by itself
  useEffect(() => () => { if (pendingRef.current) closedRef.current = true }, [])
  useEffect(() => { if (open) setTimeout(() => areaRef.current?.focus(), 0) }, [open])
  // a fresh opening starts without the last answer (the sheet shown is then the current one)
  useEffect(() => { if (open) { setAnswer(null); setIgnored(false) } }, [open])

  const state = query.data ?? null
  const st = featureState(state, 'decor')
  const hit = state ? capReached(state, 'decor') : null
  const current = state?.fiches.decor ?? null
  const sent = cleanStyle(text)
  const fresh = answer && answer.kind === 'done' && !answer.reset ? normalizeStyle(answer.fiche) : null
  const shown = fresh || (answer?.reset ? null : normalizeStyle(current?.fiche))
  const cost = costKind(answer)
  // a style that came back while the window was closed: kept by the agent half, nothing changed in the office until « Apply »
  const waiting = state?.fiches.decorPending ?? null
  const ready = !fresh && waiting ? normalizeStyle(waiting.fiche) : null

  const run = async e => {
    e?.preventDefault()
    if (!sent || pending || st !== 'ready') return
    setPending(true)
    pendingRef.current = true
    closedRef.current = false
    setAnswer(null)
    setIgnored(false)
    const a = await call('/llm/decor', decorBody(randomUuid(), text, t.lang))
    // the window stayed open: the style is applied (the office shows it); closed meanwhile: it stays pending, « Apply / Ignore » on reopening
    if (decorAppliesNow(a, closedRef.current)) await call('/llm/decor/resolve', decorResolveBody(randomUuid(), 'apply'))
    pendingRef.current = false
    setPending(false)
    setAnswer(closedRef.current ? (a.kind === 'done' ? null : a) : a)
  }
  const resolve = async choice => {
    if (pending) return
    setPending(true)
    await call('/llm/decor/resolve', decorResolveBody(randomUuid(), choice))
    setPending(false)
    setIgnored(choice === 'ignore')
  }
  const revert = async () => {
    if (pending) return
    setPending(true)
    const a = await call('/llm/decor/reset', { id: randomUuid() })
    setPending(false)
    setAnswer(a)
  }
  const refusal = st === 'off' ? t('llm.decor.off') : st === 'unavailable' ? t('llm.noModel') : st === 'cap' && hit ? t(`llm.capReached.${hit}`) : ''

  const blocked = pending || st !== 'ready'
  return (
    <Dlg open={open} onClose={onClose} title={t('llm.decor.title')} icon="decor" size="m" data-decor-dialog onSubmit={run}
      onKeyDown={e => { if (escapeCloses(e)) { e.preventDefault(); e.stopPropagation(); onClose() } }}
      start={shown ? <button type="button" className="oc-btn oc-ghost" data-decor-revert {...held(pending)} onClick={hold(pending, revert)}>{t('llm.decor.revert')}</button> : null}
      actions={(
        <>
          <button type="button" className="oc-btn" data-decor-close onClick={onClose}>{fresh ? t('llm.decor.keep') : t('llm.decor.close')}</button>
          <button type="submit" className="oc-btn oc-primary" data-decor-run aria-disabled={!sent || blocked ? true : undefined}><DlgIcon id="spark" size={14} />{t('llm.decor.call')}</button>
        </>
      )}>
      {refusal ? <Notice tone="warn" icon="info" role="status" data-decor-refusal>{refusal}</Notice> : null}
      {/* the <label> holds the name alone: the « ? », its note and the counter are beside it, the counter reaches the field by aria-describedby */}
      <div className="oc-dg-fl">
        <span className="oc-dg-lab">
          <label htmlFor={`${id}-style`}>{t('llm.decor.describe')}</label>
          <DlgTip name={t('llm.decor.describe')}>{t('llm.decor.sent')}</DlgTip>
          <span className="grow" />
          <small id={`${id}-n`}>{t('llm.decor.count', text.length, STYLE_MAX)}</small>
        </span>
        <textarea ref={areaRef} id={`${id}-style`} data-decor-style rows={2} value={text} maxLength={STYLE_MAX} placeholder={t('llm.decor.placeholder')} {...held(blocked, { text: true })}
          aria-describedby={`${id}-n ${id}-sent`} onChange={hold(blocked, e => setText(e.target.value))} />
        <span id={`${id}-sent`} hidden data-decor-sent>{t('llm.decor.sent')}</span>
      </div>
      <div className="oc-dg-chips" role="group" aria-label={t('llm.decor.examples')}>
        {EXAMPLES.map(k => (
          <button key={k} type="button" className="oc-dg-pill" data-decor-example={k} {...held(blocked)} onClick={hold(blocked, () => { setText(t(`llm.decor.${k}`)); areaRef.current?.focus() })}>
            {t(`llm.decor.${k}`)}
          </button>
        ))}
      </div>
      <div role="status" aria-live="polite" className="oc-dg-sec" data-decor-status={pending ? 'pending' : answer ? answer.kind : 'idle'}>
        {pending ? <p className="oc-dg-busy"><span className="oc-dg-spin" aria-hidden="true" />{t('llm.decor.calling')}</p> : null}
        {!pending && answer && answer.kind !== 'done' ? <Notice tone="bad" icon="alert" data-decor-failure={answer.reason}>{t(`llm.reason.${answer.reason}`)}</Notice> : null}
        {!pending && answer?.reset ? <Notice tone="neutral" icon="check" data-decor-reverted>{t('llm.decor.reverted')}</Notice> : null}
        {!pending && fresh && cost === 'known' ? <p className="oc-dg-faint" data-decor-cost="known">{t('llm.decor.costKnown', formatUsd(answer.costUsd, t.lang))}</p> : null}
        {!pending && fresh && cost === 'unknown' ? <p className="oc-dg-faint" data-decor-cost="unknown">{t('llm.decor.costUnknown')}</p> : null}
        {!pending && !fresh && answer && answer.kind === 'failed' && cost === 'error' ? <p className="oc-dg-faint" data-decor-cost="error">{t('llm.decor.costError')}</p> : null}
      </div>
      {!pending && ignored ? <Notice tone="neutral" icon="check" role="status" data-decor-ignored>{t('llm.decor.ignored')}</Notice> : null}
      {ready ? (
        <section className="oc-dg-sec" aria-label={t('llm.decor.ready')} data-decor-ready>
          <h3>{t('llm.decor.ready')}<DlgTip name={t('llm.decor.ready')}>{t('llm.decor.readyNote', waiting?.style || '')}</DlgTip></h3>
          <Sheet style={ready} t={t} />
          <span className="oc-row">
            <button type="button" className="oc-btn oc-primary" data-decor-apply {...held(pending)} onClick={hold(pending, () => resolve('apply'))}>{t('llm.decor.apply')}</button>
            <button type="button" className="oc-btn" data-decor-ignore {...held(pending)} onClick={hold(pending, () => resolve('ignore'))}>{t('llm.decor.ignore')}</button>
          </span>
        </section>
      ) : null}
      {shown ? (
        <section className="oc-dg-sec" aria-label={t('llm.decor.preview')} data-decor-preview={fresh ? 'new' : 'current'}>
          <h3>{fresh ? t('llm.decor.preview') : t('llm.decor.current', current?.style || '…')}{fresh ? <DlgTip name={t('llm.decor.preview')}>{t('llm.decor.previewNote')}</DlgTip> : null}</h3>
          <Sheet style={shown} t={t} />
        </section>
      ) : null}
    </Dlg>
  )
}
