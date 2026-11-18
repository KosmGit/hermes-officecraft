import { useEffect, useId, useRef, useState } from 'react'

import { isBusy } from '../core/orders.js'
import { mergeRevise } from '../core/llmDraft.js'
import { canRevise, pendingOffer, refusalOf, reviseApplicable, shownDescription } from '../core/llmAssist.js'
import { DESCRIPTION_MAX } from '../core/recruit.js'
import { newId } from '../data/uuid.js'
import { useLlm, useLlmActions } from '../data/llm.js'
import { Icon } from './icons.jsx'
import { useT } from './useT.js'

/**
 * The « Description » row of the Agent tab and, when the function is on and served, « Revise the description ». The model
 * proposes a new description (one call per click, light model); the user reads before / after and the reasons, may edit « after », and
 * « Apply » is `profiles.configure { description }` (that field only) through the order machine: the before / after on screen is the confirmation,
 * the 6 s window cancels, `profiles.list` is read back. « Ignore » drops the draft. The row is always there;
 * the button only when the function is offered and the bot has something to rewrite. The text is dropped as soon as the order has left.
 */
export function DescriptionRow({ agent, description, cut = false, isDefault, orders }) {
  const t = useT()
  const id = useId()
  const query = useLlm()
  const actions = useLlmActions()
  const state = query.data ?? null
  const [phase, setPhase] = useState('idle')   // idle | wait | refused | review
  const [refusal, setRefusal] = useState(null)
  const [rev, setRev] = useState(null)         // { id, before, after, changes }
  const [after, setAfter] = useState('')
  const [said, setSaid] = useState('')        // the live line: waiting, ignored
  const token = useRef(0)
  const openRef = useRef(null)
  const name = agent
  const bot = { name, description, isDefault }
  const offered = canRevise(state, bot)
  const busy = orders ? isBusy(orders.state) : true
  const o = orders?.state?.order
  const mine = o?.verb === 'revise' && o.code === name
  const outcome = orders?.state?.outcome

  // the order has left and was done (not cancelled): the draft goes with it; cancelled: it is still there for another try
  useEffect(() => {
    if (outcome?.verb === 'revise' && outcome.code === name && !outcome.cancelled && phase === 'review') { setPhase('idle'); setRev(null); setAfter('') }
  }, [outcome])   // eslint-disable-line react-hooks/exhaustive-deps
  // another bot picked: nothing carried over
  useEffect(() => { token.current++; setPhase('idle'); setRefusal(null); setRev(null); setAfter(''); setSaid('') }, [name])

  const offer = offered && phase === 'idle' ? pendingOffer(state, 'revise', Date.now()) : null
  const offerHere = offer && offer.target === name ? offer : null

  const show = (answer, did) => {
    const m = mergeRevise(description, answer.fiche)
    actions.forgetDraft('revise', did)
    if (!m.ok) { setRefusal(refusalOf({ answer, errors: m.errors })); setPhase('refused'); setSaid(''); return }
    setRev({ id: did, before: m.before, after: m.after, changes: m.changes })
    setAfter(m.after)
    setRefusal(null)
    setPhase('review')
    setSaid('')
  }
  const ask = async () => {
    if (phase === 'wait') return
    const mine2 = ++token.current
    const did = newId()
    setRefusal(null)
    setPhase('wait')
    setSaid('wait')
    const answer = await actions.revise(did, name, t.lang)
    if (mine2 !== token.current) return
    if (answer.kind === 'done' && answer.fiche) show(answer, did)
    else { setRefusal(refusalOf({ answer })); setPhase('refused'); setSaid('') }
  }
  const useOffer = async () => {
    const got = await actions.readDraft('revise', offerHere.id)
    if (!got) { setRefusal(refusalOf({ answer: { reason: 'expired' } })); setPhase('refused'); actions.forgetDraft('revise', offerHere.id); return }
    show({ fiche: got.fiche }, offerHere.id)
  }
  const ignore = () => { setPhase('idle'); setRev(null); setAfter(''); setSaid('ignored') }
  const apply = () => { if (reviseApplicable(rev?.before, after) && !busy) orders.requestRevise(name, after.trim()) }

  const reviewing = phase === 'review' && rev
  const ok = reviseApplicable(rev?.before, after)
  return (
    <>
      <dt>{t('ux.agent.description')}</dt>
      <dd data-insp-description>
        <span data-insp-description-text>{reviewing ? <small>{t('llm.revise.reviewing')}</small> : shownDescription(description, cut)}</span>
        {offered && !reviewing ? (
          <button type="button" className="ux-lnk" data-revise-open aria-disabled={phase === 'wait' || busy ? true : undefined} aria-describedby={`${id}-live`}
            onClick={() => { if (phase !== 'wait' && !busy) ask() }}>
            <Icon name="spark" size={12} /> {phase === 'wait' ? t('llm.revise.reading', name) : t('llm.revise.open')}
          </button>
        ) : null}
        <span className="oc-lm-sr" id={`${id}-live`} role="status" aria-live="polite">{said === 'wait' ? t('llm.revise.reading', name) : said === 'ignored' ? t('llm.revise.ignored') : ''}</span>
        {phase === 'refused' && refusal ? (
          <span className="oc-lm-ref" role="alert" data-lm-refusal={refusal.code}>
            <Icon name="warn" size={14} />
            <span>{t(`llm.ref.${refusal.code}`)}<small>{[refusal.calls ? t('llm.ref.counted', refusal.calls) : '', t('llm.ref.intact')].filter(Boolean).join(' · ')}</small></span>
          </span>
        ) : null}
        {offerHere && phase === 'idle' ? (
          <span className="oc-lm-dup" role="group" aria-label={t('llm.recruit.pendingHead')} data-lm-offer>
            <span><b>{t('llm.recruit.pendingHead')}</b></span>
            <button type="button" className="ux-b sm pri" onClick={useOffer}>{t('llm.revise.open')}</button>
            <button type="button" className="ux-b sm" onClick={() => actions.forgetDraft('revise', offerHere.id)}>{t('llm.revise.ignore')}</button>
          </span>
        ) : null}
      </dd>
      {reviewing ? (
        <dd className="oc-lm-rvwrap" style={{ gridColumn: '1 / -1' }}>
          <section className="oc-lm-rv" role="region" aria-label={t('llm.revise.region', name)} data-revise-box>
            <div className="oc-lm-ah"><Icon name="spark" size={14} /><b>{t('llm.revise.title')}</b></div>
            <div className="oc-lm-ba">
              <span className="k">{t('llm.revise.before')}</span>
              <p className="oc-lm-before" data-revise-before>{shownDescription(rev.before, cut)}</p>
            </div>
            <div className="oc-lm-ba">
              <label className="k" htmlFor={`${id}-after`}>{t('llm.revise.after')}</label>
              <textarea id={`${id}-after`} data-revise-after rows={6} value={after} maxLength={DESCRIPTION_MAX} className="oc-lm-f" disabled={mine && busy}
                onChange={e => setAfter(e.target.value)} />
              <span className="oc-lm-count">{t('llm.revise.count', after.length, DESCRIPTION_MAX)}</span>
            </div>
            {rev.changes.length ? (
              <div className="oc-lm-ba">
                <span className="k">{t('llm.revise.why')}</span>
                <ul className="oc-lm-why" data-revise-why>{rev.changes.map(c => <li key={c}>{c}</li>)}</ul>
              </div>
            ) : null}
            <div className="oc-lm-act">
              <button type="button" className="ux-b pri" data-revise-apply aria-disabled={ok && !busy ? undefined : true} onClick={apply}>{t('llm.revise.apply')}</button>
              <button type="button" className="ux-b" data-revise-ignore aria-disabled={mine && busy ? true : undefined} onClick={() => { if (!(mine && busy)) ignore() }}>{t('llm.revise.ignore')}</button>
              <small>{t('llm.revise.note')}</small>
            </div>
          </section>
        </dd>
      ) : null}
    </>
  )
}
