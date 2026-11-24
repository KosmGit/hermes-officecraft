import { useMemo } from 'react'

import { shortAge } from '../core/decisions.js'
import { EVENTS_SHOWN, eventsView } from '../core/panel.js'
import { journalEntries } from '../core/game.js'
import { Icon } from './icons.jsx'
import { NightCard } from './NightCard.jsx'
import { orderRows } from './Orders.jsx'
import { Help } from './Popover.jsx'
import { ProjectChip } from './ProjectChip.jsx'

const FILTERS = ['all', 'card', 'order', 'game']
const KIND_ICON = { completed: ['check', 'ok'], blocked: ['warn', 'w'], unblocked: ['unlock', ''], review_requested: ['msg', ''], changes_requested: ['msg', 'w'], crashed: ['crit', 'ko'], timed_out: ['crit', 'ko'] }

/**
 * The Journal tab: « what happened this night » on top (the replay's summary, now the head of the journal), then ONE list, newest first —
 * card events (kanban), orders sent (audit journal), trophies and post-mortems (game) — each with its project chip, filterable by kind
 * and by the project filter. The trophies' collection is the showcase window, opened from the header's badge.
 */
export function JournalTab({ history, office, game, journal, night, project, filter, onFilter, nowMs, readMs, t }) {
  const rows = useMemo(() => {
    const cards = eventsView(history, office).map((e, n) => ({ key: `card/${e.board}/${e.code}/${e.kind}/${e.ms}/${n}`, kind: 'card', ms: e.ms, board: e.board, icon: KIND_ICON[e.kind] ?? ['check', ''], text: `${t(`journal.${e.kind}`)} · ${e.title || e.code}` }))   // the card's title; its id once the board no longer has it (archived)
    const play = journalEntries(game).map((e, n) => ({
      key: `game/${e.kind}/${e.id ?? e.board}/${e.ms}/${n}`,
      kind: 'game',
      ms: e.ms,
      board: e.kind === 'postmortem' ? e.board : null,
      icon: ['trophy', 'w'],
      text: e.kind === 'achievement' ? (e.tier ? t('game.journalTier', t(`game.ach.${e.id}.name`), t(`game.tier.${e.tier}`)) : t('game.journalAch', t(`game.ach.${e.id}.name`))) : t('game.postmortem', e.minutes, e.fails)
    }))
    const sent = orderRows(journal, office, t).map(r => ({ ...r, icon: r.result === 'done' ? ['check', 'ok'] : ['crit', 'ko'] }))
    return [...cards, ...play, ...sent]
      .filter(r => filter === 'all' || r.kind === filter)
      .filter(r => !project || r.board === project || !r.board)
      .sort((x, y) => y.ms - x.ms)
      .slice(0, EVENTS_SHOWN)
  }, [history, office, game, journal, project, filter, t])
  const label = { all: t('ux.jn.all'), card: t('ux.jn.cards'), order: t('ux.jn.orders'), game: t('ux.jn.trophies') }
  const shown = FILTERS.filter(k => k !== 'order' || journal?.served).filter(k => k !== 'game' || (game && !game.sober))
  return (
    <section data-journal aria-label={t('ux.tab.journal')}>
      {night ? <div className="ux-nightc"><NightCardHost night={night} t={t} /></div> : null}
      <div className="ux-pbar">
        <span className="ux-seg" role="group" aria-label={t('ux.jn.filter')}>
          {shown.map(k => <button key={k} type="button" aria-pressed={filter === k} data-jf={k} onClick={() => onFilter(k)}>{label[k]}</button>)}
        </span>
        <span className="grow"><Help label={t('ux.jn.helpTitle')} title={t('ux.jn.helpTitle')}><p>{t('ux.jn.help')}</p><p className="src">{t('orders.journalNote')}</p></Help></span>
      </div>
      {rows.length ? (
        <ul className="ux-jl" data-events>
          {rows.map(r => (
            <li key={r.key} data-kind={r.kind} data-game={r.kind === 'game' ? '' : undefined} data-result={r.result}>
              <time dateTime={new Date(r.ms).toISOString()} title={t.ago(r.ms)}>{shortAge(nowMs - r.ms, t('ux.dec.day'))}</time>
              <span className={`ic ${r.icon[1]}`}><Icon name={r.icon[0]} size={14} /></span>
              <span className="pj">{r.board ? <ProjectChip slug={r.board} /> : null}</span>
              <span className="tx">
                <span className="t" title={r.text}>{r.text}</span>
                {r.resultText ? <span className="res">{r.resultText}</span> : null}
                {r.extra ? <span className="ux-vh">{r.extra}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="ux-empty"><Icon name="list" size={32} /><span>{history?.ok ? t('journal.empty') : t('journal.needsHistory')}</span></p>}
    </section>
  )
}

function NightCardHost({ night, t }) {
  return <NightCard summary={night.summary} t={t} onShow={night.onShow} onReplay={night.onReplay} />
}
