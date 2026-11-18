import { useMemo } from 'react'

import { guardName } from '../core/campaign.js'
import { decisionRows, groupRows, onlyProject } from '../core/decisions.js'
import { boardsKnown, inboxItems, inboxView } from '../core/panel.js'
import { isBusy } from '../core/orders.js'
import { ApprovalRow } from './Approvals.jsx'
import { DecisionFrame } from './DecisionCard.jsx'
import { Icon } from './icons.jsx'
import { CardOpen, CardOrders } from './Orders.jsx'
import { PixelBadge } from './PixelBadge.jsx'
import { Help } from './Popover.jsx'
import { useProjectStyle } from './ProjectChip.jsx'

/** The model a card imposes when it differs from its bot's default: one discreet line under the agent. */
function ModelPin({ pin, t }) {
  if (!pin) return null
  const m = pin.model || pin.provider
  return (
    <span className="ux-dc-pin ux-mono" title={`${t('chains.pinned')}: ${m} (${pin.default.model || pin.default.provider || '—'})`}>
      <PixelBadge size={9} /><span>{m}</span>
    </span>
  )
}

function GroupHead({ slug, count, t }) {
  const style = useProjectStyle(slug)
  return (
    <h3 className="ux-grp" style={style} data-group={slug ?? ''}>
      <span className="sq" aria-hidden="true" />
      <span className="nm">{slug ?? t('ux.dec.noProject')}</span>
      <span className="n">{t('ux.dec.group', count)}</span>
      <span className="ln" aria-hidden="true" />
    </h3>
  )
}

/** « ? » of the list: the legend of the risk pips, the one-at-a-time rule, the colour of an old age, where an approval sits. */
function ListHelp({ t }) {
  return (
    <Help label={t('ux.dec.helpTitle')} title={t('ux.dec.helpTitle')}>
      <p className="rowk"><span className="ux-rk ux-rk-final" aria-hidden="true" /><span><b>{t('orders.risk.final')}</b>. {t('ux.dec.helpFinal')}</span></p>
      <p className="rowk"><span className="ux-rk ux-rk-rev" aria-hidden="true" /><span><b>{t('orders.risk.rev')}</b>. {t('orders.riskTip.rev')}</span></p>
      <p className="rowk"><span className="ux-rk ux-rk-safe" aria-hidden="true" /><span><b>{t('orders.risk.safe')}</b>. {t('ux.dec.helpSafe')}</span></p>
      <p>{t('ux.dec.helpOne')}</p>
      <p>{t('ux.dec.helpAge')}</p>
      <p>{t('ux.dec.helpApprovalProject')}</p>
      <p className="src">{t('approvals.commandNote')}</p>
    </Help>
  )
}

/**
 * The first tab: what waits for you, GROUPED BY PROJECT (the project with the most decisions first, the longest waiting
 * first inside it) or all together, the longest waiting first. A project filter (from the dock or the Projects tab) narrows the list and
 * brings the project chip back on each card. A card: project stripe, code, age, title, agent, then its orders; the confirmation, the 6 s
 * window and the outcome open INSIDE the card. At most ~50 rows are drawn, the rest is counted.
 */
export function DecisionsTab({ office, history, orders, writes, openCard, approvals = [], answer = null, nowMs, project, onProject, sort, onSort, sceneBy, onModelFollowUp, t }) {
  const items = useMemo(() => inboxItems(office, history), [office, history])
  const view = useMemo(() => inboxView(items, approvals), [items, approvals])   // ~50 rows, then « N more »
  const rows = useMemo(() => decisionRows(view, office), [view, office])
  const shown = useMemo(() => onlyProject(rows, project), [rows, project])
  // the card an order is counting / travelling for stays marked, so the floating bar's « t_… » points at something on screen
  const o = orders && isBusy(orders.state) ? orders.state.order : null
  const targeted = c => Boolean(o && o.board === c.board && o.task === c.id)
  const grouped = sort === 'project' && !project
  const known = boardsKnown(office) || approvals.length > 0
  const open = openCard?.kanban ?? null
  const card = row => {
    const c = row.card
    const age = c.blockedMs ? t('inbox.blockedSince', t.ago(c.blockedMs)) : c.createdMs ? t('inbox.created', t.ago(c.createdMs)) : ''
    // the guard of a campaign is the « Campaign » decision: its goal as the title, « Launch » (never « Unblock »), « Cancel » on the head guard
    const guard = c.guard === true
    return (
      <DecisionFrame
        key={row.key}
        id={c.id}
        attrs={{ 'data-card': c.id, 'data-board': c.board, ...(guard ? { 'data-guard': c.head ? 'head' : 'phase' } : {}) }}
        board={c.board}
        grouped={grouped}
        kind="card"
        code={guard ? t('campaign.kind') : c.code}
        title={guard ? guardName(c.fullTitle ?? c.title) : c.title || c.id}
        whoText={guard ? (c.head ? t('campaign.decision.head', c.campaignSize ?? '?') : t('campaign.decision.phase', guardName(c.fullTitle ?? c.title))) : null}
        sinceMs={row.sinceMs}
        ageTip={age}
        nowMs={nowMs}
        agent={c.assignee}
        sceneAgent={sceneBy.get(c.assignee)}
        open={<CardOpen item={c} openKanban={open} openSession={openCard?.session(c) ?? null} t={t} />}
        target={targeted(c)}
        t={t}
      >
        <ModelPin pin={c.pin} t={t} />
        {orders ? <CardOrders item={c} orders={orders} writes={writes} onModelFollowUp={onModelFollowUp} t={t} /> : null}
      </DecisionFrame>
    )
  }
  const one = row => (row.kind === 'approval'
    ? <ApprovalRow key={row.key} row={row} orders={answer} nowMs={nowMs} grouped={grouped} sceneAgent={sceneBy.get(row.req.profile)} onModelFollowUp={onModelFollowUp} t={t} />
    : card(row))
  const list = rs => <ul className="ux-dcl">{rs.map(one)}</ul>
  const groups = grouped ? groupRows(shown) : null
  const empty = !shown.length
  return (
    <section data-inbox data-count={view.total} aria-label={t('ux.tab.decisions')}>
      <div className="ux-pbar">
        <span className="lbl" id="ux-sort-l">{t('ux.dec.sort')}</span>
        <span className="ux-seg" role="group" aria-labelledby="ux-sort-l">
          <button type="button" aria-pressed={sort === 'project'} data-sort="project" onClick={() => onSort('project')}>{t('ux.dec.byProject')}</button>
          <button type="button" aria-pressed={sort === 'age'} data-sort="age" onClick={() => onSort('age')}>{t('ux.dec.byAge')}</button>
        </span>
        {project ? <FilterChip slug={project} onClear={() => onProject(null)} t={t} /> : null}
        <span className={project ? '' : 'grow'}><ListHelp t={t} /></span>
      </div>
      {empty ? (
        <p className="ux-empty" data-empty>
          <Icon name="inbox" size={32} />
          <span>{!known ? t('panel.needsAgentHalf') : project && rows.length ? t('ux.dec.emptyFiltered') : t(office.boards.length ? 'inbox.empty' : 'inbox.noBoard')}</span>
        </p>
      ) : groups ? groups.map(g => (
        <div key={g.slug ?? '-'}>
          <GroupHead slug={g.slug} count={g.count} t={t} />
          {list(g.rows)}
        </div>
      )) : list(shown)}
      {view.more ? <p className="ux-more" data-inbox-more>{t('inbox.more', view.more)}</p> : null}
    </section>
  )
}

/** The filter on screen: the project's chip with an « x », pressing it removes the filter. */
export function FilterChip({ slug, onClear, t }) {
  const style = useProjectStyle(slug)
  return (
    <button type="button" className="ux-prj ux-prjx grow" style={style} data-filter-chip onClick={onClear} aria-label={t('ux.dec.unfilter', slug)}>
      <i aria-hidden="true" /><span>{slug}</span><Icon name="x" size={12} />
    </button>
  )
}

