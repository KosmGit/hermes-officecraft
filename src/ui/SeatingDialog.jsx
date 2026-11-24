import { newId as randomUuid } from '../data/uuid.js'
import { useEffect, useId, useRef, useState } from 'react'

import { capReached, costKind, featureState, formatUsd, pairsAreSound } from '../core/llm.js'
import { INSTR_MAX, cleanInstructions, seatingBody, topRelays } from '../core/seating.js'
import { useLlm, useLlmActions } from '../data/llm.js'
import { Dlg, DlgIcon, DlgTip, Notice, Seg } from './DialogKit.jsx'
import { escapeCloses } from './dialogKeys.js'
import { held, hold } from './hold.js'
import { useT } from './useT.js'

/**
 * The seating window. Who sits next to whom follows the REAL hand-offs
 * between agents (two consecutive cards of a board done by two different agents: listed here, computed from the cards, no model); the
 * user's instructions go to the model, which proposes an order (a list of names, nothing else) that the engine places. Three choices, kept
 * per machine: the hand-offs (default), the model's order, the default order (by name). The call is the button, never the opening; the
 * cost is shown after it. Going back to the default order needs no model and works with the function off.
 */
export function SeatingDialog({ open, onClose, weights, choice, onChoice }) {
  const t = useT()
  const areaRef = useRef(null)
  const id = useId()
  const query = useLlm()
  const { call } = useLlmActions()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [answer, setAnswer] = useState(null)

  useEffect(() => { if (open) setTimeout(() => areaRef.current?.focus(), 0) }, [open])
  useEffect(() => { if (open) setAnswer(null) }, [open])

  const state = query.data ?? null
  const st = featureState(state, 'seating')
  const hit = state ? capReached(state, 'seating') : null
  const pairs = topRelays(weights, 6)
  const kept = state?.fiches.seating ?? null
  const fresh = answer && answer.kind === 'done' && Array.isArray(answer.fiche?.pairs) && pairsAreSound(answer.fiche.pairs) ? answer.fiche.pairs : null
  const proposal = fresh || (choice === 'model' ? kept?.pairs : null) || null
  const cost = costKind(answer)
  const sent = cleanInstructions(text)
  const refusal = st === 'off' ? t('llm.seating.off') : st === 'unavailable' ? t('llm.noModel') : st === 'cap' && hit ? t(`llm.capReached.${hit}`) : ''

  const run = async e => {
    e?.preventDefault()
    if (pending || st !== 'ready') return
    setPending(true)
    setAnswer(null)
    const a = await call('/llm/seating', seatingBody(randomUuid(), text, t.lang))
    setPending(false)
    setAnswer(a)
    if (a.kind === 'done') onChoice('model')   // the office shows the proposal at once; « back to the default order » undoes it
  }
  const blocked = pending || st !== 'ready'
  const choices = [['relays', t('llm.seating.useRelays')], ['model', t('llm.seating.useModel'), !kept], ['default', t('llm.seating.useDefault')]]

  return (
    <Dlg open={open} onClose={onClose} title={t('llm.seating.title')} icon="seating" size="m" data-seating-dialog onSubmit={run}
      onKeyDown={e => { if (escapeCloses(e)) { e.preventDefault(); e.stopPropagation(); onClose() } }}
      start={<button type="button" className="oc-btn oc-ghost" data-seating-revert {...held(pending || choice === 'default')} onClick={hold(pending || choice === 'default', () => { setAnswer(null); onChoice('default') })}>{t('llm.seating.revert')}</button>}
      actions={(
        <>
          <button type="button" className="oc-btn" data-seating-close onClick={onClose}>{t('llm.decor.close')}</button>
          <button type="submit" className="oc-btn oc-primary" data-seating-run aria-disabled={blocked ? true : undefined}><DlgIcon id="spark" size={14} />{t('llm.seating.call')}</button>
        </>
      )}>
      {refusal ? <Notice tone="warn" icon="info" role="status" data-seating-refusal>{refusal}</Notice> : null}
      <section className="oc-dg-sec" aria-label={t('llm.seating.relays')}>
        <h3>{t('llm.seating.relays')}<DlgTip name={t('llm.seating.relays')}>{t('llm.seating.relaysHint')}</DlgTip></h3>
        {pairs.length ? (
          <ul className="oc-dg-pairs" data-seating-relays>
            {pairs.map(p => <li key={`${p.a}|${p.b}`}><span>{t('llm.seating.pair', `${p.a} ↔ ${p.b}`, p.n)}</span></li>)}
          </ul>
        ) : <Notice tone="neutral" data-seating-none>{t('llm.seating.none')}</Notice>}
      </section>
      {/* the <label> holds the name alone: the « ? », its note and the counter are beside it, the counter reaches the field by aria-describedby */}
      <div className="oc-dg-fl">
        <span className="oc-dg-lab">
          <label htmlFor={`${id}-instr`}>{t('llm.seating.instructions')}</label>
          <DlgTip name={t('llm.seating.instructions')}>{t('llm.seating.sent')}{sent ? '' : ` ${t('llm.seating.emptyOk')}`}</DlgTip>
          <span className="grow" />
          <small id={`${id}-n`}>{t('llm.decor.count', text.length, INSTR_MAX)}</small>
        </span>
        <textarea ref={areaRef} id={`${id}-instr`} data-seating-instructions rows={2} value={text} maxLength={INSTR_MAX} placeholder={t('llm.seating.placeholder')} {...held(blocked, { text: true })}
          aria-describedby={`${id}-n ${id}-sent`} onChange={hold(blocked, e => setText(e.target.value))} />
        <span id={`${id}-sent`} hidden data-seating-sent>{t('llm.seating.sent')}{sent ? '' : ` ${t('llm.seating.emptyOk')}`}</span>
      </div>
      <div role="status" aria-live="polite" className="oc-dg-sec" data-seating-status={pending ? 'pending' : answer ? answer.kind : 'idle'}>
        {pending ? <p className="oc-dg-busy"><span className="oc-dg-spin" aria-hidden="true" />{t('llm.seating.calling')}</p> : null}
        {!pending && answer && answer.kind !== 'done' ? <Notice tone="bad" icon="alert" data-seating-failure={answer.reason}>{t(`llm.reason.${answer.reason}`)}</Notice> : null}
        {!pending && fresh && cost === 'known' ? <p className="oc-dg-faint" data-seating-cost="known">{t('llm.decor.costKnown', formatUsd(answer.costUsd, t.lang))}</p> : null}
        {!pending && fresh && cost === 'unknown' ? <p className="oc-dg-faint" data-seating-cost="unknown">{t('llm.decor.costUnknown')}</p> : null}
        {!pending && !fresh && answer && answer.kind === 'failed' && cost === 'error' ? <p className="oc-dg-faint" data-seating-cost="error">{t('llm.decor.costError')}</p> : null}
      </div>
      {proposal ? (
        <section className="oc-dg-sec" aria-label={t('llm.seating.proposal')} data-seating-proposal={fresh ? 'new' : 'kept'}>
          <h3>{fresh ? t('llm.seating.proposal') : t('llm.seating.kept', kept?.instructions || '…')}{fresh ? <DlgTip name={t('llm.seating.proposal')}>{t('llm.seating.proposalNote')}</DlgTip> : null}</h3>
          {proposal.length ? (
            <ol className="oc-dg-pairs" data-seating-pairs>{proposal.map(p => <li key={`${p.a}|${p.b}`}><span>{t('llm.seating.pairOf', `${p.a} ↔ ${p.b}`, t(`llm.seating.why.${p.why}`))}</span></li>)}</ol>
          ) : <Notice tone="neutral" data-seating-nopair>{t('llm.seating.none2')}</Notice>}
        </section>
      ) : null}
      <div className="oc-dg-fl">
        <span className="oc-dg-lab" id={`${id}-ch`}>{t('llm.seating.choice')}</span>
        <Seg label={t('llm.seating.choice')} items={choices} value={choice} onPick={onChoice} disabled={pending} attr="data-seat-choice" />
      </div>
    </Dlg>
  )
}
