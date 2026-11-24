import { useMemo } from 'react'

import { TABS, tabForKey } from '../core/tabs.js'
import { toSceneModel } from '../scene/index.js'
import { AgentTab } from './AgentTab.jsx'
import { DecisionsTab } from './DecisionsTab.jsx'
import { Icon } from './icons.jsx'
import { JournalTab } from './JournalTab.jsx'
import { ProjectsTab } from './ProjectsTab.jsx'
import { useT } from './useT.js'

const ICON = { decisions: 'inbox', agent: 'office', projects: 'folder', journal: 'list' }

/**
 * The Details panel: four tabs next to the office — Decisions (first), Agent, Projects, Journal. In a wide pane the tab list
 * is on top (WAI-ARIA tabs: arrows, Home, End); in a narrow pane (<= 700 px) the page's bottom bar picks the view and this panel shows
 * that one view only. Only the body scrolls. The decisions are grouped by project and drawn as cards
 * (src/ui/DecisionsTab.jsx).
 */
export function SidePanel({
  office, history, profiles, selected, nowMs, onOpen, canOpen, frozen = false, game = null, readMs = null, tab, onTab, narrow, headRef,
  orders = null, writes = [], openCard = null, journal = { served: false }, approvals = [], answer = null, night = null,
  project = null, onProject, sort, onSort, jfilter, onJfilter, decisions = null, onModelFollowUp, onPick, bots = null
}) {
  const t = useT()
  const agent = office.agents.find(a => a.name === selected) ?? null
  const sceneBy = useMemo(() => new Map(toSceneModel(office, { nowMs, profiles }).agents.map(a => [a.name, a])), [office, profiles, nowMs])
  const sceneAgent = agent ? sceneBy.get(agent.name) ?? null : null
  // the grade of the selected agent, as text (game layer; sober or no game -> null and the sheet shows no row)
  const g = agent && game && !game.sober ? game.grades[agent.name] : null
  const grade = g ? [t('game.gradeLine', t(`game.grade.${g.id}`), g.runs), g.next != null ? t('game.gradeNext', g.next) : ''].filter(Boolean).join(' · ') : null
  const onKey = e => {
    const next = tabForKey(TABS, tab, e.key)
    if (!next) return
    e.preventDefault()
    onTab(next)
    const list = e.currentTarget   // read now: React clears it once the handler returns
    requestAnimationFrame(() => list?.querySelector(`[data-tab="${next}"]`)?.focus())
  }
  let body
  if (tab === 'agent') {
    body = (
      <AgentTab
        office={office} agent={agent} sceneAgent={sceneAgent} sceneBy={sceneBy} history={history} nowMs={nowMs} onOpen={onOpen} canOpen={canOpen} frozen={frozen}
        grade={grade} project={project} onPick={onPick} onDecide={frozen ? null : slug => { onProject(slug); onTab('decisions') }} openKanban={openCard?.kanban ?? null}
        bots={bots} orders={answer} t={t}
      />
    )
  } else if (tab === 'projects') {
    body = <ProjectsTab office={office} project={project} onProject={onProject} openKanban={openCard?.kanban ?? null} t={t} />
  } else if (tab === 'journal') {
    body = <JournalTab history={history} office={office} game={game} journal={journal} night={night} project={project} filter={jfilter} onFilter={onJfilter} nowMs={nowMs} readMs={readMs} t={t} />
  } else {
    body = (
      <DecisionsTab
        office={office} history={history} orders={orders} writes={writes} openCard={openCard} approvals={approvals} answer={answer} nowMs={nowMs}
        project={project} onProject={onProject} sort={sort} onSort={onSort} sceneBy={sceneBy} onModelFollowUp={onModelFollowUp} t={t}
      />
    )
  }
  return (
    <aside id="oc-panel" className="ux-panel" aria-label={t('panel.region')} data-panel data-tab={tab}>
      <h2 ref={headRef} tabIndex={-1} className="ux-vh">{t('panel.title')}</h2>
      <div className="ux-tabs" role="tablist" aria-label={t('panel.title')} onKeyDown={onKey}>
        {TABS.map(k => (
          <button key={k} type="button" role="tab" id={`oc-tab-${k}`} data-tab={k} aria-selected={tab === k} aria-controls="oc-tabpanel" tabIndex={tab === k ? 0 : -1} className="ux-tab" onClick={() => onTab(k)}>
            <Icon name={ICON[k]} size={14} />{t(`ux.tab.${k}`)}
            {k === 'decisions' && decisions ? <span className="ux-n warn" aria-label={String(decisions)}>{decisions}</span> : null}
          </button>
        ))}
      </div>
      <div className="ux-pbody" id="oc-tabpanel" role="tabpanel" aria-labelledby={`oc-tab-${tab}`} tabIndex={0} data-narrow={narrow ? '' : undefined}>
        {body}
      </div>
    </aside>
  )
}

// the portrait moved to its own file (every card draws it); HireDialog still imports it from here
export { Portrait } from './Portrait.jsx'
