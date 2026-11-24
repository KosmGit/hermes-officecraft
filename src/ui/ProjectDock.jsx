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
 * The dock under the stage: the projects as filters (a ring of progress, the count of blocked cards, « All »), and the selection at
 * the end: the agent, its state, « Open ». A filter dims the scene and narrows the lists; pressing it again removes it. It also holds the
 * legend of the halos. No filter and no project: only the selection.
 * « Dims the scene » is real: the engine washes the other islands and the common room (src/scene/draw.js `dim`, src/scene/projects.js
 * `dimOf`), the labels of what is left out fade (OfficeScene), and the island labels of the scene are filters too.
 */
export function ProjectDock({ boards, project, onProject, picked, sceneAgent, replayOn, canOpen, why, onOpen, onDetails, narrow, announce, t }) {
  return (
    <div className="ux-dock" data-dock>
      {boards.length ? (
        <div className="ux-dk-l" role="group" aria-label={t('ux.dock.label')}>
          <button type="button" className="ux-pj all" aria-pressed={!project} aria-label={t('ux.dock.all')} onClick={() => onProject(null)}>
            <Icon name="filter" size={14} /><b>{t('ux.dock.all')}</b>
          </button>
          {boards.map(b => <ProjectButton key={b.slug} b={b} pressed={project === b.slug} onPick={onProject} t={t} />)}
        </div>
      ) : <span className="ux-sp" />}
      <div className="ux-sel">
        {picked ? (
          <>
            {sceneAgent ? <Portrait agent={sceneAgent} /> : null}
            <b title={picked.label}>{picked.label}</b>
            <span className={`ux-st ux-st-${picked.state}`}><span className="ux-sdot" aria-hidden="true" />{t(`state.${picked.state}`)}</span>
            {narrow ? <button type="button" className="ux-b sm" onClick={onDetails}>{t('ux.dock.details')}</button> : null}
            <WhyButton className="ux-b sm pri oc-btn-open" reason={canOpen ? '' : why} title={why} data-selected-open onGo={onOpen}>{t('openBtn')}</WhyButton>
          </>
        ) : <span className="hint">{t('ux.dock.hint')}</span>}
        <span className="oc-announce" data-announce aria-live="polite">{announce}</span>
        <Legend />
      </div>
    </div>
  )
}
