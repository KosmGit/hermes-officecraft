import { formatSpan, waitSign } from '../core/hud.js'
import { outfitSource } from '../core/llm.js'
import { boardsKnown, inspectorOf, modelLines, untitledKey } from '../core/panel.js'
import { modelOf } from '../core/models.js'
import { roleOf } from '../scene/index.js'
import { Icon } from './icons.jsx'
import { PixelBadge } from './PixelBadge.jsx'
import { Portrait } from './Portrait.jsx'
import { ProjectChip, useProjectStyle } from './ProjectChip.jsx'
import { StateIcon } from './StateIcon.jsx'
import { LM_CSS } from './dialogStyles.js'
import { DescriptionRow } from './ReviseBox.jsx'
import { WhyButton } from './Why.jsx'

const FLEX = { display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'center' }
const QUIET = { display: 'inline-flex', alignItems: 'center', gap: 4, color: 'color-mix(in oklab, var(--ui-orange, var(--ui-accent)) 50%, var(--foreground))' }

/** One running card of the list: its project, code, time, a pinned model, a silent mark (what and since when); the title on its own line. */
function CardRow({ c, nowMs, t }) {
  return (
    <span data-insp-card data-quiet={c.silentMs ? '' : undefined} data-pin={c.pin ? '' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={FLEX}>
        <ProjectChip slug={c.board} />
        <b className="ux-mono">{c.code}</b>
        {c.startedMs ? <span style={{ color: 'var(--ui-text-tertiary)' }}>{formatSpan(nowMs - c.startedMs)}</span> : null}
        {c.pin ? <span title={t('insp.modelCard', c.pin)} style={{ display: 'inline-flex' }}><PixelBadge size={10} /><span className="ux-vh">{t('insp.modelCard', c.pin)}</span></span> : null}
        {c.silentMs ? <span style={QUIET} data-insp-quiet><StateIcon state="stale" /><span>{t('insp.quietFor', formatSpan(c.silentMs))}</span></span> : null}
      </span>
      {c.title && c.title !== c.code ? <span className="one">{c.title}</span> : null}
    </span>
  )
}

const ORDER = { waiting: 0, working: 1, stale: 2, active: 3, idle: 4, new: 5, unknown: 6 }

function StateTag({ state, t }) {
  return <span className={`ux-st ux-st-${state}`}><span className="ux-sdot" aria-hidden="true" />{t(`state.${state}`)}</span>
}

/** No agent selected: the team as a list, the ones that need you first, one click for the detail. */
function Roster({ office, sceneBy, project, selected, onPick, t }) {
  const list = office.agents
    .filter(a => !project || a.home === project)
    .sort((a, b) => (ORDER[a.state] ?? 7) - (ORDER[b.state] ?? 7) || a.name.localeCompare(b.name, 'en'))
  return (
    <>
      <div className="ux-pbar"><span className="lbl">{t('ux.agent.team', list.length)} · {t('ux.agent.pick')}</span></div>
      <ul className="ux-roster" data-roster>
        {list.map(a => (
          <li key={a.name}>
            <button type="button" className="ux-rosterb" data-pick={a.name} aria-current={selected === a.name ? 'true' : undefined} onClick={() => onPick(a.name)}>
              {sceneBy.get(a.name) ? <Portrait agent={sceneBy.get(a.name)} /> : null}
              <span className="nm" title={a.label || a.name}>{a.label || a.name}</span>
              <ProjectChip slug={a.home} />
              <StateTag state={a.state} t={t} />
              {waitSign(a) ? <span className="ux-wait" data-wait title={t('waitTip', a.blocked.length)}><StateIcon state="waiting" /><span className="ux-vh">{t('waitTip', a.blocked.length)}</span></span> : null}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * The Agent tab: the team when nobody is selected, else the selected agent's sheet — portrait, state, role and grade; its project (island),
 * the card it runs, the cards that wait for you (one click to decide), its last session, its model and own skills; then « Open the
 * session » (and the kanban when the host can open it).
 */
export function AgentTab({ office, agent, sceneAgent, sceneBy, history, nowMs, onOpen, canOpen, frozen = false, grade, project, onPick, onDecide, openKanban, bots = null, orders = null, t }) {
  const style = useProjectStyle(agent?.home)
  if (!agent) return <Roster office={office} sceneBy={sceneBy} project={project} selected={null} onPick={onPick} t={t} />
  const dressed = roleOf(sceneAgent || agent)
  const outfit = outfitSource(dressed.why)   // the outfit the model chose says so, with its source (a manual or rule-based one says nothing new)
  const models = modelOf(agent)
  const i = inspectorOf(agent, { nowMs, history, models, roleId: dressed.role, grade })
  const ml = modelLines(i.model, i.current?.code ?? '')
  const why = frozen ? t('replay.noAction') : canOpen ? t('openSession', i.label) : t('noSession', i.label)   // in a replay the button is off because the past is read-only, not for want of a session
  const bot = bots?.get(agent.name) ?? null   // the roster's description of this bot (office.agents do not carry it)
  return (
    <section data-insp data-agent-of={i.name} aria-label={t('insp.title')}>
      <div className="ux-ag-h" style={style}>
        <Portrait agent={sceneAgent} />
        <div className="tt">
          <h3 data-insp-name>{i.label}</h3>
          <span data-insp-state><StateTag state={i.state} t={t} /></span>{' '}
          <small>· {t(`role.${i.roleId || 'none'}`)}</small>
          {i.since ? <small className="ux-vh">{t(`insp.since.${i.since.kind}`, t.ago(i.since.ms))}</small> : null}
        </div>
        <button type="button" className="ux-b sm ico ghost" data-pick="" aria-label={t('ux.agent.close')} onClick={() => onPick(null)}><Icon name="x" size={14} /></button>
      </div>
      {i.waiting.length ? (
        // what waits for the user comes first under the header: the action, then the facts
        <div className="ux-ag-wait" data-insp-waiting role="group" aria-label={t('insp.waiting')}>
          <h4>{t('insp.waiting')}</h4>
          {i.waiting.map(w => (
            <div key={`${w.board}/${w.id}`} className="ux-ag-wr" data-insp-wait-row>
              <span className="tx">
                <span className="hd"><ProjectChip slug={w.board} />{w.named ? <b className="ux-mono">{w.code}</b> : null}</span>
                <span className="one ux-ag-wt" title={w.id}>{w.title}</span>
              </span>
              {onDecide ? <button type="button" className="ux-b sm pri" data-decide aria-label={t('ux.agent.decideCard', w.title)} onClick={() => onDecide(w.board)}>{t('ux.agent.decide')}</button> : null}
            </div>
          ))}
          {i.waitingMore ? <small>{t('insp.more', i.waitingMore)}</small> : null}
        </div>
      ) : null}
      <dl className="ux-kv">
        <dt>{t('ux.agent.project')}</dt>
        <dd>{agent.home ? <ProjectChip slug={agent.home} /> : <span>{t('ux.agent.common')}</span>}</dd>
        <dt>{i.cards && i.cards.length + i.cardsMore > 1 ? t('insp.cards') : t('insp.card')}</dt>
        <dd>
          {i.cards ? (
            <span data-insp-cards style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {i.cards.map(c => <CardRow key={`${c.board}/${c.id}`} c={c} nowMs={nowMs} t={t} />)}
              {i.cardsMore ? <small>{t('insp.more', i.cardsMore)}</small> : null}
            </span>
          ) : i.current ? (
            <span data-insp-card>
              <span className="one"><b className="ux-mono">{i.current.code}</b>{i.current.title && i.current.title !== i.current.code ? ` ${i.current.title}` : ''}</span>
              {i.current.startedMs ? <small>{formatSpan(nowMs - i.current.startedMs)}</small> : null}
            </span>
          ) : <span>{boardsKnown(office) ? t('insp.noCard') : t('panel.needsAgentHalf')}</span>}
        </dd>
        <dt>{t('insp.session')}</dt>
        <dd>
          {i.session ? <span><span className="one">{i.session.title || t(untitledKey(i.session))}</span>{i.session.ms ? <small>{t.ago(i.session.ms)}</small> : null}</span> : <span>{t('insp.noSession')}</span>}
        </dd>
        {ml ? (
          <>
            <dt>{t('insp.model')}</dt>
            {/* two lines: the model the work runs on, WHOLE (it wraps, never cut), and who imposes it; then the bot's default in grey. « Really used » only when it differs. */}
            <dd data-insp-model>
              <span className="ux-mono ux-mv" data-insp-model-used>{ml.imposedBy !== null ? <PixelBadge size={10} /> : null} {ml.shown}</span>
              {ml.imposedBy !== null ? <span className="ux-mi" data-insp-model-on>{t('insp.modelImposed', ml.imposedBy)}</span> : null}
              <small className="ux-mono" data-insp-model-default>{t('insp.modelDefault', ml.default)}</small>
              {ml.actual ? <small className="ux-mono" data-insp-model-actual>{t('insp.modelActual', ml.actual)}</small> : null}
            </dd>
          </>
        ) : null}
        <DescriptionRow agent={i.name} description={bot?.description ?? ''} cut={bot?.cut === true} isDefault={bot?.isDefault === true} orders={orders} />
        {i.grade ? (
          <>
            <dt>{t('insp.grade')}</dt>
            <dd data-insp-grade>{i.grade}</dd>
          </>
        ) : null}
        {i.skills.length ? (
          <>
            <dt>{t('insp.skills')}</dt>
            <dd data-insp-skills>
              <span className="ux-chips">
                {i.skills.map(s => <span key={s.name} className="ux-chip2" title={s.category || undefined}><span>{s.name}</span></span>)}
                {i.skillsMore ? <span className="ux-chip2">+{i.skillsMore}</span> : null}
              </span>
            </dd>
          </>
        ) : null}
        {outfit.kind === 'model' ? (
          <>
            <dt>{t('insp.role')}</dt>
            <dd data-insp-role><small data-insp-outfit="model">{t('llm.outfits.tip')}. {t('llm.outfits.source', outfit.at ? t.ago(outfit.at) : '')}</small></dd>
          </>
        ) : null}
      </dl>
      <style>{LM_CSS}</style>
      <div className="ux-ag-act">
        {/* « Open the session » is the secondary action; with a decision waiting, « Decide » above is the one that is filled */}
        <WhyButton className={`ux-b${i.waiting.length ? '' : ' pri'}`} reason={canOpen ? '' : why} title={why} onGo={() => onOpen(i.name)} data-insp-open>{t('insp.open')}</WhyButton>
        {openKanban ? <button type="button" className="ux-b" onClick={() => openKanban()}><Icon name="ext" size={14} />{t('ux.prj.kanban')}</button> : null}
        {canOpen ? null : <small className="ux-ag-nos" data-insp-nosession>{why}</small>}
      </div>
    </section>
  )
}
