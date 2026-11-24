import { useId } from 'react'

import { foldAlerts } from '../core/alerts.js'
import { clockText } from '../core/tips.js'
import { Icon } from './icons.jsx'
import { PopCard, usePopover } from './Popover.jsx'

const ICON = { crit: 'crit', warn: 'warn', info: 'info' }

/** The short chip text of an alert, and its full sentence (the detail), in the page's language. */
export function alertTexts(a, t, { failingNames = [] } = {}) {
  switch (a.id) {
    case 'incident': return { short: t('ux.alert.incident', a.args.boards.join(', ')), detail: [t('game.incident', a.args.boards.join(', '), a.args.fails)] }
    case 'gateway': return { short: t('ux.alert.gateway'), detail: [t('gatewayDown')] }
    case 'degraded': return { short: t('ux.alert.degraded'), detail: [t('gatewayDegraded')] }
    case 'crons': return { short: t('cronsFailing', a.args.n), detail: [t('cronsFailing', a.args.n), failingNames.length ? t('ux.alert.cronsNames', failingNames.join(', ')) : ''].filter(Boolean) }
    case 'stale': return { short: t('ux.alert.stale'), detail: [t('banner.stale', clockText(a.args.staleMs, t.lang))] }
    case 'partial': {
      const p = a.args.partial
      const list = p.labels.map(l => t(`banner.source.${l.kind}`, l.name)).join(', ') + (p.more ? ` ${t('banner.more', p.more)}` : '')
      return { short: t('ux.alert.partial', p.labels.length + p.more), detail: [t('banner.partial', list)] }
    }
    default: return { short: t('ux.alert.roster'), detail: [t('rosterOnly')] }
  }
}

function Chip({ alert, label, children, t, texts }) {
  const pop = usePopover()
  const id = useId()
  return (
    <span className="ux-alw">
      <button ref={pop.anchor} type="button" className={`ux-al ${alert.tone}`} data-alert={alert.id} aria-expanded={pop.open} aria-controls={pop.open ? id : undefined} onClick={() => pop.setOpen(v => !v)}>
        <Icon name={ICON[alert.tone]} size={14} />
        <span>{label}</span>
        <Icon name="chev" size={14} className="chev" />
      </button>
      <PopCard pop={pop} id={id} label={t('ux.alert.label')}>
        {children ?? texts.detail.map((line, i) => <p key={i}>{line}</p>)}
      </PopCard>
    </span>
  )
}

/**
 * The rail of alerts under the header: one chip per warning, each one a button that opens its facts. In a narrow pane one chip
 * stands for all (the worst, « + N alerts »), its details listing every alert. Nothing here is a live region but the banner's own role.
 */
export function AlertRail({ alerts, narrow, t, failingNames }) {
  if (!alerts.length) return null
  const texts = alerts.map(a => alertTexts(a, t, { failingNames }))
  if (narrow) {
    const f = foldAlerts(alerts)
    const w = alerts.indexOf(f.worst)
    const label = f.more ? t('ux.alert.folded', texts[w].short, f.more) : texts[w].short
    return (
      <div className="ux-alerts" role="region" aria-label={t('ux.alert.label')} data-alerts>
        <Chip alert={f.worst} label={label} t={t} texts={texts[w]}>
          {alerts.map((a, i) => (<div key={a.id}><h5>{texts[i].short}</h5>{texts[i].detail.map((line, j) => <p key={j}>{line}</p>)}</div>))}
        </Chip>
      </div>
    )
  }
  return (
    <div className="ux-alerts" role="region" aria-label={t('ux.alert.label')} data-alerts>
      {alerts.map((a, i) => <Chip key={a.id} alert={a} label={texts[i].short} t={t} texts={texts[i]} />)}
    </div>
  )
}
