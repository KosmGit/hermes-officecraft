import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { answerReread } from '../core/approvals.js'
import { campaignBoardNote } from '../core/campaign.js'
import { backAction } from '../core/orderflow.js'
import { COMMENT_MAX, JOURNAL_SHOWN, ORDERS, UNDO_SECONDS, isBusy, isUnknownOutcome, keyCancels, riskOf } from '../core/orders.js'
import { CARD_STATUSES, cardRef } from '../core/panel.js'
import { Icon } from './icons.jsx'
import { useT } from './useT.js'

const STATUS = new Set(CARD_STATUSES)
const statusText = (t, s) => (STATUS.has(s) ? t(`status.${s}`) : String(s ?? ''))
// an approval names the agent and the session; every other order names its board and card
const RECRUIT = new Set(['recruit', 'recruitModel'])
const target = o => (o.verb === 'approval' ? [o.agent, o.title].filter(Boolean).join(' · ') || '—' : RECRUIT.has(o.verb) || o.verb === 'revise' ? o.code : `${o.board} · ${o.code}`)
// « Approbation : Refuser » (French puts a space before the colon): the pattern is translated, not glued in code
const verbLabel = (o, t) => (o.verb === 'approval' ? t('approvals.verbChoice', t(`approvals.choice.${o.choice}`)) : t(`orders.verb.${o.verb}`))
const what = (o, t) => `${verbLabel(o, t)} ${target(o)}`

/**
 * The risk class of an order, on every button and readable without the colour: a neutral pip in the colour of the button's text
 * (filled = final, half = reversible, hollow = no risk). Never a warning triangle (it reads « danger ») nor a tick (it reads « validate »,
 * wrong on « Refuse »). The word is for the screen reader and the tooltip; the legend is behind the « ? » of the list.
 */
export function RiskDot({ risk, t }) {
  return (
    <span className={`ux-rk ux-rk-${risk}`} title={t(`orders.riskTip.${risk}`)} data-risk={risk}>
      <span className="ux-vh">({t(`orders.risk.${risk}`)})</span>
    </span>
  )
}

/** The class as a chip (word + the same pip): in the header of a confirmation and of the dialogs. */
export function RiskTag({ risk, t }) {
  return (
    <span className={`ux-riskchip ${risk}`} title={t(`orders.riskTip.${risk}`)} data-risk={risk}>
      <span className={`ux-rk ux-rk-${risk}`} aria-hidden="true" />
      {t(`orders.risk.${risk}`)}
    </span>
  )
}

const ICON = { unblock: 'unlock', comment: 'msg', launch: 'play', cancel_campaign: 'trash' }

function OrderButton({ verb, item, orders, t, primary, onClick }) {
  const busy = isBusy(orders.state)
  return (
    <button
      type="button"
      className={`ux-b sm${primary ? ' pri' : ''}${verb === 'cancel_campaign' ? ' ghost cx' : ''}`}
      data-order={verb}
      data-card={item.id}
      data-board={item.board}
      aria-disabled={busy && ORDERS[verb].writes ? true : undefined}
      onClick={onClick}
    >
      {ICON[verb] ? <Icon name={ICON[verb]} size={14} /> : null}
      {verb === 'cancel_campaign' ? (
        // « Cancel the campaign » is not « Launch »: discreet, at the right, and just « Cancel » where the room is short (the full words stay the button's name)
        <><span className="full">{t(`orders.verb.${verb}`)}</span><span className="short" aria-hidden="true">{t(`orders.verbShort.${verb}`)}</span></>
      ) : t(`orders.verb.${verb}`)}
      <RiskDot risk={ORDERS[verb].risk} t={t} />
    </button>
  )
}

/** The comment being written: a bounded text area, its counter, Ctrl+Enter to go on, Escape to give up. */
function Draft({ item, orders, t }) {
  const { state, act, setText } = orders
  const ref = useRef(null)
  const text = state.order.text || ''
  useEffect(() => { ref.current?.focus() }, [])
  const onKey = e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); act('review') }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); act('cancel') }
  }
  const near = text.length >= COMMENT_MAX * 0.9
  return (
    <div className="ux-cf" role="group" aria-label={t('orders.draftLabel', target(state.order))} data-draft>
      <label htmlFor={`oc-text-${item.id}`} className="fine">{t('orders.textLabel', target(state.order))}</label>
      <textarea
        id={`oc-text-${item.id}`}
        ref={ref}
        className="oc-text"
        rows={4}
        maxLength={COMMENT_MAX}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKey}
        aria-describedby={`oc-count-${item.id} oc-keys-${item.id}`}
      />
      <div className="meta">
        <span id={`oc-count-${item.id}`} className={`ux-mono${near ? ' near' : ''}`} data-counter>{t('orders.counter', text.length, COMMENT_MAX)}</span>
        <span id={`oc-keys-${item.id}`}>{t('orders.keys')}</span>
      </div>
      {state.notice === 'empty_text' ? <p className="note" role="alert">{t('orders.reason.empty_text')}</p> : null}
      <div className="row">
        <button type="button" className="ux-b sm" data-order-cancel onClick={() => act('cancel')}>{t('orders.dismiss')}</button>
        <button type="button" className="ux-b sm pri" data-order-review aria-disabled={text.trim() ? undefined : true} onClick={() => act('review')}>{t('orders.continue')}</button>
      </div>
    </div>
  )
}

/** The same confirmation for the approval rows and the recruitment window (reads `t` itself). `children`: what the caller shows of the target, above the effect. */
export function OrderConfirm({ orders, blocked = false, children = null }) {
  return <Confirm orders={orders} blocked={blocked} t={useT()}>{children}</Confirm>
}

/** The explicit confirmation of a final order: names the project and the card (or the agent and the session), says what happens, then Confirm or Back. */
function Confirm({ orders, t, blocked = false, children = null }) {
  const { state, act } = orders
  const o = state.order
  const ref = useRef(null)
  // `blocked`: what the caller shows above has not been read to its end; Confirm is announced unavailable, does nothing, and
  // takes the focus only once it can be used (the caller keeps the focus on what is left to read)
  useEffect(() => { if (!blocked) ref.current?.focus() }, [blocked])
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); act('cancel') } }
  const verb = verbLabel(o, t)
  const approval = o.verb === 'approval'
  const recruit = RECRUIT.has(o.verb)
  const effect = approval ? t(`approvals.effect.${o.choice}`)
    : o.verb === 'recruit' ? t('recruit.effect', o.code)
    : o.verb === 'recruitModel' ? t('recruit.effectModel', o.code, `${o.model} (${o.provider})`)
    : o.verb === 'comment' ? t('orders.effect.comment', (o.text || '').length)
    : o.verb === 'launch' ? (o.starts?.length ? t('orders.effect.launchNamed', o.starts.join(', ')) : t('orders.effect.launch'))
    : o.verb === 'cancel_campaign' ? t('orders.effect.cancel', o.size ?? '?') : t('orders.effect.unblock')
  return (
    <div className="ux-cf oc-confirm" role="group" aria-label={t('orders.confirmLabel', `${verb} ${target(o)}`)} data-confirm onKeyDown={onKey}>
      <p className="ctitle"><b>{t('orders.confirmTitle', verb)}</b> <RiskTag risk={riskOf(o)} t={t} /></p>
      <p>{t(approval ? 'approvals.target' : recruit ? 'recruit.target' : 'orders.target')} <b className="ux-mono">{target(o)}</b></p>
      {children}
      {o.verb === 'recruitModel' && o.message ? <p className="oc-hermesmsg" data-hermes-message>{t('recruit.hermesSays')} {o.message}</p> : null}
      <p>{effect}</p>
      <p className="fine">{t('orders.undoNote', UNDO_SECONDS)}</p>
      <div className="row">
        <button type="button" className="ux-b sm" data-order-back onClick={() => act(backAction(o))}>{t('orders.back')}</button>
        <button ref={ref} type="button" className="ux-b sm pri" data-order-confirm aria-disabled={blocked ? true : undefined} onClick={() => { if (!blocked) act('confirm') }}>{t('orders.confirm')}</button>
      </div>
    </div>
  )
}

/** « Open in the kanban »: an icon in the header of the card (no risk, nothing written, nothing journaled). */
export function CardOpen({ item, openKanban, openSession = null, t }) {
  if (!openKanban && !openSession) return null
  return (
    <>
      {openSession ? (
        <button type="button" className="ux-b sm ico ghost op" data-order="openSession" data-card={item.id} data-board={item.board} aria-label={t('ux.dec.openSession', item.assignee)} onClick={() => openSession()}>
          <Icon name="msg" size={14} />
        </button>
      ) : null}
      {openKanban ? (
        <button type="button" className="ux-b sm ico ghost op" data-order="openKanban" data-card={item.id} data-board={item.board} aria-label={t('ux.dec.openKanban', [item.code, item.title].filter(Boolean).join(' ') || item.id)} onClick={() => openKanban()}>
          <Icon name="ext" size={14} />
        </button>
      ) : null}
    </>
  )
}

/**
 * The orders of one blocked card (one row of buttons) and, below, what is its own order's: the draft, the confirmation, the 6 s window
 * and the outcome, all inside the card. Orders the agent half does not announce are not
 * drawn (never greyed in silence).
 */
export function CardOrders({ item, orders, writes, t, onModelFollowUp }) {
  const o = orders.state.order
  const mine = o && o.board === item.board && o.task === item.id
  const phase = orders.state.phase
  const out = orders.state.outcome
  const outMine = out && out.board === item.board && out.task === item.id
  // the guard of a campaign is launched (never unblocked) and, if it is the head guard, can be cancelled; it takes no comment
  const buttons = item.guard
    ? [writes.includes('launch') ? 'launch' : null, item.head && writes.includes('cancel_campaign') ? 'cancel_campaign' : null].filter(Boolean)
    : [writes.includes('unblock') ? 'unblock' : null, writes.includes('comment') ? 'comment' : null].filter(Boolean)
  if (!buttons.length && !mine && !outMine) return null
  const showBox = mine && (phase === 'draft' || phase === 'confirm')
  const showProgress = (mine && (phase === 'counting' || phase === 'sending' || phase === 'verifying' || phase === 'done')) || (!mine && outMine && phase === 'idle')
  return (
    <>
      {buttons.length && !showBox ? (
        <div className="ux-dc-o" role="group" aria-label={t('orders.group', item.code || item.id)} data-orders>
          {buttons.map(v => <OrderButton key={v} verb={v} item={item} orders={orders} t={t} primary={v === 'unblock' || v === 'launch'} onClick={() => (item.guard ? orders.requestGuard(v, item) : orders.request(v, item))} />)}
        </div>
      ) : null}
      {showBox ? (phase === 'draft' ? <Draft item={item} orders={orders} t={t} /> : <Confirm orders={orders} t={t} />) : null}
      {showProgress ? <OrderProgress orders={orders} onModelFollowUp={onModelFollowUp} /> : null}
    </>
  )
}

/** The line an outcome says, in the page's language. Only facts read back; the reason is a translated code. */
function outcomeText(o, t) {
  const verb = verbLabel(o, t)
  if (o.leftSent) return [t('orders.sentLeft', what(o, t)), t(o.verb === 'revise' ? 'llm.revise.check' : o.verb === 'recruit' || o.verb === 'recruitModel' ? 'recruit.checkList' : 'orders.checkJournal')].join(' ')   // the page was left while the order was on its way
  if (o.cancelled) return o.reason === 'left' ? t('orders.cancelledLeft', what(o, t)) : t(o.reason === 'hidden' ? 'orders.cancelledHidden' : 'orders.cancelled')   // left the page during the 6 s
  if (o.ok) {
    if (o.verb === 'approval') {
      const line = answerReread(o) ? t(`approvals.done.${o.choice}`, target(o)) : t('approvals.notReread', t(`approvals.choice.${o.choice}`), target(o))
      return [line, o.audited ? '' : t('orders.notAudited')].filter(Boolean).join(' ')
    }
    if (RECRUIT.has(o.verb)) {
      const d = o.detail || {}
      const line = o.verb === 'recruitModel'
        ? t(o.present === true ? 'recruit.done.model' : 'recruit.done.modelUnread', o.code)
        : t(o.present === true ? 'recruit.done.created' : 'recruit.done.createdUnread', o.code)
      const failed = d.failed?.length ? t('recruit.failedParts', d.failed.map(k => t(`recruit.part.${k}`)).join(', ')) : ''
      const held = d.modelHeld ? t('recruit.modelHeld') : ''
      return [line, failed, held, o.audited ? '' : t('orders.notAudited')].filter(Boolean).join(' ')
    }
    // a revised description says that `profiles.list` shows it now (or that the list could not be read: nothing is claimed)
    if (o.verb === 'revise') return t(o.present === true ? 'llm.revise.done' : 'llm.revise.doneUnread', o.code)
    // a campaign's three orders say what the agent half READ BACK (cards created / made ready / archived), nothing else
    const base = o.verb === 'unblock' ? t('orders.done.unblock', target(o), statusText(t, o.after))
      : o.verb === 'launch' ? t('orders.done.launch', target(o), o.ready ?? '?')
      : o.verb === 'cancel_campaign' ? t('orders.done.cancel', target(o), o.archived ?? '?')
      : o.verb === 'campaign' ? t('orders.done.campaign', o.board, o.detail?.created ?? '?')
      : t('orders.done.comment', target(o), o.comments ?? '?')
    return [base, o.replayed ? t('orders.replayed') : '', o.audited ? '' : t('orders.notAudited'), o.liveOk ? '' : t('orders.liveStale')].filter(Boolean).join(' ')
  }
  const why = t(`orders.reason.${o.reason || 'unknown'}`)
  const checkNote = o.reason === 'unknown_outcome' ? t(o.verb === 'recruit' ? 'recruit.checkList' : o.verb === 'revise' ? 'llm.revise.check' : 'orders.checkJournal') : ''
  const notListed = o.reason === 'not_listed' ? t('recruit.createdNotListed', o.code) : ''
  // a campaign that failed on a new project says what became of that project
  const boardNote = campaignBoardNote(o)
  // a lost answer is « unknown », not « did not go through » (the order may have been executed)
  return [t(isUnknownOutcome(o) ? 'orders.unknown' : 'orders.failed', `${verb} ${target(o)}`, why), notListed, checkNote, boardNote ? t(boardNote.key, boardNote.board) : ''].filter(Boolean).join(' ')
}

/**
 * What an order in flight shows, inside its card or in the floating bar: the 6 s window with « Cancel » (it takes the focus), then
 * « in progress » (no state shown yet), then the outcome read back, or the cancellation. The countdown digits are aria-hidden; the one
 * polite live region is the bar's (each change said once, never every second). `data-order-host` tells the bar the card carries it.
 */
export function OrderProgress({ orders, onModelFollowUp = null, floating = false }) {
  const t = useT()
  const { state, act } = orders
  const cancelRef = useRef(null)
  const o = state.order
  const out = state.outcome
  // the cancel button takes the focus when the window opens
  // (a window that closes at the same moment — the recruitment dialog — hands the focus back to its opener: take it again right after)
  useEffect(() => {
    if (state.phase !== 'counting') return undefined
    cancelRef.current?.focus()
    const timer = setTimeout(() => { if (cancelRef.current && document.activeElement !== cancelRef.current) cancelRef.current.focus() }, 60)
    return () => clearTimeout(timer)
  }, [state.phase, o?.id])
  const host = floating ? {} : { 'data-order-host': '' }
  if (state.phase === 'counting' && o) {
    const line = t('orders.undoAnnounce', what(o, t), UNDO_SECONDS)
    return (
      <div className="ux-cd" role="group" aria-label={line} data-undo data-phase="counting" {...host} onKeyDown={e => { if (keyCancels(state, e.key)) { e.preventDefault(); e.stopPropagation(); act('cancel') } }}>
        <span className="tx" aria-hidden="true"><Icon name="clock" size={14} />{t('orders.undoLine', what(o, t), state.left)}</span>
        <RiskTag risk={riskOf(o)} t={t} />
        <button ref={cancelRef} type="button" className="ux-b sm" data-undo-cancel onClick={() => act('cancel')}>{t('orders.cancel')}</button>
        <i key={o.id} className="bar" aria-hidden="true" style={{ animationDuration: `${UNDO_SECONDS}s` }} />
      </div>
    )
  }
  if ((state.phase === 'sending' || state.phase === 'verifying') && o) {
    const line = t(state.phase === 'sending' ? 'orders.sending' : 'orders.verifying', what(o, t))
    return (
      <div className="ux-cd" data-undo data-phase={state.phase} {...host}>
        <span className="tx"><span className="ux-spin" aria-hidden="true" />{line}</span>
        <RiskTag risk={riskOf(o)} t={t} />
      </div>
    )
  }
  if (out) {
    const tone = out.cancelled ? 'cancel' : out.ok ? 'ok' : 'ko'
    return (
      <div className={`ux-cd ${tone}`} data-undo data-phase="done" data-result={tone} {...host}>
        <b className="tag">{t(`orders.tag.${isUnknownOutcome(out) ? 'unknown' : tone}`)}</b>
        <span className="tx">{outcomeText(out, t)}</span>
        {out.ok && out.detail?.modelHeld && onModelFollowUp ? (
          <button type="button" className="ux-b sm pri" data-recruit-model onClick={() => onModelFollowUp(out)}>{t('recruit.applyModel')}</button>
        ) : null}
        <button type="button" className="ux-b sm" data-undo-close onClick={() => act('dismiss')}>{t('orders.close')}</button>
      </div>
    )
  }
  return null
}

/**
 * The live region of the order in flight and, over the bottom of the page, the bar for an order that has no card on screen (panel folded,
 * narrow office view, the recruitment, a card filtered out): the same body as in the card (OrderProgress). When a card carries the
 * order (`[data-order-host]`) the bar draws nothing: one place at a time, one polite live region that says each change once.
 */
export function OrderBar({ orders, onFocusBack, onModelFollowUp = null }) {
  const t = useT()
  const { state } = orders
  const o = state.order
  const out = state.outcome
  const [hosted, setHosted] = useState(false)
  // looked up after every commit, before paint: a card that carries the order hides the bar in the same frame
  useLayoutEffect(() => {
    const found = Boolean(document.querySelector('[data-order-host]'))
    setHosted(prev => (prev === found ? prev : found))
  })
  // an outcome gives the focus back to what launched the order (or to the panel) so the keyboard is never left on a removed button
  const outcomeKey = out ? `${out.verb}/${out.board}/${out.code}/${out.cancelled ? 'c' : out.ok ? 'ok' : 'ko'}` : ''
  useEffect(() => { if (outcomeKey) onFocusBack?.(out) }, [outcomeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  let live = ''
  if (state.phase === 'counting' && o) live = t('orders.undoAnnounce', what(o, t), UNDO_SECONDS)
  else if ((state.phase === 'sending' || state.phase === 'verifying') && o) live = t(state.phase === 'sending' ? 'orders.sending' : 'orders.verifying', what(o, t))
  else if (out) live = outcomeText(out, t)
  const notice = state.notice === 'busy' || state.notice === 'too_late' ? t(`orders.refused.${state.notice}`) : ''
  const flying = (state.phase === 'counting' || state.phase === 'sending' || state.phase === 'verifying' || Boolean(out)) && !hosted
  return (
    <>
      <span className="oc-announce" data-order-live aria-live="polite" role="status">{[live, notice].filter(Boolean).join(' ')}</span>
      {flying || notice ? (
        <div className="oc-ordbar">
          {flying ? <OrderProgress orders={orders} onModelFollowUp={onModelFollowUp} floating /> : null}
          {notice ? <p className="oc-ordnote" data-refused>{notice}</p> : null}
        </div>
      ) : null}
    </>
  )
}

/** The newest orders of the audit journal, as rows for the journal tab: when, what, on which card, and the result (read from the agent half's journal). */
export function orderRows(journal, office, t) {
  if (!journal?.served) return []
  const known = new Map()
  for (const b of office?.boards || []) for (const c of b.tasks) known.set(`${b.slug}/${c.id}`, c)
  return (journal.data?.entries ?? []).slice(0, JOURNAL_SHOWN).map(e => {
    const card = known.get(`${e.board}/${e.task}`)
    const ref = card ? cardRef(card) : e.verb === 'recruit' ? e.profile : e.task
    const verb = e.verb === 'approval'
      ? (e.choice ? t('approvals.verbChoice', t(`approvals.choice.${e.choice}`)) : t('approvals.verb'))
      : ORDERS[e.verb] ? t(`orders.verb.${e.verb}`) : t(`orders.journalVerb.${e.verb}`)
    const extra = [
      e.result === 'done' && e.verb === 'unblock' && e.after ? t('orders.journalAfter', statusText(t, e.after)) : '',
      e.reason ? t(`orders.reason.${e.reason}`) : ''
    ].filter(Boolean).join(' · ')
    return { key: `order/${e.id}/${e.ms}`, kind: 'order', ms: e.ms, board: e.board || null, result: e.result, text: [verb, ref].filter(Boolean).join(' · '), resultText: t(`orders.result.${e.result}`), extra }
  })
}
