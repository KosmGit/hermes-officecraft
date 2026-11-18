import { useState } from 'react'

import { CHOICES, choiceRisk } from '../core/approvals.js'
import { isBusy } from '../core/orders.js'
import { DecisionFrame } from './DecisionCard.jsx'
import { Icon } from './icons.jsx'
import { OrderConfirm, OrderProgress, RiskDot } from './Orders.jsx'

/**
 * The approvals Hermes asks for, inside the decision list. One card per request: who asks, in which session, Hermes' own one-line
 * summary of it (never the command: the session's approval card shows that), how long it has waited, and the answers it allows, each with
 * its risk class (a pip) and what it does said to the screen reader and in the list's « ? ». « Refuse » and « Allow once » are on the card,
 * the broader answers (for the session, always) one click further. The answer goes through the same order machine as every other order
 * (6 s to cancel, one at a time, re-read from `approval.pending`).
 */
export function ApprovalRow({ row, orders, nowMs, grouped, sceneAgent, open, onModelFollowUp, t }) {
  const req = row.req
  const o = orders.state.order
  const phase = orders.state.phase
  const mine = o?.verb === 'approval' && o.sessionId === req.sessionId && o.requestId === req.requestId
  const busy = isBusy(orders.state)
  const [more, setMore] = useState(false)
  const who = req.profile || t('approvals.unknownAgent')
  const where = req.title || t('approvals.untitled')
  const allowed = CHOICES.filter(c => req.choices.includes(c))
  const main = allowed.filter(c => c === 'deny' || c === 'once')
  const rest = allowed.filter(c => c !== 'deny' && c !== 'once')
  const button = c => (
    <button
      key={c}
      type="button"
      className="ux-b sm"
      data-approval-choice={c}
      aria-disabled={busy ? true : undefined}
      aria-describedby={`oc-ch-${req.requestId}-${c}`}
      onClick={() => orders.requestApproval(req, c)}
    >
      {t(`approvals.choice.${c}`)}
      <RiskDot risk={choiceRisk(c)} t={t} />
    </button>
  )
  const showConfirm = mine && phase === 'confirm'
  const showProgress = mine && (phase === 'counting' || phase === 'sending' || phase === 'verifying' || phase === 'done')
  return (
    <DecisionFrame
      id={req.requestId}
      attrs={{ 'data-approval': req.requestId, 'data-session': req.sessionId }}
      board={row.board}
      grouped={grouped}
      kind="approval"
      title={where}
      summary={req.summary || t('approvals.noSummary')}
      sinceMs={req.firstSeenMs}
      ageTip={t('approvals.asked', t.ago(req.firstSeenMs))}
      nowMs={nowMs}
      agent={who}
      sceneAgent={sceneAgent}
      open={open}
      target={mine && busy}
      unverified={req.unverified}
      t={t}
    >
      {req.unverified ? <span className="ux-kind" data-approval-unverified title={t('approvals.unverifiedTip')}>{t('approvals.unverified')}</span> : null}
      {allowed.map(c => <span key={c} id={`oc-ch-${req.requestId}-${c}`} className="ux-vh">{t(`approvals.explain.${c}`)}</span>)}
      {!showConfirm ? (
        <div className="ux-dc-o" role="group" aria-label={t('approvals.choicesLabel', who)}>
          {main.map(button)}
          {rest.length ? (
            <button type="button" className="ux-b sm ico more" aria-expanded={more} aria-label={t('ux.dec.moreChoices')} onClick={() => setMore(v => !v)}>
              <Icon name="more" size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
      {more && rest.length && !showConfirm ? <div className="ux-ch-extra">{rest.map(button)}</div> : null}
      {showConfirm ? <OrderConfirm orders={orders} /> : null}
      {showProgress ? <OrderProgress orders={orders} onModelFollowUp={onModelFollowUp} /> : null}
    </DecisionFrame>
  )
}
