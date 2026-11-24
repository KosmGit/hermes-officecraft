import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { MAX_BODY } from '../core/campaign.js'
import { formatUsd, workReady } from '../core/llm.js'
import { formatWait, pendingOffer } from '../core/llmAssist.js'
import { NOTES_MAX, emptyMarks, markedFields, pruneMarks, validateMarks } from '../core/llmCampaign.js'
import {
  applyBodyText, bodyApplicable, cgRefusalOf, clearMarks, keepLint, keepMarks, lintShown, lintSignature, mergeMarks, planApply, proposalSummary, recallMarks, reviewIds, sameMarks
} from '../core/llmCampaignUi.js'
import { applyCardbody } from '../core/llmReview.js'
import { newId } from '../data/uuid.js'
import { useLlmActions } from '../data/llm.js'
import { useCampaignLlm } from '../data/llmCampaign.js'
import { DlgIcon, DlgTip } from './DialogKit.jsx'
import { Icon } from './icons.jsx'
import { useT } from './useT.js'

/**
 * The assisted side of the campaign editor. `useCampaignAssist` holds what the editor needs (the proposal of a graph and its wait,
 * the rewritten instructions of ONE card, the review before launch, the marks « to review »); the parts below draw it. The model only fills the DRAFT:
 * nothing is created here, « Create » stays the one order that writes a graph. Every function is absent from the screen when it is off
 * (`ready` false: no button, no request).
 */
export function useCampaignAssist({ state, open, step, draft, setDraft, bots, boards, lang, prices }) {
  const actions = useLlmActions()
  const calls = useCampaignLlm()
  const ready = { campaign: workReady(state, 'campaign'), cardbody: workReady(state, 'cardbody'), lint: workReady(state, 'lint') }
  const live = useRef({})
  live.current = { open, step, draft, bots, boards, lang, prices }
  const [announce, setAnnounce] = useState({ k: '', a: null })
  const say = (k, a = null) => setAnnounce({ k, a })

  /* ---- the marks « written by the model, to review »: a field is marked while the card still holds the value the model wrote ---- */
  const [marks, setMarks] = useState(() => recallMarks())
  const marksRef = useRef(marks)
  marksRef.current = marks
  useEffect(() => { keepMarks(marks) }, [marks])
  useEffect(() => { setMarks(m => { const p = pruneMarks(m, draft); return sameMarks(p, m) ? m : p }) }, [draft.cards])   // eslint-disable-line react-hooks/exhaustive-deps
  const left = useMemo(() => reviewIds(marks, draft), [marks, draft])
  const read = (id, field = null) => { setMarks(m => validateMarks(m, id, field)); say('read') }
  const readAll = () => { setMarks(emptyMarks()); say('allRead') }
  const forget = () => { clearMarks(); setMarks(emptyMarks()) }

  /* ---- « Propose a graph » ---- */
  const [cgOpen, setCgOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [cg, setCg] = useState({ phase: 'idle', since: 0, refusal: null, proposal: null, mode: 'append', confirm: false, note: '' })   // phase: idle | wait | refused | ready
  const token = useRef(0)
  const handled = useRef(new Set())   // proposals applied, ignored or refused: an offer of the same id is never shown again
  const asked = useRef('')
  const patchCg = p => setCg(c => ({ ...c, ...p }))
  const ctx = () => ({ bots: live.current.bots, boards: live.current.boards })

  const receive = useCallback((fiche, meta) => {
    // the same validators as a graph made by hand, on the draft AS IT IS NOW (replace mode: what it would make by itself): a graph refused never enters
    const plan = planApply(live.current.draft, fiche, 'replace', ctx())
    if (!plan.ok) {
      handled.current.add(meta.id)
      actions.forgetDraft('campaign', meta.id)
      setCg(c => ({ ...c, phase: 'refused', refusal: cgRefusalOf({ errors: plan.errors, answer: meta }), proposal: null, confirm: false }))
      setCgOpen(true)
      say('')
      return
    }
    const have = live.current.draft.cards.some(c => c.kind !== 'guard')
    setCg(c => ({ ...c, phase: 'ready', refusal: null, confirm: false, note: '', mode: have ? 'append' : 'replace', proposal: { ...meta, fiche, sum: proposalSummary(fiche) } }))
    setCgOpen(true)
    say('')
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const askCg = async () => {
    const goal = live.current.draft.goal.trim()
    if (!goal || cg.phase === 'wait' || !live.current.bots.length) return
    const mine = ++token.current
    const id = newId()
    const t0 = Date.now()
    patchCg({ phase: 'wait', since: t0, refusal: null, proposal: null, note: '' })
    say('cgWait')
    const answer = await calls.campaign(id, goal, notes, live.current.lang)
    if (mine !== token.current) return          // the user stopped waiting: the call went on, its graph stays at the agent half and is offered then
    if (answer.kind === 'done' && answer.fiche) receive(answer.fiche, { id, model: answer.model, retried: answer.retried, seconds: (Date.now() - t0) / 1000, costUsd: answer.costUsd, at: Date.now() })
    else { setCg(c => ({ ...c, phase: 'refused', refusal: cgRefusalOf({ answer }) })); say('') }
  }
  const stopCg = () => { token.current++; patchCg({ phase: 'idle' }); say('cgStopped') }
  const closeCg = () => { patchCg({ phase: cg.phase === 'wait' ? 'wait' : 'idle', refusal: null }); setCgOpen(false) }
  const ignoreCg = () => {
    const p = cg.proposal
    if (p) { handled.current.add(p.id); actions.forgetDraft('campaign', p.id) }
    patchCg({ phase: 'idle', proposal: null, confirm: false })
    setCgOpen(false)
    say('cgIgnored')
  }
  const modeCg = mode => patchCg({ mode, confirm: false })
  const applyCg = () => {
    const p = cg.proposal
    if (!p) return
    const plan = planApply(live.current.draft, p.fiche, cg.mode, ctx())
    if (!plan.ok) { patchCg({ note: cgRefusalOf({ errors: plan.errors }).key }); return }
    if (plan.mode === 'replace' && plan.removed > 0 && !cg.confirm) { patchCg({ confirm: true }); return }
    const { draft: next, marks: fresh } = plan.result
    setDraft(next)
    setMarks(m => (plan.mode === 'replace' ? fresh : mergeMarks(m, fresh, next)))
    handled.current.add(p.id)
    actions.forgetDraft('campaign', p.id)
    patchCg({ phase: 'idle', proposal: null, confirm: false, note: '' })
    setCgOpen(false)
    say('cgApplied', plan.added)
  }

  // the campaign is created: a proposal that was waiting has no draft left to go into
  useEffect(() => {
    if (step === 'created' && cg.phase !== 'idle' && cg.phase !== 'wait') {
      if (cg.proposal) { handled.current.add(cg.proposal.id); actions.forgetDraft('campaign', cg.proposal.id) }
      setCg(c => ({ ...c, phase: 'idle', proposal: null, refusal: null, confirm: false }))
      setCgOpen(false)
    }
  }, [step])   // eslint-disable-line react-hooks/exhaustive-deps

  // a window that opens asks the agent half again which graph it kept (free, no model); a graph that waited is offered at once (Apply / Ignore)
  useEffect(() => { if (open && ready.campaign) actions.refresh() }, [open, ready.campaign])   // eslint-disable-line react-hooks/exhaustive-deps
  const offer = ready.campaign && cg.phase === 'idle' ? pendingOffer(state, 'campaign', Date.now()) : null
  useEffect(() => {
    if (!open || step !== 'compose' || !offer || handled.current.has(offer.id) || asked.current === offer.id) return undefined
    asked.current = offer.id
    let alive = true
    actions.readDraft('campaign', offer.id).then(got => {
      if (!alive) return
      if (got) receive(got.fiche, { id: offer.id, at: got.at > 0 ? got.at * 1000 : null, fromOffer: true })
      else { handled.current.add(offer.id); actions.forgetDraft('campaign', offer.id) }
    })
    return () => { alive = false; asked.current = '' }
  }, [open, step, offer?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- « Rewrite the instructions » of ONE card ---- */
  const [bd, setBd] = useState({ phase: 'idle', card: '', since: 0, refusal: null, before: '', after: '', text: '' })   // phase: idle | wait | refused | review
  const btoken = useRef(0)
  const askBody = async cardId => {
    const d = live.current.draft
    const card = d.cards.find(c => c.id === cardId && c.kind !== 'guard')
    if (!card || !d.goal.trim() || bd.phase === 'wait') return
    const mine = ++btoken.current
    const id = newId()
    setBd({ phase: 'wait', card: cardId, since: Date.now(), refusal: null, before: '', after: '', text: '' })
    say('bodyWait')
    const answer = await calls.cardbody(id, d.goal.trim(), card, live.current.lang)
    if (mine !== btoken.current) return
    if (answer.kind === 'done' && answer.fiche) {
      actions.forgetDraft('cardbody', id)
      // a dry run on the draft as it is now: the card may be gone, the fiche may break a rule; nothing is applied here
      const r = applyCardbody(live.current.draft, cardId, answer.fiche, marksRef.current)
      if (!r.ok) { setBd(b => ({ ...b, phase: 'refused', refusal: { key: r.refused === 'card_gone' ? 'llm.body.err.card_gone' : 'llm.body.err.invalid', calls: answer.retried ? 2 : 1 } })); say(''); return }
      setBd(b => ({ ...b, phase: 'review', before: r.before, after: r.after, text: r.after, model: answer.model, seconds: (Date.now() - b.since) / 1000 }))
      say('bodyReady')
    } else { setBd(b => ({ ...b, phase: 'refused', refusal: cgRefusalOf({ answer }) })); say('') }
  }
  const setText = text => setBd(b => ({ ...b, text }))
  const ignoreBody = () => { btoken.current++; setBd(b => ({ ...b, phase: 'idle', card: '' })); say('bodyIgnored') }
  const stopBody = () => { btoken.current++; setBd(b => ({ ...b, phase: 'idle', card: '' })); say('bodyStopped') }
  const applyBody = () => {
    const r = applyBodyText(live.current.draft, bd.card, bd.text, bd.after, marksRef.current)
    if (!r.ok) { setBd(b => ({ ...b, phase: 'refused', refusal: { key: `llm.body.err.${r.refused}`, calls: 0 } })); return }
    setDraft(r.draft)
    setMarks(r.marks)
    setBd(b => ({ ...b, phase: 'idle', card: '' }))
    say('bodyApplied', live.current.draft.cards.find(c => c.id === bd.card)?.title ?? '')
  }
  // the card was removed while its proposal was open: the proposal goes with it
  useEffect(() => { if (bd.card && !draft.cards.some(c => c.id === bd.card)) { btoken.current++; setBd(b => ({ ...b, phase: 'idle', card: '' })) } }, [draft.cards, bd.card])

  /* ---- the review before launch: remarks of ONE state of the draft ---- */
  const [lint, setLint] = useState({ phase: 'idle', since: 0, refusal: null, kept: null, cleared: false })   // phase: idle | wait | refused | done
  const [lintSel, setLintSel] = useState(null)
  const ltoken = useRef(0)
  const askLint = async () => {
    if (lint.phase === 'wait') return
    const d = live.current.draft
    const sig = lintSignature(d)
    const mine = ++ltoken.current
    const id = newId()
    const t0 = Date.now()
    setLint({ phase: 'wait', since: t0, refusal: null, kept: null, cleared: false })
    setLintSel(null)
    say('lintWait')
    const answer = await calls.lint(id, d, live.current.lang, live.current.prices)
    if (mine !== ltoken.current) return
    if (answer.kind === 'done' && answer.fiche) {
      actions.forgetDraft('lint', id)
      if (lintSignature(live.current.draft) !== sig) { setLint({ phase: 'idle', since: 0, refusal: null, kept: null, cleared: true }); say('lintCleared'); return }
      const kept = keepLint(live.current.draft, answer.fiche, { truncated: answer.truncated, dropped: answer.dropped, model: answer.model, seconds: (Date.now() - t0) / 1000, costUsd: answer.costUsd, costStatus: answer.costStatus })
      if (!kept) { setLint(l => ({ ...l, phase: 'refused', refusal: cgRefusalOf({ answer: { reason: 'invalid_output' } }) })); say(''); return }
      setLint({ phase: 'done', since: 0, refusal: null, kept, cleared: false })
      say('lintDone', kept.findings.length)
    } else { setLint(l => ({ ...l, phase: 'refused', refusal: cgRefusalOf({ answer }) })); say('') }
  }
  const stopLint = () => { ltoken.current++; setLint(l => ({ ...l, phase: 'idle' })); say('lintStopped') }
  const shown = useMemo(() => lintShown(lint.kept, draft), [lint.kept, draft])
  // the draft changed since the remarks were written: they are cleared (the rule says so on the panel)
  useEffect(() => {
    if (shown.cleared) { setLint({ phase: 'idle', since: 0, refusal: null, kept: null, cleared: true }); setLintSel(null); say('lintCleared') }
  }, [shown.cleared])
  const pickFinding = ref => { setLintSel(s => (s === ref ? null : ref)) }
  // a card gone: its remark is set aside, and so is the selection
  const lintSelected = lintSel && draft.cards.some(c => c.id === lintSel) ? lintSel : null

  return {
    ready, announce, say, marks, left, read, readAll, forget, isMarked: (card, field) => markedFields(marks, card).includes(field), marked: card => markedFields(marks, card),
    cg: { open: cgOpen, setOpen: setCgOpen, ...cg, notes, setNotes, ask: askCg, stop: stopCg, close: closeCg, ignore: ignoreCg, apply: applyCg, setMode: modeCg, offerWaiting: Boolean(offer) },
    body: { ...bd, setText, ask: askBody, ignore: ignoreBody, stop: stopBody, apply: applyBody },
    lint: { ...lint, view: shown.view, ask: askLint, stop: stopLint, selected: lintSelected, pick: pickFinding },
    askedGoal: Boolean(draft.goal.trim()), bots, boards
  }
}

/** « to review »: the mark of a field the model wrote; a click reads it, an edit of the field lifts it (the value is compared). Never blocks anything. */
export function CardMark({ A, card, field, label, id }) {
  const t = useT()
  if (!A?.isMarked(card, field)) return null
  return (
    <button type="button" id={id} className="oc-lm-mk" data-lm-mark={`${card.id}:${field}`} title={t('llm.mark.title')} aria-label={t('llm.mark.label', label)} onClick={() => A.read(card.id, field)}>
      <DlgIcon id="spark" size={12} />{t('llm.mark.text')}
    </button>
  )
}

/** The quiet dot of a card of the list that still holds something the model wrote. */
export function RowDot({ A, card }) {
  const t = useT()
  if (!A?.marked(card).length) return null
  return <span className="oc-lm-dot" role="img" aria-label={t('llm.cgmark.row')} data-lm-dot={card.id}><DlgIcon id="spark" size={12} /></span>
}

/** The counter of the foot of the editor and the gesture « Mark all as read » (explicit: never done by itself). */
export function LeftBar({ A }) {
  const t = useT()
  if (!A?.left.size) return null
  return (
    <>
      <span className="oc-lm-left" data-lm-left title={t('llm.cgmark.leftTitle')}><DlgIcon id="spark" size={12} />{t('llm.mark.left', A.left.size)}</span>
      <button type="button" className="oc-dg-link" data-lm-allread onClick={A.readAll}>{t('llm.cgmark.all')}</button>
    </>
  )
}

/** The live line of the screen reader: what just happened (a wait, a refusal, an application). */
export function Live({ A }) {
  const t = useT()
  const { k, a } = A.announce
  if (!k && !A.ready.campaign && !A.ready.cardbody && !A.ready.lint) return null   // every function off: nothing more in the window than before
  return <span className="ux-vh" role="status" aria-live="polite" data-lm-announce>{k ? t(`llm.live.${k}`, a) : ''}</span>
}

function Elapsed({ since, tag }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])
  return <span className="oc-mono oc-lm-el" data-lm-timer={tag} aria-hidden="true">{formatWait((now - since) / 1000)}</span>
}

const Tip = ({ feature, returns, t }) => (
  <DlgTip name={t(`llm.f.${feature}.name`)}>
    <p><b>{t('llm.tip.sends')}</b> {t(`llm.f.${feature}.detail`)}.</p>
    <p><b>{t('llm.tip.returns')}</b> {returns}</p>
    <p><b>{t('llm.tip.cost')}</b> {t(`llm.f.${feature}.cost`)}.</p>
  </DlgTip>
)

/** The mini-graph of a proposal (phases as bands, cards as dots in the colour of their bot): decorative, the sentence beside it says the same. */
function Mini({ fiche, colors }) {
  const phases = fiche.phases.length
  const W = 96
  const H = 56
  const rows = fiche.cards.reduce((m, c) => { m[c.phase] = (m[c.phase] || 0) + 1; return m }, [])
  const seen = {}
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false" className="oc-lm-mini">
      {Array.from({ length: phases }, (_, p) => <line key={p} x1="6" x2={W - 6} y1={(H / (phases + 1)) * (p + 1) + 6} y2={(H / (phases + 1)) * (p + 1) + 6} className="mg" />)}
      {fiche.cards.map(c => {
        const k = (seen[c.phase] = (seen[c.phase] || 0) + 1)
        return <circle key={c.ref} cx={(W / (rows[c.phase] + 1)) * k} cy={(H / (phases + 1)) * (c.phase + 1)} r="3.5" style={{ fill: colors.get(c.who) || 'var(--ui-text-tertiary)' }} />
      })}
    </svg>
  )
}

/** « Propose a graph »: goal (from the editor's field) + notes -> a call, a long wait that can be left, then Apply / Ignore, add or replace. */
export function GraphPanel({ A, draft, colors, onClose }) {
  const t = useT()
  const fid = useId()
  const c = A.cg
  const work = draft.cards.filter(x => x.kind !== 'guard').length
  const goal = draft.goal.trim()
  const head = (title, extra = null) => (
    <div className="oc-lm-ah">
      <span className="oc-lm-ic" aria-hidden="true"><DlgIcon id="spark" size={16} /></span>
      <b>{title}</b>
      <span className="grow" />
      {extra}
    </div>
  )
  const close = <button type="button" className="ux-b sm ico ghost" data-lm-cg-close aria-label={t('llm.cg.closeLabel')} onClick={onClose}><Icon name="x" size={14} /></button>
  if (c.phase === 'wait') {
    return (
      <section className="oc-lm-cg" aria-label={t('llm.cg.title')} data-lm-cg data-phase="wait" aria-busy="true">
        {head(t('llm.cg.waitHead'), <small className="oc-lm-t"><Elapsed since={c.since} tag="cg" /></small>)}
        <span className="oc-lm-prog" aria-hidden="true"><i /></span>
        <small>{t('llm.cg.waitTyp')}</small>
        <small>{t('llm.cg.waitClose')}</small>
        <div className="oc-lm-foot"><DlgTip name={t('llm.cg.waitHelp')}>{t('llm.cg.waitTip')}</DlgTip><span className="grow" /><button type="button" className="ux-b sm" data-lm-stop onClick={c.stop}>{t('llm.cg.stop')}</button></div>
      </section>
    )
  }
  if (c.phase === 'ready' && c.proposal) {
    const p = c.proposal
    const plan = planApply(draft, p.fiche, c.mode, { bots: A.bots, boards: A.boards })
    const rep = plan.mode === 'replace'
    const label = rep ? (work ? t('llm.cg.applyReplace', work, p.sum.cards) : t('llm.cg.applyEmpty', p.sum.cards)) : t('llm.cg.applyAppend', p.sum.cards)
    const meta = [p.model, p.seconds ? formatWait(p.seconds) : '', p.costUsd != null ? t('llm.cg.usd', formatUsd(p.costUsd, t.lang)) : ''].filter(Boolean).join(' · ')
    return (
      <section className="oc-lm-cg" aria-label={t('llm.cg.readyHead')} data-lm-cg data-phase="ready" data-lm-offered={p.fromOffer ? '' : undefined}>
        {head(t('llm.cg.readyHead'), meta ? <small className="oc-lm-meta oc-mono">{meta}</small> : null)}
        {p.fromOffer && p.at ? <small>{t('llm.cg.readyFrom', t.ago(p.at))}</small> : null}
        <div className="oc-lm-sum">
          <span className="mini"><Mini fiche={p.fiche} colors={colors} /></span>
          <p><b data-lm-sum>{t('llm.cg.readySum', p.sum.cards, p.sum.phases)} · {t('llm.cg.readyBots', p.sum.bots)}</b><small>{t('llm.cg.readyNote1')}</small><small>{t('llm.cg.readyNote2')}</small></p>
        </div>
        {work ? (
          <>
            <span className="oc-dg-seg" role="group" aria-label={t('llm.cg.modeLabel')}>
              <button type="button" aria-pressed={!rep} data-lm-mode="append" onClick={() => c.setMode('append')}>{t('llm.cg.append')}</button>
              <button type="button" aria-pressed={rep} data-lm-mode="replace" onClick={() => c.setMode('replace')}>{t('llm.cg.replace')}</button>
            </span>
            <small className={rep ? 'oc-lm-warn' : undefined} data-lm-modenote>{rep ? t('llm.cg.dropNote', work) : t('llm.cg.keepNote', work)}</small>
          </>
        ) : null}
        {!plan.ok ? <p className="oc-lm-ref" role="alert" data-lm-refusal={plan.errors[0]}><DlgIcon id="alert" size={16} /><span>{t(cgRefusalOf({ errors: plan.errors }).key)}<small>{t('llm.cg.useReplace')}</small></span></p> : null}
        {c.confirm && plan.ok ? (
          <div className="oc-lm-confirm" role="alertdialog" aria-label={t('llm.cg.confirmAsk', work)} data-lm-confirm>
            <span>{t('llm.cg.confirmAsk', work)}</span>
            <button type="button" className="ux-b sm" data-lm-confirm-no onClick={() => c.setMode('append')}>{t('llm.cg.confirmKeep')}</button>
            <button type="button" className="ux-b sm danger" data-lm-confirm-yes onClick={c.apply}>{t('llm.cg.confirmGo')}</button>
          </div>
        ) : (
          <div className="oc-lm-foot">
            <DlgTip name={t('llm.cg.title')}>{t('llm.cg.waitTip')}</DlgTip>
            <span className="grow" />
            <button type="button" className="ux-b sm" data-lm-ignore onClick={c.ignore}>{t('llm.cg.ignore')}</button>
            <button type="button" className="ux-b sm pri" data-lm-apply aria-disabled={plan.ok ? undefined : true} onClick={() => { if (plan.ok) c.apply() }}>{label}</button>
          </div>
        )}
      </section>
    )
  }
  const refusal = c.phase === 'refused' ? c.refusal : null
  return (
    <section className="oc-lm-cg" aria-label={t('llm.cg.title')} data-lm-cg data-phase={c.phase}>
      {head(t('llm.cg.title'), <><Tip feature="campaign" returns={t('llm.cg.tipReturns')} t={t} />{close}</>)}
      <small>{t('llm.cg.sub')}</small>
      <p className="oc-lm-mis" data-lm-goal><span>{t('llm.cg.objective')}</span>{goal ? <q>{goal}</q> : <em>{t('llm.cg.goalNeeded')}</em>}</p>
      {refusal ? (
        <div className="oc-lm-ref" role="alert" data-lm-refusal={refusal.code}>
          <DlgIcon id="alert" size={16} />
          <p>{t(refusal.key)}<small>{[refusal.calls ? t('llm.ref.counted', refusal.calls) : '', t('llm.cg.intact')].filter(Boolean).join(' · ')}</small></p>
        </div>
      ) : null}
      {/* the <label> holds the name alone: the counter sits beside it and reaches the field by aria-describedby */}
      <div className="oc-dg-fl"><span className="oc-dg-lab"><label htmlFor={`${fid}-notes`}>{t('llm.cg.notes')}</label><small className="oc-mono" id={`${fid}-notes-n`} data-lm-notes-count>{c.notes.length}/{NOTES_MAX.toLocaleString('en').replace(',', ' ')}</small></span>
        <textarea id={`${fid}-notes`} aria-describedby={`${fid}-notes-n`} data-lm-notes rows={3} maxLength={NOTES_MAX} value={c.notes} placeholder={t('llm.cg.notesPh')} onChange={e => c.setNotes(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); if (goal) c.ask() } }} /></div>
      <div className="oc-lm-foot">
        {refusal?.action === 'settings' ? <small>{t('llm.ref.settings')}</small> : null}
        <span className="grow" />
        <button type="button" className="ux-b sm" data-lm-cg-close2 onClick={onClose}>{t('llm.cg.close')}</button>
        <button type="button" className="ux-b sm oc-lm-b" data-lm-ask aria-disabled={goal && A.bots.length ? undefined : true} onClick={() => { if (goal && A.bots.length) c.ask() }}>
          <DlgIcon id="spark" size={12} />{refusal ? t('llm.ref.again') : t('llm.cg.ask')}</button>
      </div>
    </section>
  )
}

/** The instructions of the selected card: « Rewrite the instructions », or while a proposal is open, before / after with Apply / Ignore. */
export function BodyAsk({ A, card, code }) {
  const t = useT()
  const b = A.body
  const here = b.card === card.id
  const goal = A.askedGoal
  if (here && b.phase === 'review') return null
  return (
    <div className="oc-lm-erow" data-lm-body-ask>
      {here && b.phase === 'refused' && b.refusal ? (
        <p className="oc-lm-ref" role="alert" data-lm-refusal={b.refusal.code ?? 'body'}><DlgIcon id="alert" size={16} /><span>{t(b.refusal.key)}<small>{[b.refusal.calls ? t('llm.ref.counted', b.refusal.calls) : '', t('llm.body.intact')].filter(Boolean).join(' · ')}</small></span></p>
      ) : null}
      {here && b.phase === 'wait' ? (
        <span className="oc-lm-wait" role="status"><span className="oc-lm-prog" aria-hidden="true"><i /></span>
          <small data-lm-wait>{t('llm.body.reading', code)} · <Elapsed since={b.since} tag="body" /></small>
          <button type="button" className="ux-b sm" data-lm-stop onClick={b.stop}>{t('llm.cg.stop')}</button></span>
      ) : (
        <button type="button" className="ux-b sm oc-lm-b" data-lm-body-open aria-disabled={goal && b.phase !== 'wait' ? undefined : true} title={goal ? undefined : t('llm.cg.goalNeeded')}
          onClick={() => { if (goal && b.phase !== 'wait') b.ask(card.id) }}><DlgIcon id="spark" size={12} />{t('llm.body.open')}</button>
      )}
    </div>
  )
}

export function BodyProposal({ A, card, code }) {
  const t = useT()
  const fid = useId()
  const b = A.body
  if (b.card !== card.id || b.phase !== 'review') return null
  const ok = bodyApplicable({ cards: [card] }, card.id, b.text)
  const mine = b.text === b.after
  const meta = [b.model, b.seconds ? formatWait(b.seconds) : ''].filter(Boolean).join(' · ')
  return (
    <div className="oc-lm-bd" role="group" aria-label={t('llm.body.region', code)} data-lm-body>
      <div className="oc-lm-ah"><span className="oc-lm-ic" aria-hidden="true"><DlgIcon id="spark" size={16} /></span><b>{t('llm.body.title')}</b><span className="grow" /><Tip feature="cardbody" returns={t('llm.body.tipReturns')} t={t} /></div>
      <details className="oc-lm-old">
        <summary><DlgIcon id="chev" size={12} />{t('llm.body.current', b.before.length)}</summary>
        <p data-lm-before>{b.before.trim() ? b.before : '—'}</p>
      </details>
      <div className="oc-dg-fl"><span className="oc-dg-lab"><label htmlFor={`${fid}-after`}>{t('llm.body.after')}</label><small className="oc-mono" id={`${fid}-after-n`} data-lm-after-count>{b.text.length} / {MAX_BODY.toLocaleString('en').replace(',', ' ')}</small>
        {mine ? <span className="oc-lm-mk-static" id={`${fid}-after-mk`}><DlgIcon id="spark" size={12} />{t('llm.mark.text')}</span> : null}</span>
        <textarea id={`${fid}-after`} aria-describedby={`${fid}-after-n${mine ? ` ${fid}-after-mk` : ''}`} data-lm-after rows={9} maxLength={MAX_BODY} value={b.text} className={mine ? 'oc-lm-f' : undefined} onChange={e => b.setText(e.target.value)} /></div>
      <div className="oc-lm-act">
        <small>{t('llm.body.note')}</small>
        {meta ? <span className="oc-lm-meta oc-mono">{meta}</span> : <span className="grow" />}
        <span className="oc-lm-btns">
          <button type="button" className="ux-b sm" data-lm-body-ignore onClick={b.ignore}>{t('llm.cg.ignore')}</button>
          <button type="button" className="ux-b sm pri" data-lm-body-apply aria-disabled={ok ? undefined : true} onClick={() => { if (ok) b.apply() }}>{t('llm.body.apply', code)}</button>
        </span>
      </div>
    </div>
  )
}

/** The review before launch, at the top of the summary of the « Check » step: a button (never automatic), the remarks by gravity, a click selects the card. */
export function LintPanel({ A, cardCount }) {
  const t = useT()
  const l = A.lint
  const v = l.view
  const SEV = { high: 'crit', medium: 'warn', low: 'info' }
  return (
    <div className="sx oc-lm-lint" data-lm-lint data-phase={l.phase}>
      <h4><DlgIcon id="spark" size={12} />{t('llm.lint.title')}{v ? <span className="oc-mono mut">{v.findings.length}</span> : null}<span className="grow" /><Tip feature="lint" returns={t('llm.lint.tipReturns')} t={t} /></h4>
      <p className="oc-lm-lsub">{t('llm.lint.sub')}</p>
      {l.phase === 'wait' ? (
        <div className="oc-lm-mini2" role="status" aria-busy="true">
          <span className="oc-lm-prog" aria-hidden="true"><i /></span>
          <small data-lm-wait>{t('llm.lint.reading', cardCount)} <Elapsed since={l.since} tag="lint" /></small>
          <button type="button" className="ux-b sm" data-lm-stop onClick={l.stop}>{t('llm.cg.stop')}</button>
        </div>
      ) : (
        <>
          {l.phase === 'refused' && l.refusal ? (
            <div className="oc-lm-ref" role="alert" data-lm-refusal={l.refusal.code}><DlgIcon id="alert" size={16} /><p>{t(l.refusal.key)}<small>{[l.refusal.calls ? t('llm.ref.counted', l.refusal.calls) : '', t('llm.lint.intact')].filter(Boolean).join(' · ')}</small></p></div>
          ) : null}
          {l.cleared && !v ? <small className="oc-lm-note" data-lm-cleared role="note">{t('llm.lint.cleared')}</small> : null}
          {v ? (
            <>
              {v.findings.length ? (
                <ul className="oc-lm-fl" aria-label={t('llm.lint.title')}>
                  {v.findings.map(f => (
                    <li key={`${f.ref}:${f.kind}:${f.text}`}>
                      <button type="button" className={`oc-lm-lf ${f.severity}`} data-lf={f.ref} data-sev={f.severity} aria-pressed={l.selected === f.ref}
                        aria-label={t('llm.lint.aria', [t(`llm.lint.sev.${f.severity}`), f.code, t(`llm.lint.kind.${f.kind}`)].join(', '), f.text)} onClick={() => l.pick(f.ref)}>
                        <span className="lft"><span className="sev"><Icon name={SEV[f.severity]} size={12} />{t(`llm.lint.sev.${f.severity}`)}</span><span className="code oc-mono">{f.code}</span><span className="kd">{t(`llm.lint.kind.${f.kind}`)}</span></span>
                        <span className="tx">{f.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="oc-lm-note" data-lm-none>{t('llm.lint.none')}</p>}
              {v.truncated ? <small className="oc-lm-note" data-lm-truncated>{t('llm.lint.truncated', v.truncated)}</small> : null}
              {v.dropped + v.set_aside ? <small className="oc-lm-note" data-lm-dropped>{t('llm.lint.dropped', v.dropped + v.set_aside)}</small> : null}
              <p className="oc-lm-lmeta oc-mono">{[v.model, v.seconds ? formatWait(v.seconds) : '', v.costUsd != null ? t('llm.cg.usd', formatUsd(v.costUsd, t.lang)) : ''].filter(Boolean).join(' · ')}</p>
              <small className="oc-lm-note" data-lm-rule>{t('llm.lint.rule')}</small>
            </>
          ) : null}
          <button type="button" className="ux-b sm oc-lm-b" data-lm-lint-ask onClick={l.ask}><DlgIcon id="spark" size={12} />{v ? t('llm.lint.again') : t('llm.lint.ask')}</button>
        </>
      )}
    </div>
  )
}
