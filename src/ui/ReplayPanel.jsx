import { useMemo } from 'react'

import { runningCards } from '../core/cards.js'
import { plusOf, taskTag } from '../core/hud.js'
import { CARD_STATUSES } from '../core/panel.js'
import { FACT_KINDS, GROUPS, clockLabel, filterJournal, journalFacets, journalView } from '../core/replay.js'
import { codeText, cardsTip, quietTip } from './cardFacts.js'
import { DlgTip } from './DialogKit.jsx'
import { NightCard } from './NightCard.jsx'
import { StateIcon } from './StateIcon.jsx'
import { TIP_CSS } from './dialogStyles.js'

const STATUS = new Set(CARD_STATUSES)
const MAX_ROWS = 120

/** The sentence of one fact: what Hermes recorded, in the page's language. Never a content: the whitelist of the route has none. */
function factText(e, t) {
  if (e.group === 'order') return t(`orders.verb.${e.kind}`) || e.kind
  if (e.group === 'cron') return t('replay.fact.cron', e.result === 'done')
  if (e.group === 'session') return t('replay.fact.session', e.extra)
  if (e.group === 'silence') return t('replay.fact.silence', e.extra)
  if (!FACT_KINDS.includes(e.kind)) return e.kind
  return t(`replay.fact.${e.kind}`, e.extra ?? '')
}

function sourceText(e, t) {
  if (e.source === 'kanban') return t('replay.journal.sources.kanban', e.board)
  if (e.source === 'silence') return t('replay.journal.sources.silence', e.board)
  return t(`replay.journal.sources.${e.source}`)
}

/**
 * « At this moment »: who was at work (and on which card), who was silent, which cards were waiting for a decision, at the cursor. The same
 * words as the live office, from the same rules (src/core/office.js) fed with the facts. Titles are today's (Hermes keeps no history of them).
 */
function Moment({ office, nowMs, t }) {
  // the facts of the label — the main card, « +N » for the others, the mark of a silent card (also on a bot at rest)
  const agents = office.agents.filter(a => ['working', 'stale', 'waiting'].includes(a.state) || a.quiet?.length)
  const blocked = office.boards.flatMap(b => b.blocked.map(c => ({ ...c, board: b.slug })))
  const cardOf = a => (a.state === 'waiting' ? a.blocked[0] ?? runningCards(a, nowMs)[0] : runningCards(a, nowMs)[0] ?? a.blocked[0]) ?? null
  return (
    <section className="oc-psec" aria-labelledby="oc-h-moment" data-moment>
      <h3 id="oc-h-moment">{t('replay.moment.title')}</h3>
      {agents.length || blocked.length ? (
        <>
          <ul className="oc-facts oc-moment" aria-label={t('replay.moment.agents')}>
            {agents.map(a => {
              const c = cardOf(a)
              const tag = taskTag(a, nowMs)
              const many = a.running.length > 1 && a.state !== 'waiting'
              const quiet = quietTip(tag, t)
              return (
                <li key={a.name} data-moment-agent={a.name} data-state={a.state}>
                  <span className="oc-fact oc-fact-static">
                    <span className={`oc-tag oc-t-${a.state}`}>{t(`state.${a.state}`)}</span>
                    <span className="oc-fact-main"><b>{a.label}</b>{c ? <> <span className="oc-mono" title={c.title}>{c.title || c.id}</span> <span className="oc-faint">({c.board})</span></> : null}{many ? <> <span className="oc-faint oc-mono" data-moment-more title={cardsTip(tag, t)}>{c.title ? plusOf(tag.more) : codeText('', tag.more, t)}</span></> : null}{quiet ? <> <span className="oc-faint" data-moment-quiet style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><StateIcon state="stale" />{quiet}</span></> : null}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          {blocked.length ? (
            <>
              <h4 className="oc-faint" style={{ margin: '8px 0 4px' }}>{t('replay.moment.blocked', blocked.length)}</h4>
              <ul className="oc-facts oc-moment" aria-label={t('replay.moment.blocked', blocked.length)}>
                {blocked.slice(0, 12).map(c => (
                  <li key={`${c.board}/${c.id}`} data-moment-blocked={c.id}>
                    <span className="oc-fact oc-fact-static">
                      <span className="oc-fact-main"><span className="oc-mono" title={c.title}>{c.title || c.id}</span> <span className="oc-faint">({c.board}{c.assignee ? ` · ${c.assignee}` : ''})</span></span>
                    </span>
                  </li>
                ))}
              </ul>
              {blocked.length > 12 ? <p className="oc-faint">{t('insp.more', blocked.length - 12)}</p> : null}
            </>
          ) : null}
        </>
      ) : <p className="oc-hint" data-moment-none>{t('replay.stateNone')}</p>}
    </section>
  )
}

/**
 * The side panel of a replay. The summary of the window, then the journal of the facts, filterable by board and by agent, each
 * fact with its time and its source. A click on a fact puts the cursor there. Newest first, the facts after the cursor dimmed; never
 * more than 120 rows (a 7-day window has thousands), the rest counted.
 */
export function ReplayPanel({ replay, office, summary, entries, atMs, nowMs, filter, onFilter, onAt, onShowGroup, onClose, drawer, headRef, t }) {
  const day = replay.toMs - replay.fromMs > 20 * 3_600_000
  const facets = useMemo(() => journalFacets(entries), [entries])
  const shown = useMemo(() => filterJournal(entries, filter), [entries, filter])
  const view = useMemo(() => journalView(shown, atMs, MAX_ROWS), [shown, atMs])
  const nowIndex = view.rows.findIndex(r => !r.future)
  return (
    <aside id="oc-panel" className={`oc-panel${drawer ? ' oc-drawer' : ''}`} aria-label={t('panel.region')} data-panel data-replay-panel data-drawer={drawer ? '' : undefined}>
      <div className="oc-phead">
        <h2 ref={headRef} tabIndex={-1}>{t('replay.journal.title')}</h2>
        <button type="button" className="oc-x" onClick={onClose} aria-label={t('panel.close')}>
          <svg viewBox="0 0 7 7" width="10" height="10" shapeRendering="crispEdges" fill="currentColor" aria-hidden="true" focusable="false">
            {[[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [6, 0], [5, 1], [4, 2], [2, 4], [1, 5], [0, 6]].map(([x, y]) => <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" />)}
          </svg>
        </button>
      </div>
      <style>{TIP_CSS}</style>
      <div className="oc-pbody" role="region" aria-label={t('replay.journal.title')} tabIndex={0}>
        <Moment office={office} nowMs={nowMs} t={t} />
        <NightCard summary={summary} kind={replay.kind} t={t} onShow={onShowGroup} headingId="oc-h-rp-night" />
        <section className="oc-psec" aria-labelledby="oc-h-facts" data-facts>
          <h3 id="oc-h-facts">{t('replay.journal.title')} <span className="oc-count" data-facts-count>{shown.length}</span></h3>
          <div className="oc-rp-filters">
            <span className="oc-rp-f"><label htmlFor="oc-rp-board">{t('replay.journal.boardLabel')}</label>
            <select id="oc-rp-board" className="oc-rp-sel" data-filter="board" value={filter.board ?? ''} onChange={e => onFilter({ ...filter, board: e.target.value || null })}>
              <option value="">{t('replay.journal.anyBoard')}</option>
              {facets.boards.map(b => <option key={b} value={b}>{b}</option>)}
            </select></span>
            <span className="oc-rp-f"><label htmlFor="oc-rp-agent">{t('replay.journal.agentLabel')}</label>
            <select id="oc-rp-agent" className="oc-rp-sel" data-filter="agent" value={filter.agent ?? ''} onChange={e => onFilter({ ...filter, agent: e.target.value || null })}>
              <option value="">{t('replay.journal.anyAgent')}</option>
              {facets.agents.map(a => <option key={a} value={a}>{a}</option>)}
            </select></span>
            <span className="oc-rp-f"><label htmlFor="oc-rp-group">{t('replay.journal.group')}</label>
            <select id="oc-rp-group" className="oc-rp-sel" data-filter="group" value={filter.group ?? ''} onChange={e => onFilter({ ...filter, group: e.target.value || null })}>
              <option value="">{t('replay.journal.anyGroup')}</option>
              {GROUPS.map(g => <option key={g} value={g}>{t(`replay.journal.group2.${g}`)}</option>)}
            </select></span>
            <label className="oc-rp-all" htmlFor="oc-rp-minor">
              <input id="oc-rp-minor" type="checkbox" data-filter="all" checked={Boolean(filter.all)} onChange={e => onFilter({ ...filter, all: e.target.checked })} />
              {t('replay.journal.all')}
            </label>
          </div>
          {view.newerHidden ? <p className="oc-faint" data-facts-newer>{t('replay.journal.newer', view.newerHidden)}</p> : null}
          {view.rows.length ? (
            <ul className="oc-facts" aria-label={t('replay.journal.title')}>
              {view.rows.map((e, i) => (
                <li key={`${e.source}/${e.board}/${e.task}/${e.kind}/${e.ms}/${i}`} data-future={e.future ? '' : undefined} data-now={i === nowIndex ? '' : undefined} aria-current={i === nowIndex ? 'true' : undefined}>
                  <button type="button" className="oc-fact" data-fact data-source={e.source} data-kind={e.kind} data-group={e.group} data-ms={e.ms} title={e.future ? `${t('replay.journal.go')} (${t('replay.journal.future')})` : t('replay.journal.go')} onClick={() => onAt(e.ms)}>
                    <time dateTime={new Date(e.ms).toISOString()}>{clockLabel(e.ms, t.lang, { day })}</time>
                    <span className="oc-fact-main">
                      <span className="oc-fk">{factText(e, t)}</span>
                      {e.group === 'order' && e.result ? <> <span className="oc-tag">{t(`orders.result.${e.result}`)}</span></> : null}
                      {e.to ? <span className="oc-faint"> {t('replay.fact.to', STATUS.has(e.to) ? t(`status.${e.to}`) : e.to)}</span> : null}
                      {e.group === 'cron' && e.title ? <> <span className="oc-mono">{e.title}</span></> : null}
                      {e.task && e.source !== 'cron' ? <> <span className="oc-mono" title={e.title ? undefined : t('replay.journal.noTitle')}>{e.title || e.task}</span></> : null}
                      {e.profile ? <span className="oc-faint"> · {e.profile}</span> : null}
                    </span>
                    <span className="oc-fact-src" data-fact-source>{sourceText(e, t)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="oc-hint oc-dashed" data-facts-empty>{t('replay.journal.empty')}</p>}
          {view.olderHidden ? <p className="oc-faint" data-facts-older>{t('replay.journal.older', view.olderHidden)}</p> : null}
          <p className="oc-faint oc-rp-note"><DlgTip name={t('replay.journal.title')}>{t('replay.titlesNote')}</DlgTip></p>
          {replay.truncatedAt ? <p className="oc-rp-warn" data-replay-truncated>{t('replay.truncated', clockLabel(replay.truncatedAt, t.lang, { day }))}</p> : null}
          {replay.partial.length ? <p className="oc-rp-warn" data-replay-partial>{t('replay.partial')}</p> : null}
        </section>
      </div>
    </aside>
  )
}
