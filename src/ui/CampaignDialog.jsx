import { Fragment, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'

import {
  HEAD, MAX_BODY, MAX_GOAL, MAX_NAME, MAX_TITLE, MAX_WORK_CARDS, TEMPLATES, addCard, addGuard, addPhase, applyTemplate, codes, createdOf, draftIsEmpty,
  draftIssues, draftNotes, duplicateCard, effective, eligibleParents, guardTitle, initialWindow, isGuard, keepSession, letter, newDraft, patchCard, recallSession, removeCard, removeLastPhase,
  renamePhase, clearSession, missingParts, slugState, slugify, summary, templateCards, templatePreview, toggleParent, windowReducer, workCards
} from '../core/campaign.js'
import { depthOf } from '../core/campaignLayout.js'
import { numberText } from '../core/format.js'
import { workReady } from '../core/llm.js'
import { pricesOf } from '../core/llmCampaignUi.js'
import { UNDO_SECONDS, isBusy } from '../core/orders.js'
import { useLlm } from '../data/llm.js'
import { botColors, nextProjectColor } from '../scene/index.js'
import { BodyAsk, BodyProposal, CardMark, GraphPanel, LeftBar, Live, LintPanel, RowDot, useCampaignAssist } from './CampaignAssist.jsx'
import { BotLegend, CampaignGraph } from './CampaignGraph.jsx'
import { CAMPAIGN_CSS } from './campaignStyles.js'
import { Dlg, DlgChip, DlgIcon, DlgTip, Notice } from './DialogKit.jsx'
import { Icon } from './icons.jsx'
import { ModelPicker, useModelOptions } from './ModelPicker.jsx'
import { OrderConfirm, OrderProgress } from './Orders.jsx'
import { Portrait } from './Portrait.jsx'
import { escapeCloses } from './dialogKeys.js'
import { useT } from './useT.js'

const NEW = '__new__'
const RUNTIMES = [0, 3600, 7200, 14_400, 28_800]

/** The page's wording of the titles a template writes (src/core/campaign.js `templateCards` takes it; the code has no language). */
const wording = t => ({ step: n => t('campaign.tpl.step', n), review: n => t('campaign.tpl.review', n), audit: n => t('campaign.tpl.auditCard', n), synth: () => t('campaign.tpl.synth'), card: n => t('campaign.tpl.card', n), phase: k => t('campaign.tpl.phase', k), phaseCard: (k, n) => t('campaign.tpl.phaseCard', k, n) })

/** A small picture of a template: dots by depth, in the colour of the bot it would use. Decorative (the name and the description are next to it). */
function Mini({ id, colors, bots }) {
  const made = templateCards(id, { bots: { dev: bots[0], review: bots[1] ?? bots[0], audit: [bots[0], bots[1] ?? bots[0]], synth: bots[0], work: bots, chain: bots }, n: TEMPLATES.find(x => x.id === id).n.def, per: 2 })
  const cards = [{ id: HEAD, kind: 'guard', parents: [], phase: 0 }, ...made.cards.map(c => ({ ...c, kind: 'card' }))]
  if (id === 'phases') {
    cards.push({ id: 'G1', kind: 'guard', parents: made.cards.filter(c => c.phase === 0).map(c => c.id), phase: 1 })
    for (const c of cards) if (c.phase === 1 && c.kind === 'card') c.parents = ['G1']
  }
  const depth = depthOf(cards)
  const lv = []
  for (const c of cards) (lv[depth.get(c.id)] ||= []).push(c)
  const W = 132
  const H = 76
  const dy = H / (lv.length + 1)
  const P = new Map()
  lv.forEach((l, i) => l.forEach((c, k) => P.set(c.id, [c.kind === 'guard' ? W / 2 : (W / (l.length + 1)) * (k + 1), dy * (i + 1) - 2])))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false" className="oc-cgmini">
      {cards.flatMap(c => c.parents.map(p => (P.get(p) && P.get(c.id) ? <line key={`${p}>${c.id}`} x1={P.get(p)[0]} y1={P.get(p)[1]} x2={P.get(c.id)[0]} y2={P.get(c.id)[1]} className="ml" /> : null)))}
      {cards.map(c => (c.kind === 'guard'
        ? <line key={c.id} x1="12" y1={P.get(c.id)?.[1]} x2={W - 12} y2={P.get(c.id)?.[1]} className="mg" />
        : <circle key={c.id} cx={P.get(c.id)?.[0]} cy={P.get(c.id)?.[1]} r="5" style={{ fill: colors.get(c.who) || 'var(--ui-text-tertiary)' }} />))}
    </svg>
  )
}

/** The row of the two starting points. Off = the one button, as it always was (no wrapper): with the assisted function on, the two sit on one line. */
const TplBar = ({ on, children }) => (on ? <span className="oc-lm-tb">{children}</span> : <Fragment>{children}</Fragment>)

/** The steps. The title of the current one takes the focus when the step changes (`titleRef`): the button that was pressed is gone, and the new step is said once, by the focus. */
function Stepper({ step, t, titleRef }) {
  const list = [['compose', t('campaign.step.compose')], ['review', t('campaign.step.review')], ['created', t('campaign.step.created')]]
  const at = list.findIndex(([k]) => k === step)
  return (
    <ol className="oc-cgsteps" aria-label={t('campaign.steps')}>
      {list.map(([k, l], j) => (
        <li key={k} className={j < at ? 'past' : j === at ? 'now' : ''} aria-current={j === at ? 'step' : undefined} data-step={k}>
          <span className="n">{j < at ? <Icon name="check" size={12} /> : j + 1}</span>
          <span className="tl" ref={j === at ? titleRef : undefined} tabIndex={j === at ? -1 : undefined} data-step-title={j === at ? '' : undefined}>{l}</span>
        </li>
      ))}
    </ol>
  )
}

/** The templates panel: four chains written in code, their knobs (how many, which bots from the roster), « Add to the end » or « Replace ». */
function Templates({ draft, apply, bots, colors, t, L, onClose }) {
  const id = useId()
  const [tpl, setTpl] = useState('devreview')
  const [mode, setMode] = useState('append')
  const [n, setN] = useState({ devreview: 3, audit: 4, phases: 2, chain: 4 })
  const [per, setPer] = useState(2)
  const [pick, setPick] = useState({ dev: bots[0], review: bots[1] ?? bots[0], audit: bots[0], synth: bots[1] ?? bots[0], work: bots[0], chain: bots[0] })
  const spec = TEMPLATES.find(x => x.id === tpl)
  const set = (k, v) => setPick(p => ({ ...p, [k]: v }))
  const botSel = (k, label) => (
    <label className="oc-dg-fl" key={k}><span className="oc-dg-lab">{label}</span>
      <select value={pick[k]} data-tpl-bot={k} onChange={e => set(k, e.target.value)}>{bots.map(b => <option key={b} value={b}>{b}</option>)}</select></label>
  )
  const knobs = { devreview: [['dev', t('campaign.tpl.botDev')], ['review', t('campaign.tpl.botReview')]], audit: [['audit', t('campaign.tpl.botAudit')], ['synth', t('campaign.tpl.botSynth')]], phases: [['work', t('campaign.tpl.botWork')]], chain: [['chain', t('campaign.tpl.botChain')]] }[tpl]
  const params = { n: n[tpl], per, bots: { dev: pick.dev, review: pick.review, audit: [pick.audit], synth: pick.synth, work: [pick.work], chain: [pick.chain] } }
  const room = MAX_WORK_CARDS - workCards(draft).length
  // on a draft with no card there is nothing to add to or to replace: the template simply is the draft, and the result is said beside the button
  const empty = workCards(draft).length === 0
  const how = empty ? 'replace' : mode
  const made = useMemo(() => templatePreview(draft, tpl, params, how, L), [draft, tpl, n, per, pick, how, L]) // eslint-disable-line react-hooks/exhaustive-deps
  const result = made.refused ? t(`campaign.refused.${made.refused}`) : made.mode === 'append' ? t('campaign.tpl.resultAdd', made.made, made.work) : t('campaign.tpl.result', made.made, made.phases, made.guards)
  return (
    <section className="oc-cgtpl" aria-label={t('campaign.tpl.title')} data-templates>
      <div className="hd"><b>{t('campaign.tpl.title')}</b><small>{t('campaign.tpl.sub')}</small>
        <button type="button" className="ux-b sm ico ghost" aria-label={t('campaign.close')} onClick={onClose}><Icon name="x" size={14} /></button></div>
      <div className="grid" role="group" aria-label={t('campaign.tpl.title')}>
        {TEMPLATES.map(x => (
          <button key={x.id} type="button" aria-pressed={tpl === x.id} className="tc" data-tpl={x.id} onClick={() => setTpl(x.id)}>
            <Mini id={x.id} colors={colors} bots={bots} />
            <b>{t(`campaign.tpl.${x.id}.name`)}</b><small>{t(`campaign.tpl.${x.id}.desc`)}</small>
          </button>
        ))}
      </div>
      <div className="knobs">
        <label className="oc-dg-fl"><span className="oc-dg-lab">{t(`campaign.tpl.n.${tpl}`)}</span>
          <input type="number" inputMode="numeric" min={spec.n.min} max={spec.n.max} value={n[tpl]} data-tpl-n onChange={e => setN(v => ({ ...v, [tpl]: e.target.value === '' ? '' : Number(e.target.value) }))} /></label>
        {tpl === 'phases' ? <label className="oc-dg-fl"><span className="oc-dg-lab">{t('campaign.tpl.per')}</span>
          <input type="number" inputMode="numeric" min={spec.per.min} max={spec.per.max} value={per} data-tpl-per onChange={e => setPer(e.target.value === '' ? '' : Number(e.target.value))} /></label> : null}
        {knobs.map(([k, l]) => botSel(k, l))}
      </div>
      <div className="ft">
        {empty ? null : (
          <span className="oc-dg-seg" role="group" aria-label={t('campaign.tpl.apply')}>
            <button type="button" aria-pressed={mode === 'append'} data-tpl-mode="append" onClick={() => setMode('append')}>{t('campaign.tpl.append')}</button>
            <button type="button" aria-pressed={mode === 'replace'} data-tpl-mode="replace" onClick={() => setMode('replace')}>{t('campaign.tpl.replace')}</button>
          </span>
        )}
        <small className="faint" id={`${id}-n`}>{empty ? null : <>{mode === 'append' ? t('campaign.tpl.appendNote') : t('campaign.tpl.replaceNote')}{room < 8 && mode === 'append' ? ` ${t('campaign.tpl.room', Math.max(0, room))}` : ''}{' '}</>}<b className="oc-tpl-result" data-tpl-result>{result}</b></small>
        <button type="button" className="oc-btn oc-primary" data-tpl-apply aria-describedby={`${id}-n`} onClick={() => apply(tpl, params, how)}>{t('campaign.tpl.go')}</button>
      </div>
    </section>
  )
}

/** One card of the list and, when it is the selected one, its editor. */
function Row({ c, d, code, deps, colors, sceneBy, bots, defModel, modelOpts, onPatch, onSelect, onDup, onDel, onDep, sel, t, notes, A = null }) {
  const id = useId()
  const pinned = c.model && c.provider && c.model !== defModel(c.who)
  const eligible = sel ? eligibleParents(d, c.id) : []
  const sceneAgent = sceneBy.get(c.who)
  const blen = c.body.length
  return (
    <li className={`oc-cgrow${sel ? ' on' : ''}`} style={{ '--bc': colors.get(c.who) }} data-row={c.id}>
      <div className="hd">
        <button type="button" className="sel" aria-expanded={sel} aria-controls={sel ? `${id}-ed` : undefined} data-row-select={c.id} onClick={() => onSelect(sel ? null : c.id)}>
          <i className="stripe" aria-hidden="true" />
          {sceneAgent ? <span className="pt"><Portrait agent={sceneAgent} /></span> : null}
          <b className="cd oc-mono">{code}</b>
          <span className="tt"><b title={c.title || undefined}>{c.title || <em>{t('campaign.untitled')}</em>}</b>
            <small>{c.who || '—'}{deps.length ? ` · ${deps.length > 3 ? t('campaign.afterN', deps.length) : t('campaign.after', deps.join(', '))}` : ''}</small></span>
          {pinned ? <span className="pin" title={t('campaign.pinnedModel', c.model)}>M</span> : null}
          {notes ? <span className="nob" role="img" aria-label={t('campaign.noBody')}><Icon name="warn" size={14} /></span> : null}
        </button>
        <RowDot A={A} card={c} />
        <button type="button" className="ux-b sm ico ghost" data-row-dup={c.id} aria-label={t('campaign.dup', code)} onClick={() => onDup(c.id)}><Icon name="copy" size={14} /></button>
        <button type="button" className="ux-b sm ico ghost" data-row-del={c.id} aria-label={t('campaign.del', code)} onClick={() => onDel(c.id)}><Icon name="trash" size={14} /></button>
      </div>
      {sel ? (
        <div className="ed" id={`${id}-ed`} role="group" aria-label={t('campaign.edit', code)} data-editor>
          {/* each <label> holds the name alone: the counter and the model's mark sit beside it and reach the field by aria-describedby */}
          <div className="oc-dg-fl"><span className="oc-dg-lab"><label htmlFor={`${id}-title`}>{t('campaign.f.title')}</label><small className="oc-mono" id={`${id}-title-n`}>{c.title.length}/{MAX_TITLE}</small><CardMark A={A} card={c} field="title" label={t('campaign.f.title')} id={`${id}-title-mk`} /></span>
            <input id={`${id}-title`} data-f="title" value={c.title} maxLength={MAX_TITLE} aria-describedby={`${id}-title-n ${id}-title-mk`} className={A?.isMarked(c, 'title') ? 'oc-lm-f' : undefined} onChange={e => onPatch(c.id, { title: e.target.value })} /></div>
          <div className="two">
            <div className="oc-dg-fl"><span className="oc-dg-lab"><label htmlFor={`${id}-bot`}>{t('campaign.f.bot')}</label><CardMark A={A} card={c} field="who" label={t('campaign.f.bot')} id={`${id}-bot-mk`} /></span>
              <span className="botsel">{sceneAgent ? <Portrait agent={sceneAgent} /> : null}
                <select id={`${id}-bot`} data-f="bot" value={c.who} aria-describedby={`${id}-bot-mk`} className={A?.isMarked(c, 'who') ? 'oc-lm-f' : undefined} onChange={e => onPatch(c.id, { who: e.target.value })}>
                  {bots.map(b => <option key={b} value={b}>{b}</option>)}
                </select></span></div>
            <label className="oc-dg-fl"><span className="oc-dg-lab">{t('campaign.f.runtime')}</span>
              <select data-f="runtime" value={c.maxRuntime || 0} onChange={e => onPatch(c.id, { maxRuntime: Number(e.target.value) })}>
                {RUNTIMES.map(r => <option key={r} value={r}>{r ? t('campaign.f.hours', r / 3600) : t('campaign.f.runtimeDefault')}</option>)}
                {c.maxRuntime && !RUNTIMES.includes(c.maxRuntime) ? <option value={c.maxRuntime}>{`${c.maxRuntime} s`}</option> : null}
              </select></label>
          </div>
          {A?.ready.cardbody && A.body.card === c.id && A.body.phase === 'review' ? <BodyProposal A={A} card={c} code={code} /> : (
            <div className="oc-dg-fl"><span className="oc-dg-lab"><label htmlFor={`${id}-body`}>{t('campaign.f.body')}</label><small className={`oc-mono${blen > MAX_BODY * 0.9 ? ' near' : ''}`} id={`${id}-body-n`}>{blen} / {numberText(MAX_BODY, t.lang)}</small><CardMark A={A} card={c} field="body" label={t('campaign.f.body')} id={`${id}-body-mk`} /></span>
              <textarea id={`${id}-body`} data-f="body" rows={3} maxLength={MAX_BODY} value={c.body} placeholder={t('campaign.f.bodyPh')} aria-describedby={`${id}-body-n ${id}-body-mk`} className={A?.isMarked(c, 'body') ? 'oc-lm-f' : undefined} onChange={e => onPatch(c.id, { body: e.target.value })} /></div>
          )}
          {A?.ready.cardbody ? <BodyAsk A={A} card={c} code={code} /> : null}
          <fieldset className="oc-dg-fl deps">
            <legend className="oc-dg-lab">{t('campaign.f.deps')}<DlgTip name={t('campaign.f.deps')}>{t('campaign.f.depsTip')}</DlgTip><CardMark A={A} card={c} field="parents" label={t('campaign.f.deps')} /></legend>
            {eligible.length ? (
              <div className="oc-dg-chips" role="group" aria-label={t('campaign.f.deps')}>
                {eligible.map(x => (
                  <button key={x.id} type="button" className="dep" aria-pressed={c.parents.includes(x.id)} data-dep={x.id} onClick={() => onDep(c.id, x.id)} style={{ '--bc': colors.get(x.who) }}>
                    <i aria-hidden="true" /><b className="oc-mono">{d.codes[x.id]}</b><span>{x.title || t('campaign.untitled')}</span>
                  </button>
                ))}
              </div>
            ) : <small className="faint">{t('campaign.f.depsNone')}</small>}
          </fieldset>
          <details className="oc-cgmodel" open={Boolean(c.model)}>
            <summary><DlgIcon id="chev" size={12} />{t('campaign.f.model')}<span className="sum">{c.model ? `${c.model}` : t('campaign.f.modelDefault', defModel(c.who) || '—')}</span></summary>
            <ModelPicker opts={modelOpts} model={c.model} provider={c.provider} onChange={v => onPatch(c.id, v)}
              inheritedTitle={t('campaign.f.modelBot', c.who)} inheritedNote={defModel(c.who) || t('campaign.f.modelUnknown')} />
          </details>
          <details className="oc-cgadv">
            <summary><DlgIcon id="chev" size={12} />{t('campaign.f.advanced')}</summary>
            <label className="oc-dg-fl"><span className="oc-dg-lab">{t('campaign.f.workspace')}</span>
              <select data-f="workspace" value={c.workspace} onChange={e => onPatch(c.id, { workspace: e.target.value })}>
                <option value="scratch">{t('campaign.f.scratch')}</option>
                <option value="dir">{d.boardMode === 'new' ? t('campaign.f.dirNew') : t('campaign.f.dir')}</option>
              </select></label>
          </details>
        </div>
      ) : null}
    </li>
  )
}

/**
 * The campaign editor. Objective -> project -> cards (title, bot of the REAL roster, model, instructions, dependencies) -> the graph
 * previewed beside them -> a review that names what will be written -> ONE order (final: 6 s to cancel, one at a time, journaled, read back)
 * -> « ready, nothing runs » -> « Launch » (the guard is completed, never unblocked) or « Cancel the campaign ».
 * The rules are src/core/campaign.js, the picture src/core/campaignLayout.js.
 * No model composes, splits or assigns a card. The draft lives in the memory of the tab (kept when the window closes).
 */
export function CampaignDialog({ open, onClose, desks, boards, sceneBy, orders, writes, replay = false }) {
  const t = useT()
  const uid = useId()
  const [session] = useState(() => recallSession())
  const [draft, setDraft] = useState(() => session?.draft ?? newDraft({ phaseName: t('campaign.tpl.phase', 'A') }))
  const [win, dispatch] = useReducer(windowReducer, session?.win ?? initialWindow())
  const [view, setView] = useState('list')
  const [tplOpen, setTplOpen] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [unfolded, setUnfolded] = useState(() => new Set())
  const [refused, setRefused] = useState('')
  const goalRef = useRef(null)
  const phase = orders.state.phase
  const o = orders.state.order
  const out = orders.state.outcome
  const mine = o && (o.verb === 'campaign' || o.verb === 'launch' || o.verb === 'cancel_campaign') && (o.verb === 'campaign' || o.task === win.created?.head)
  const working = isBusy(orders.state) && mine

  // the roster: the bots a card can be given (nothing named in code), their default model, one colour per bot by rank
  const bots = useMemo(() => desks.map(d => d.name).sort((a, b) => a.localeCompare(b, 'en')), [desks])
  const colors = useMemo(() => botColors(bots), [bots])
  const defOf = useMemo(() => new Map(desks.map(d => [d.name, d.model || ''])), [desks])
  const defModel = useCallback(name => defOf.get(name) || '', [defOf])
  const slugs = useMemo(() => boards.map(b => b.slug), [boards])
  const lang = t.lang
  // the assisted functions read the cache of `GET /llm` that the page already holds (no read of their own); off = nothing below is drawn or asked
  const llmState = useLlm({ enabled: false }).data ?? null
  const lintOn = workReady(llmState, 'lint')
  const modelOpts = useModelOptions(open && (win.step === 'compose' || (lintOn && win.step === 'review')))

  // a draft with no card still needs a first bot once the roster is read: the first one, in the roster's order
  const keepBots = useRef(bots)
  keepBots.current = bots
  const L = useMemo(() => wording(t), [t, lang])   // eslint-disable-line react-hooks/exhaustive-deps

  // kept in the memory of the tab at every change; nothing is kept after launch (the campaign runs) or for an empty draft
  useEffect(() => {
    if (win.created?.launched || (draftIsEmpty(draft) && win.step === 'compose')) clearSession()
    else keepSession(draft, win)
  }, [draft, win])

  // the order machine -> the window: a created campaign, a launch, a cancellation. Only while the window is open: a closed window leaves
  // the outcome to the page's bar, and reads it when it opens again.
  useEffect(() => {
    if (!open || !out || out.cancelled) return
    if (out.verb === 'campaign' && out.ok) {
      const made = createdOf(out, draft)
      if (made) { dispatch({ type: 'created', created: made }); orders.act('dismiss') }
    } else if (out.verb === 'launch' && out.ok && win.created && out.task === win.created.head) {
      dispatch({ type: 'launched', task: out.task, ready: out.ready }); orders.act('dismiss')
    } else if (out.verb === 'cancel_campaign' && out.ok && win.created && out.task === win.created.head) {
      dispatch({ type: 'cancelled', task: out.task, archived: out.archived }); orders.act('dismiss')
    }
  }, [open, out]) // eslint-disable-line react-hooks/exhaustive-deps

  // a default first bot for the cards the user adds (the roster's first)
  const firstBot = bots[0] || ''
  const set = useCallback(fn => setDraft(d => (typeof fn === 'function' ? fn(d) : fn)), [])
  const prices = useMemo(() => pricesOf(modelOpts.providers), [modelOpts])
  const A = useCampaignAssist({ state: llmState, open, step: win.step, draft, setDraft, bots, boards: slugs, lang, prices })
  const issues = useMemo(() => draftIssues(draft, { bots, boards: slugs }), [draft, bots, slugs])
  const notes = useMemo(() => new Set(draftNotes(draft).map(n => n.id)), [draft])
  const g = useMemo(() => effective(draft), [draft])
  const sum = useMemo(() => summary(draft), [draft])
  const code = useMemo(() => codes(draft), [draft])
  const info = useMemo(() => {
    const m = new Map()
    for (const c of g.cards) if (!isGuard(c)) m.set(c.id, { code: code[c.id], title: c.title, who: c.who, pin: c.model && c.provider && c.model !== defModel(c.who) ? c.model : '' })
    return m
  }, [g, code, defModel])
  const dd = useMemo(() => ({ ...draft, codes: code }), [draft, code])
  const nb = draft.boardMode === 'new'
  const slugSt = slugState(draft.nb.slug, slugs)
  const target = nb ? draft.nb.slug : draft.board
  const ok = issues.length === 0
  const missing = useMemo(() => missingParts(issues), [issues])
  const isNoBot = !bots.length

  const patch = useCallback((id, p) => set(d => patchCard(d, id, p)), [set])
  const add = phaseIx => set(d => addCard(d, phaseIx, d.cards.filter(c => !isGuard(c) && c.phase === phaseIx).at(-1)?.who || d.cards.filter(c => !isGuard(c)).at(-1)?.who || firstBot))
  const dep = (id, parent) => set(d => { const r = toggleParent(d, id, parent); setRefused(r.refused || ''); return r.draft })
  const apply = (tpl, params, mode) => {
    const r = applyTemplate(draft, tpl, params, mode, L)
    if (r.refused) { setRefused(r.refused); return }
    setRefused('')
    setDraft(r.draft)
    setTplOpen(false)
  }
  const chooseProject = v => set(d => (v === NEW ? { ...d, boardMode: 'new' } : { ...d, boardMode: 'existing', board: v }))
  const names = useMemo(() => ({ starts: sum.first.map(c => `${code[c.id]} · ${c.who}`) }), [sum, code])

  const goReview = () => {
    if (!ok) { setAttempted(true); return }
    setAttempted(false)
    dispatch({ type: 'review' })
  }
  const create = () => {
    if (!ok || isBusy(orders.state)) return
    orders.requestCampaign(draft, names)
  }
  const clear = () => {
    setDraft(newDraft({ phaseName: t('campaign.tpl.phase', 'A') }))
    dispatch({ type: 'reset' })
    clearSession()
    A.forget()
    setConfirmClear(false)
    setAttempted(false)
  }
  const close = () => { if (!working) onClose() }
  const exit = () => {
    if (phase === 'counting' && o?.verb === 'campaign') { orders.act('cancel'); return }
    if (phase === 'confirm' && mine) { orders.act('cancel'); return }
    close()
  }
  const toggleGroup = id => setUnfolded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selectCard = id => { set(d => ({ ...d, sel: id })); if (id) setTimeout(() => document.querySelector(`[data-row-select="${id}"]`)?.scrollIntoView?.({ block: 'nearest' }), 0) }

  useEffect(() => { if (open && win.step === 'compose' && !working) setTimeout(() => { if (!draft.goal) goalRef.current?.focus() }, 0) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  // a step change (Review, Back, the campaign created, a new one): the button that was pressed is unmounted, so the title of the new step takes the focus
  const stepTitle = useRef(null)
  const lastStep = useRef(win.step)
  useEffect(() => {
    if (lastStep.current === win.step) return
    lastStep.current = win.step
    if (open) stepTitle.current?.focus()
  }, [win.step, open])

  const created = win.created
  const launched = created?.launched
  const cancelled = created?.cancelled
  const guardItem = created ? { board: created.board, id: created.head, title: guardTitle(created.goal), head: true, campaignSize: created.size } : null
  const status = useMemo(() => {
    if (win.step !== 'created' || !created) return null
    const m = new Map()
    for (const c of g.cards) m.set(c.id, cancelled ? 'archived' : isGuard(c) ? (c.phase === 0 && launched ? 'done' : 'blocked') : (launched && c.parents.includes(HEAD) ? 'ready' : 'todo'))
    return m
  }, [win.step, created, g, launched, cancelled])
  const issueText = i => t(`campaign.issue.${i.code.startsWith('graph:') ? 'graph' : i.code}`, i.code.startsWith('graph:') ? t(`orders.reason.${i.code.slice(6)}`) : code[i.id] || (i.phase != null ? letter(i.phase) : ''))

  /* ---------- the three steps ---------- */
  const graphPane = (readOnly, big = false) => (
    <div className={`oc-cgp${big ? ' big' : ''}`} data-graph-pane>
      <div className="gbar"><b>{readOnly ? (win.step === 'created' ? t('campaign.graph.created') : t('campaign.graph.final')) : t('campaign.graph.title')}</b>
        <span className="oc-mono sm">{t('campaign.counts', sum.work, sum.guards, sum.links)}</span>
        {!readOnly ? <DlgTip name={t('campaign.graph.title')}>{t('campaign.graph.tip')}</DlgTip> : null}</div>
      <CampaignGraph cards={g.cards} info={info} colors={colors} sceneBy={sceneBy} phases={draft.phases} selected={readOnly ? (win.step === 'review' ? A.lint.selected : null) : draft.sel}
        onSelect={readOnly ? null : selectCard} open={unfolded} onToggle={toggleGroup} label={t('campaign.graph.label', sum.work + sum.guards)} status={status} marked={readOnly ? null : A.left} />
      <BotLegend list={sum.bots} colors={colors} sceneBy={sceneBy} label={t('campaign.bots')} marked={readOnly ? 0 : A.left.size} />
    </div>
  )

  const compose = (
    <>
      <div className={`oc-cghead${nb ? ' has-nb' : ''}`}>
        <div className="oc-dg-fl goal"><span className="oc-dg-lab"><label htmlFor={`${uid}-goal`}>{t('campaign.goal')}</label><small className="oc-mono" id={`${uid}-goal-n`}>{draft.goal.length}/{MAX_GOAL}</small></span>
          <input ref={goalRef} id={`${uid}-goal`} data-cg="goal" value={draft.goal} maxLength={MAX_GOAL} placeholder={t('campaign.goalPh')} aria-describedby={`${uid}-goal-n`} onChange={e => set(d => ({ ...d, goal: e.target.value }))} /></div>
        <label className="oc-dg-fl tgt"><span className="oc-dg-lab">{t('campaign.project')}</span>
          <select data-cg="project" value={nb ? NEW : draft.board} onChange={e => chooseProject(e.target.value)}>
            {!draft.board && !nb ? <option value="">{t('campaign.projectPick')}</option> : null}
            {boards.map(b => <option key={b.slug} value={b.slug}>{b.slug}</option>)}
            <option value={NEW}>{t('campaign.projectNew')}</option>
          </select></label>
        <div className={`oc-dg-fl tplb${A.ready.campaign ? ' lm2' : ''}`}><span className="oc-dg-lab">{A.ready.campaign ? t('llm.cg.base') : t('campaign.tpl.label')}</span>
          <TplBar on={A.ready.campaign}>
            <button type="button" className="ux-b" data-cg="tpl" aria-expanded={tplOpen && !A.cg.open} onClick={() => { A.cg.setOpen(false); setTplOpen(v => !v) }}><Icon name="layers" size={14} />{t('campaign.tpl.title')}</button>
            {A.ready.campaign ? <button type="button" className="ux-b oc-lm-b" data-cg="lm-open" aria-expanded={A.cg.open} onClick={() => { setTplOpen(false); A.cg.setOpen(!A.cg.open) }}><DlgIcon id="spark" size={14} />{t('llm.cg.open')}</button> : null}
          </TplBar></div>
        {nb ? (
          <div className="nb" role="group" aria-label={t('campaign.nb.title')} style={{ '--pc': nextProjectColor(boards) }}>
            <span className="nbi" aria-hidden="true"><i /></span>
            <div className="oc-dg-fl nbn"><span className="oc-dg-lab"><label htmlFor={`${uid}-nbname`}>{t('campaign.nb.name')}</label><small className="oc-mono" id={`${uid}-nbname-n`}>{draft.nb.name.length}/{MAX_NAME}</small></span>
              <input id={`${uid}-nbname`} data-nb="name" value={draft.nb.name} maxLength={MAX_NAME} aria-describedby={`${uid}-nbname-n`} onChange={e => set(d => ({ ...d, nb: { ...d.nb, name: e.target.value, slug: d.nb.typed ? d.nb.slug : slugify(e.target.value) } }))} /></div>
            <label className="oc-dg-fl nbs"><span className="oc-dg-lab">{t('campaign.nb.slug')}</span>
              <input data-nb="slug" className="oc-mono" value={draft.nb.slug} maxLength={64} spellCheck={false} autoCapitalize="off" aria-invalid={!slugSt.ok || undefined} aria-describedby={`${uid}-nbh`}
                onChange={e => set(d => ({ ...d, nb: { ...d.nb, slug: e.target.value, typed: true } }))} /></label>
            <p className={`nbh ${slugSt.ok ? 'ok' : 'ko'}`} id={`${uid}-nbh`} aria-live="polite" data-slug-state={slugSt.code}><Icon name={slugSt.ok ? 'check' : 'warn'} size={14} /><span>{t(`campaign.nb.${slugSt.code}`, draft.nb.slug)}</span></p>
          </div>
        ) : null}
      </div>
      {A.ready.campaign && A.cg.open ? <GraphPanel A={A} draft={draft} colors={colors} onClose={A.cg.close} /> : null}
      {tplOpen && !(A.ready.campaign && A.cg.open) && bots.length ? <Templates draft={draft} apply={apply} bots={bots} colors={colors} t={t} L={L} onClose={() => setTplOpen(false)} /> : null}
      {refused ? <Notice tone="warn" icon="alert" data-refused>{t(`campaign.refused.${refused}`)}</Notice> : null}
      <div className="oc-cgseg" role="group" aria-label={t('campaign.view')}>
        <span className="oc-dg-seg">
          <button type="button" aria-pressed={view === 'list'} data-cgm="list" onClick={() => setView('list')}>{t('campaign.viewList')}</button>
          <button type="button" aria-pressed={view === 'graph'} data-cgm="graph" onClick={() => setView('graph')}>{t('campaign.viewGraph')}</button>
        </span>
      </div>
      <div className={`oc-cgbody m-${view}`}>
        <div className="oc-cglist" data-cg-list>
          <ul className="oc-cgph" aria-label={t('campaign.cards')}>
            {draft.phases.map((p, k) => {
              const rows = draft.cards.filter(c => c.phase === k)
              const guard = rows.find(isGuard)
              return (
                <li key={k} className="ph" data-phase={k}>
                  <div className="phh"><span className="pl" aria-hidden="true">{letter(k)}</span>
                    <input className="phn" value={p.name} maxLength={MAX_NAME} aria-label={t('campaign.phaseName', letter(k))} data-phase-name={k} onChange={e => set(d => renamePhase(d, k, e.target.value))} />
                    <span className="oc-mono n">{t('campaign.phaseCards', rows.filter(c => !isGuard(c)).length)}</span></div>
                  {k === 0 ? (
                    <div className="oc-cgguard" data-guard-row="head"><Icon name="lock" size={14} /><span className="tt"><b>{t('campaign.guard.head')}</b><small>{t('campaign.guard.headNote')}</small></span><span className="lockd">{t('campaign.guard.always')}</span></div>
                  ) : guard ? (
                    <div className="oc-cgguard" data-guard-row={k}><Icon name="lock" size={14} /><span className="tt"><b>{t('campaign.guard.phase', letter(k))}</b><small>{t('campaign.guard.phaseNote', letter(k - 1))}</small></span>
                      <button type="button" className="ux-b sm ico ghost" aria-label={t('campaign.guard.remove', letter(k))} data-guard-del={k} onClick={() => set(d => removeCard(d, guard.id))}><Icon name="x" size={14} /></button></div>
                  ) : (
                    <div className="oc-cgguard off" data-guard-row={k}><Icon name="lock" size={14} /><span className="tt"><small>{t('campaign.guard.none', letter(k))}</small></span>
                      <button type="button" className="ux-b sm" data-guard-add={k} onClick={() => set(d => addGuard(d, k))}><Icon name="plus" size={14} />{t('campaign.guard.add')}</button></div>
                  )}
                  <ul className="oc-cgrows">
                    {rows.filter(c => !isGuard(c)).map(c => (
                      <Row key={c.id} c={c} d={dd} code={code[c.id]} deps={c.parents.filter(x => !isGuard(draft.cards.find(y => y.id === x) || {})).map(x => code[x]).filter(Boolean)} colors={colors} sceneBy={sceneBy}
                        bots={bots} defModel={defModel} modelOpts={modelOpts} sel={draft.sel === c.id} notes={notes.has(c.id)} onPatch={patch} onSelect={selectCard} A={A}
                        onDup={id => set(d => duplicateCard(d, id))} onDel={id => set(d => removeCard(d, id))} onDep={dep} t={t} />
                    ))}
                  </ul>
                  {k === 0 && sum.work === 0 ? (
                    <div className="oc-cgstart" data-cg-starter>
                      <p>{t('campaign.starter')}</p>
                      <div className="acts">
                        <button type="button" className="ux-b sm" data-cg-starter-tpl aria-expanded={tplOpen && !A.cg.open} onClick={() => { A.cg.setOpen(false); setTplOpen(true) }}><Icon name="layers" size={14} />{t('campaign.tpl.pick')}</button>
                        <button type="button" className="ux-b sm" data-add-card={k} aria-disabled={isNoBot || undefined} onClick={() => { if (!isNoBot) add(k) }}><Icon name="plus" size={14} />{t('campaign.addCard')}</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="ux-b sm ghost" data-add-card={k} aria-disabled={sum.work >= MAX_WORK_CARDS || isNoBot || undefined} onClick={() => { if (sum.work < MAX_WORK_CARDS && !isNoBot) add(k) }}><Icon name="plus" size={14} />{t('campaign.addCard')}</button>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="oc-cgaddph">
            <button type="button" className="ux-b sm" data-add-phase aria-disabled={draft.phases.length >= 8 || undefined} onClick={() => set(d => addPhase(d, t('campaign.tpl.phase', letter(d.phases.length))))}><Icon name="plus" size={14} />{t('campaign.addPhase')}</button>
            {draft.phases.length > 1 ? <button type="button" className="ux-b sm ghost" data-remove-phase onClick={() => set(d => removeLastPhase(d))}><Icon name="trash" size={14} />{t('campaign.removePhase')}</button> : null}
            <DlgTip name={t('campaign.addPhase')}>{t('campaign.guard.tip')}</DlgTip>
          </div>
        </div>
        {graphPane(false)}
      </div>
    </>
  )

  const review = (
    <div className="oc-cgrev">
      {graphPane(true, true)}
      <aside className="oc-cgsum" aria-label={t('campaign.sum.title')} data-summary>
        {A.ready.lint ? <LintPanel A={A} cardCount={sum.work} /> : null}
        <div className="sx"><h4>{t('campaign.sum.project')}</h4>
          {nb ? <p><span className="ux-prj nw" style={{ '--pc': nextProjectColor(boards) }}><i aria-hidden="true" /><span>{draft.nb.slug}</span></span> <span className="mut">{t('campaign.sum.new', draft.nb.name)}</span></p>
            : <p><span className="ux-prj" style={{ '--pc': 'var(--ui-text-tertiary)' }}><i aria-hidden="true" /><span>{draft.board}</span></span> <span className="mut">{t('campaign.sum.existing', boards.find(b => b.slug === draft.board)?.total ?? 0)}</span></p>}
          {nb ? <p className="mut small">{t('campaign.sum.newNote')}</p> : null}</div>
        <div className="sx"><h4>{t('campaign.sum.cards')}</h4><p className="big"><b className="oc-mono">{sum.cards}</b> <span>{t('campaign.sum.oneWrite')}</span></p>
          <p className="mut">{t('campaign.counts', sum.work, sum.guards, sum.links)}</p></div>
        <div className="sx"><h4>{t('campaign.sum.bots')} <span className="oc-mono mut">{sum.bots.length}</span></h4>
          <ul className="bl">{sum.bots.map(([n, k]) => <li key={n} style={{ '--bc': colors.get(n) }}><i aria-hidden="true" /><b>{n}</b><span className="oc-mono">{k}</span></li>)}</ul></div>
        <div className="sx"><h4>{t('campaign.sum.models')}</h4>
          {sum.pins.length ? sum.pins.map(c => <p key={c.id}><span className="oc-mono">{code[c.id]}</span> {t('campaign.sum.imposes')} <b className="oc-mono">{c.model}</b><br /><span className="mut">{t('campaign.sum.botDefault', c.who, defModel(c.who) || '—')}</span></p>)
            : <p className="mut">{t('campaign.sum.noPin')}</p>}</div>
        <div className="sx"><h4>{t('campaign.sum.guards')}</h4>
          {g.cards.filter(isGuard).map(x => <p key={x.id} className="gd"><Icon name="lock" size={14} /><span><b>{x.phase ? t('campaign.sum.phase', letter(x.phase)) : t('campaign.sum.head')}</b> · {x.phase ? t('campaign.sum.phaseGuard', letter(x.phase - 1)) : t('campaign.sum.headGuard')}</span></p>)}</div>
        <div className="sx after"><h4>{t('campaign.sum.after')}</h4><p><Icon name="pause" size={14} /><span>{t('campaign.sum.nothingRuns')}</span></p></div>
      </aside>
    </div>
  )

  const doneBanner = cancelled ? (
    <div className="oc-cgban nt" role="status" data-banner="cancelled"><Icon name="trash" size={16} /><div><b>{t('campaign.cancelled.title')}</b>
      <span>{t('campaign.cancelled.body', cancelled.archived ?? created.size, created.size, created.board)}</span></div></div>
  ) : launched ? (
    <div className="oc-cgban ok" role="status" data-banner="launched"><Icon name="check" size={16} /><div><b>{t('campaign.launched.title')}</b>
      <span>{t('campaign.launched.body', launched.ready ?? '?', created.starts.join(', '))}</span></div></div>
  ) : created ? (
    <div className="oc-cgban ok" role="status" data-banner="created"><Icon name="check" size={16} /><div><b>{t('campaign.created.title')}</b>
      <span>{t('campaign.created.body', created.size, created.links, created.counts?.blocked ?? '?', created.counts?.running ?? '?', created.boardCreated ? created.board : '')}</span></div></div>
  ) : null
  const kp = created ? (cancelled ? [['arc', cancelled.archived ?? created.size, t('campaign.kpi.archived')], ['run', 0, t('campaign.kpi.running')]]
    : launched ? [['ready', launched.ready ?? 0, t('campaign.kpi.ready')], ['todo', Math.max(0, sum.work - (launched.ready ?? 0)), t('campaign.kpi.waiting')], ['guard', Math.max(0, sum.guards - 1), t('campaign.kpi.guardsLeft')]]
      : [['run', created.counts?.running ?? 0, t('campaign.kpi.running')], ['guard', created.counts?.blocked ?? sum.guards, t('campaign.kpi.guards')], ['todo', created.counts?.todo ?? sum.work, t('campaign.kpi.waiting')]]) : []
  const orderHere = mine && created && o?.task === created.head
  const confirming = orderHere && phase === 'confirm'
  const actions = created && !cancelled && !launched && !confirming && !(orderHere && phase !== 'idle') ? (
    <div className="oc-cggo">
      {writes.includes('launch') ? (
        <div className="go"><div><b>{t('campaign.go.title')}</b><small>{t('campaign.go.body', created.starts.join(', ') || '—')}</small></div>
          <button type="button" className="ux-b pri" data-cg-launch aria-disabled={isBusy(orders.state) || replay || undefined} onClick={() => { if (!isBusy(orders.state) && !replay) orders.requestGuard('launch', guardItem, { starts: created.starts }) }}><Icon name="play" size={14} />{t('orders.verb.launch')}</button></div>
      ) : <Notice tone="neutral" icon="info">{t('campaign.go.unavailable')}</Notice>}
      {writes.includes('cancel_campaign') ? <button type="button" className="ux-b sm danger" data-cg-cancel aria-disabled={isBusy(orders.state) || replay || undefined} onClick={() => { if (!isBusy(orders.state) && !replay) orders.requestGuard('cancel_campaign', guardItem) }}><Icon name="trash" size={14} />{t('orders.verb.cancel_campaign')}</button> : null}
    </div>
  ) : null
  const createdView = created ? (
    <div className="oc-cgcre">
      {doneBanner}
      <div className="oc-cgkp" role="group" aria-label={t('campaign.kpi.label')}>{kp.map(([k, n, l]) => <div key={k} className={`k ${k}`}><b className="oc-mono">{n}</b><small>{l}</small></div>)}</div>
      {graphPane(true, true)}
      {actions}
      {launched ? <p className="oc-cgwhere"><Icon name="info" size={14} /><span>{t('campaign.launched.where')}</span></p> : !cancelled ? <p className="oc-cgwhere"><Icon name="info" size={14} /><span>{t('campaign.created.where')}</span></p> : <p className="oc-cgwhere"><Icon name="info" size={14} /><span>{t('campaign.cancelled.where')}</span></p>}
    </div>
  ) : null

  // what an order of this window says while it is in flight, and the outcome of a refusal or a failure (a success is read into the window)
  const inFlight = mine && (phase === 'counting' || phase === 'sending' || phase === 'verifying')
  const failed = out && !out.cancelled && !out.ok && (out.verb === 'campaign' || out.verb === 'launch' || out.verb === 'cancel_campaign')
  const progress = inFlight || failed || (out?.cancelled && out.verb === 'campaign') ? <OrderProgress orders={orders} /> : null
  const confirmBox = confirming ? <OrderConfirm orders={orders} /> : null

  const alertSlot = (
    <div className="oc-dg-al" role="alert" data-campaign-errors>
      {win.step === 'compose' && attempted ? issues.slice(0, 4).map((i, k) => <Notice key={`${i.code}${i.id || i.phase || ''}${k}`} tone="bad" icon="alert">{issueText(i)}</Notice>) : null}
      {win.step === 'compose' && attempted && issues.length > 4 ? <Notice tone="bad" icon="alert">{t('campaign.issue.more', issues.length - 4)}</Notice> : null}
    </div>
  )
  const step = win.step
  const startSlot = step === 'compose' ? (
    <>
      {/* a check appears once there is something to check (a card), and only the ones that can fail: « behind a guard » is true by construction (effective() adds the guards), so it is not a check */}
      <span className="oc-cgchk" data-checks>
        {sum.work > 0 ? (
          <>
            <span className={`ck ${g.loop ? 'ko' : 'ok'}`}><Icon name={g.loop ? 'warn' : 'check'} size={14} />{t('campaign.ck.noLoop')}</span>
            <span className={`ck ${sum.work > MAX_WORK_CARDS || isNoBot ? 'ko' : 'ok'}`}><Icon name={sum.work > MAX_WORK_CARDS ? 'warn' : 'check'} size={14} />{t('campaign.ck.count', sum.work, MAX_WORK_CARDS)}</span>
          </>
        ) : null}
        {missing.length ? <span className="miss" id={`${uid}-miss`} data-missing>{t('campaign.missing', missing.map(k => t(`campaign.missingPart.${k}`)).join(', '))}</span> : null}
      </span>
      <LeftBar A={A} />
      {!draftIsEmpty(draft) ? (confirmClear
        ? <span className="oc-cgclr" role="group" aria-label={t('campaign.clear.label')}><span>{t('campaign.clear.ask')}</span>
            <button type="button" className="ux-b sm" data-clear-no onClick={() => setConfirmClear(false)}>{t('campaign.clear.keep')}</button>
            <button type="button" className="ux-b sm danger" data-clear-yes onClick={clear}>{t('campaign.clear.go')}</button></span>
        : <><button type="button" className="oc-dg-link" data-clear onClick={() => setConfirmClear(true)}>{t('campaign.clear.button')}</button><span className="oc-dg-kept" data-cg-kept>{t('dlg.draftKept')}</span></>) : null}
    </>
  ) : step === 'review' ? <small className="faint oc-cgnote" data-review-note>{t('campaign.review.note', UNDO_SECONDS)}</small> : null
  const actionSlot = step === 'compose' ? (
    <>
      <button type="button" className="oc-btn" data-cg-close onClick={close}>{t('campaign.close')}</button>
      <button type="button" className="oc-btn oc-primary" data-cg-review aria-disabled={!ok || undefined} aria-describedby={missing.length ? `${uid}-miss` : undefined} onClick={goReview}>{t('campaign.toReview')}</button>
    </>
  ) : step === 'review' ? (
    inFlight ? null : (
      <>
        <button type="button" className="oc-btn" data-cg-back onClick={() => dispatch({ type: 'back' })}>{t('campaign.back')}</button>
        <button type="button" className="oc-btn oc-primary" data-cg-create aria-disabled={!ok || isBusy(orders.state) || replay || undefined} onClick={create}>
          {nb ? t('campaign.createNew', sum.cards, draft.nb.slug) : t('campaign.create', sum.cards, draft.board)}</button>
      </>
    )
  ) : (
    <>
      {cancelled ? <button type="button" className="oc-btn" data-cg-recompose onClick={() => dispatch({ type: 'recompose' })}>{t('campaign.recompose')}</button> : null}
      {launched ? <button type="button" className="oc-btn" data-cg-new onClick={clear}>{t('campaign.newOne')}</button> : null}
      <button type="button" className="oc-btn oc-primary" data-cg-close onClick={close}>{created && !launched && !cancelled ? t('campaign.later') : t('campaign.close')}</button>
    </>
  )

  return (
    <Dlg open={open} onClose={close} title={t('campaign.title')} icon="campaign" size="l" className="oc-cg-dlg" data-campaign-dialog data-step={step}
      chip={<DlgChip risk="final" />} onCancel={exit}
      onKeyDown={e => { if (escapeCloses(e)) { e.preventDefault(); e.stopPropagation(); exit() } }}
      alert={alertSlot} start={startSlot} actions={confirming ? null : actionSlot}>
      <style>{CAMPAIGN_CSS}</style>
      <div className="oc-cg" data-campaign data-step={step}>
        <Stepper step={step} t={t} titleRef={stepTitle} />
        <Live A={A} />
        {isNoBot ? <Notice tone="warn" icon="alert" data-no-bots>{t('campaign.noBots')}</Notice> : null}
        {step === 'compose' ? compose : step === 'review' ? review : createdView}
        {confirmBox}
        {progress}
        {orders.state.notice === 'busy' ? <Notice tone="warn" icon="alert" data-refused>{t('orders.refused.busy')}</Notice> : null}
      </div>
    </Dlg>
  )
}


