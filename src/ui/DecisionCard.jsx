import { useId, useLayoutEffect, useRef, useState } from 'react'

import { isOld, shortAge } from '../core/decisions.js'
import { roleOf } from '../scene/index.js'
import { Icon } from './icons.jsx'
import { Portrait } from './Portrait.jsx'
import { ProjectChip, useProjectStyle } from './ProjectChip.jsx'

/**
 * A text cut to two lines with an ellipsis, and a button that opens it whole (the `title` tooltip alone reaches neither a keyboard nor a
 * finger). Used for the card's title and for the reason the bot gave: the same measure, the same button. `tip` is the tooltip of the
 * paragraph (the title's own; never given for text written by a bot).
 */
function Clamped({ text, className, tip, more, less, button, children }) {
  const id = useId()
  const ref = useRef(null)
  const [whole, setWhole] = useState(false)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const p = ref.current
    if (!p || whole) return undefined
    const measure = () => setCut(p.scrollHeight > p.clientHeight + 1)
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(p)
    return () => ro.disconnect()
  }, [text, whole])
  return (
    <>
      <p ref={ref} id={id} className={`${className}${whole ? ' whole' : ''}`} title={tip}>{children}{text}</p>
      {cut || whole ? <button type="button" className="ux-lnk ux-dc-more" {...button} aria-expanded={whole} aria-controls={id} onClick={() => setWhole(v => !v)}>{whole ? less : more}</button> : null}
    </>
  )
}

/**
 * The frame of one decision: the project's stripe, then on one line the project (unless the group header already says it),
 * the code (or « Approval »), the age (orange past 24 h) and the « open » icon; the title; for an approval Hermes' summary and one line of
 * detail; for a blocked card the reason the bot gave when it blocked it (two lines, the same unfolding as the title); the line of the agent
 * (portrait, name, role); then whatever the caller puts below (the orders, a confirmation, the 6 s window). One card = one decision.
 * A title or a reason longer than its two lines is cut with an ellipsis and a button opens it whole.
 * The reason is written by a bot: it is drawn as text (never a link, never markup), and it is neither a `title` nor part of a button's name.
 */
export function DecisionFrame({ id, attrs = {}, board, grouped, kind, code, title, summary, reason = null, detail = null, sinceMs, ageTip, nowMs, agent, whoText = null, sceneAgent, open, target, unverified, children, t }) {
  const style = useProjectStyle(board)
  const old = isOld({ sinceMs }, nowMs)   // the rule of the age is src/core/decisions.js' (one place, tested)
  const role = sceneAgent ? t(`role.${roleOf(sceneAgent).role || 'none'}`) : ''
  const who = agent || t('inbox.unassigned')
  return (
    <li className={`ux-dc${target ? ' target' : ''}`} style={style} data-decision={id} data-kind={kind} data-board={board || undefined} data-unverified={unverified ? '' : undefined} data-target={target ? "" : undefined} {...attrs}>
      <div className="ux-dc-top">
        {grouped ? (board ? <span className="ux-vh">{board}</span> : null) : <ProjectChip slug={board} label={t('ux.dec.project')} />}
        {kind === 'approval' ? <span className="ux-kind">{t('ux.dec.approval')}</span> : code ? <span className="code ux-mono">{code}</span> : null}
        {sinceMs != null ? (
          <span className={`ux-age${old ? ' old' : ''}`} title={ageTip} data-age>
            <Icon name="clock" size={14} />{shortAge(nowMs - sinceMs, t('ux.dec.day'))}
          </span>
        ) : null}
        {open}
      </div>
      <Clamped text={title} className="ux-dc-t" tip={title} more={t('ux.dec.more')} less={t('ux.dec.less')} button={{ 'data-dc-more': '' }} />
      {summary ? <p className="ux-dc-s" data-approval-summary>{summary}</p> : null}
      {detail}
      {reason ? (
        <Clamped text={reason} className="ux-dc-r" more={t('ux.dec.reasonMore')} less={t('ux.dec.reasonLess')} button={{ 'data-dc-more-reason': '' }}>
          <span className="ux-vh">{t('ux.dec.reason')}{' '}</span>
        </Clamped>
      ) : null}
      <div className="ux-dc-who">
        {sceneAgent ? <Portrait agent={sceneAgent} /> : null}
        <span className="nm">{whoText ?? who}</span>
        {role && !whoText ? <span className="role">· {role}</span> : null}
      </div>
      {children}
    </li>
  )
}
