import { useLayoutEffect, useRef } from 'react'

import { fitDockRow } from '../core/dock.js'
import { Icon, Ring } from './icons.jsx'
import { Legend } from './Legend.jsx'
import { Portrait } from './Portrait.jsx'
import { useProjectStyle } from './ProjectChip.jsx'
import { WhyButton } from './Why.jsx'

function ProjectButton({ b, pressed, onPick, t }) {
  const style = useProjectStyle(b.slug)
  const blocked = b.blocked.length
  return (
    <button type="button" className="ux-pj" style={style} data-dock-board={b.slug} aria-pressed={pressed} title={`${t('ux.dock.chip', b.slug, `${b.done}/${b.total}`)}${blocked ? `, ${t('blockedCards', blocked)}` : ''}`} onClick={() => onPick(pressed ? null : b.slug)}>
      <Ring done={b.done} total={b.total} />
      <b>{b.slug}</b>
      <span className="n ux-mono">{b.done}/{b.total}</span>
      {blocked ? <span className="wb"><Icon name="warn" size={14} /><span aria-hidden="true">{blocked}</span><span className="ux-vh">{t('blockedCards', blocked)}</span></span> : null}
    </button>
  )
}

/**
 * The dock under the stage: ONE row of constant height, whatever is selected, so the room never moves when an agent is clicked.
 * The projects as filters (a ring of progress, the count of blocked cards, « All »); a filter dims the scene and narrows the lists,
 * pressing it again removes it. When the row is too short the chips give up their `done/total` count first, then the row scrolls (a
 * fade at its end says it goes on). At its end: the selected agent (only while the details panel is hidden: with the panel open its
 * sheet says it, once) and the legend of the halos.
 * « Dims the scene » is real: the engine washes the other islands and the common room (src/scene/draw.js `dim`, src/scene/projects.js
 * `dimOf`), the labels of what is left out fade (OfficeScene), and the island labels of the scene are filters too.
 */
export function ProjectDock({ boards, project, onProject, picked, sceneAgent, replayOn, canOpen, why, onOpen, onDetails, narrow, showSel = true, announce, t }) {
  const row = useRef(null)
  const sig = boards.map(b => `${b.slug}:${b.done}/${b.total}:${b.blocked.length}`).join('|')
  // measured with the counts on (data-compact off): too long -> the counts go; still too long -> the row scrolls and fades. Layout effect: before the paint.
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return undefined
    const fit = () => { fitDockRow(el) }
    fit()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sig, t.lang])
  return (
    <div className="ux-dock" data-dock>
      {boards.length ? (
        <div className="ux-dk-l" ref={row} role="group" aria-label={t('ux.dock.label')}>
          <button type="button" className="ux-pj all" aria-pressed={!project} aria-label={t('ux.dock.all')} onClick={() => onProject(null)}>
            <Icon name="filter" size={14} /><b>{t('ux.dock.all')}</b>
          </button>
          {boards.map(b => <ProjectButton key={b.slug} b={b} pressed={project === b.slug} onPick={onProject} t={t} />)}
        </div>
      ) : <span className="ux-sp" />}
      <div className="ux-sel">
        {picked && showSel ? (
          <>
            {sceneAgent ? <Portrait agent={sceneAgent} /> : null}
            <b title={picked.label}>{picked.label}</b>
            <span className={`ux-st ux-st-${picked.state}`}><span className="ux-sdot" aria-hidden="true" /><span className="w">{t(`state.${picked.state}`)}</span></span>
            {narrow ? <button type="button" className="ux-b sm" onClick={onDetails}>{t('ux.dock.details')}</button> : null}
            <WhyButton className="ux-b sm pri oc-btn-open" reason={canOpen ? '' : why} title={why} data-selected-open onGo={onOpen}>{t('insp.open')}</WhyButton>
          </>
        ) : null}
        <span className="oc-announce" data-announce aria-live="polite">{announce}</span>
        <Legend />
      </div>
    </div>
  )
}
