import { useId, useMemo, useState } from 'react'

import { percentText } from '../core/format.js'
import { CARD_STATUSES, boardsKnown, chainsView } from '../core/panel.js'
import { Icon, Ring } from './icons.jsx'
import { PixelBadge } from './PixelBadge.jsx'
import { useProjectStyle } from './ProjectChip.jsx'

const PINNED_SHOWN = 3
const STATUS = new Set(CARD_STATUSES)
const statusText = (t, s) => (STATUS.has(s) ? t(`status.${s}`) : String(s ?? ''))
const TODO = ['todo', 'ready', 'triage', 'scheduled']

function Card({ b, c, project, onProject, openKanban, t }) {
  const style = useProjectStyle(b.slug)
  const pressed = project === b.slug
  const n = k => b.counts[k] || 0
  const running = n('running') + n('review')
  const todo = TODO.reduce((s, k) => s + n(k), 0)
  const blocked = b.blocked.length
  const chainLabel = t('ux.prj.queue', c.queue.length)
  const listId = useId()
  const [listed, setListed] = useState(false)
  return (
    <div className={`ux-pjc${project && !pressed ? ' dim' : ''}`} style={style} data-chain={b.slug}>
      <div className="big">
        <Ring done={b.done} total={b.total} r={21} box={52} stroke={5} />
        <span className="pc ux-mono" aria-hidden="true">{percentText(c.pct, t.lang)}</span>
      </div>
      <h4><span className="sq" aria-hidden="true" /><span className="nm">{b.slug}</span><span className="n ux-mono">{b.done}/{b.total}<span className="ux-vh"> · {percentText(c.pct, t.lang)}</span></span></h4>
      <div className="cn">
        <span><b>{running}</b> {t('ux.prj.running')}</span>
        <span><b>{todo}</b> {t('ux.prj.todo')}</span>
        <span className={blocked ? 'w' : ''}><b>{blocked}</b> {t('ux.prj.blocked')}</span>
      </div>
      <div className="ux-pips" role="list" aria-label={t('chains.queue', b.slug)} title={chainLabel}>
        {c.queue.map(q => (
          <i
            key={q.id}
            role="listitem"
            className={q.status}
            data-pin={q.pin ? '' : undefined}
            title={`${t('chains.card', q.code, statusText(t, q.status))}${q.title && q.title !== q.code ? ` — ${q.title}` : ''}${q.pin ? ` — ${t('chains.pinned')}: ${q.pin.model || q.pin.provider}` : ''}`}
            aria-label={t('chains.card', q.code, statusText(t, q.status))}
          />
        ))}
      </div>
      {c.queue.length ? (
        <button type="button" className="ux-lnk ux-pq-toggle" data-queue-toggle aria-expanded={listed} aria-controls={listId} onClick={() => setListed(v => !v)}>{listed ? t('ux.prj.hideCards') : t('ux.prj.showCards')}</button>
      ) : null}
      {listed ? (
        <ol className="ux-pq" id={listId} data-queue aria-label={t('chains.queue', b.slug)}>
          {c.queue.map(q => (
            <li key={q.id} data-status={q.status}>
              <i className={`ux-pip ${q.status}`} aria-hidden="true" />
              <span className="ux-mono code">{q.code}</span>
              <span className="st">{statusText(t, q.status)}</span>
              {q.title && q.title !== q.code ? <span className="tt">{q.title}</span> : null}
              {q.pin ? <span className="ux-dc-pin ux-mono"><PixelBadge size={9} /><span>{q.pin.model || q.pin.provider}</span></span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {c.pinned.slice(-PINNED_SHOWN).reverse().map(q => (
        <div key={q.id} className="pin" data-pinrow={q.id}>
          <span className="ux-mono">{q.code}</span>
          <span className="ux-dc-pin ux-mono" title={`${t('chains.pinned')}: ${q.pin.model || q.pin.provider}`}><PixelBadge size={9} /><span>{q.pin.model || q.pin.provider}</span></span>
        </div>
      ))}
      {c.pinned.length > PINNED_SHOWN ? <div className="pin"><small>{t('insp.more', c.pinned.length - PINNED_SHOWN)}</small></div> : null}
      <div className="ac">
        <button type="button" className="ux-b sm" aria-pressed={pressed} data-project-filter={b.slug} onClick={() => onProject(pressed ? null : b.slug)}>
          <Icon name="filter" size={14} />{pressed ? t('ux.prj.filtered') : t('ux.prj.filter')}
        </button>
        {openKanban ? <button type="button" className="ux-b sm ghost" onClick={() => openKanban()}><Icon name="ext" size={14} />{t('ux.prj.kanban')}</button> : null}
      </div>
    </div>
  )
}

/** The Projects tab: one card per board — progress ring, running / to do / blocked, the last cards as a strip (the model a card pins is marked), the filter and the kanban. */
export function ProjectsTab({ office, project, onProject, openKanban, t }) {
  const chains = useMemo(() => chainsView(office), [office])
  const by = new Map(chains.map(c => [c.slug, c]))
  if (!office.boards.length) return <p className="ux-empty" data-chains><Icon name="folder" size={32} /><span>{boardsKnown(office) ? t('chains.empty') : t('panel.needsAgentHalf')}</span></p>
  return (
    <section data-chains aria-label={t('ux.tab.projects')}>
      {office.boards.map(b => <Card key={b.slug} b={b} c={by.get(b.slug)} project={project} onProject={onProject} openKanban={openKanban} t={t} />)}
    </section>
  )
}
