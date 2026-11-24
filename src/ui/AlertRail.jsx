import { useId, useLayoutEffect, useRef, useState } from 'react'

import { foldAlerts, railFit } from '../core/alerts.js'
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

function Chip({ alert, label, aria, children, t, texts, wkey }) {
  const pop = usePopover()
  const id = useId()
  return (
    <span className="ux-alw" data-alw={wkey}>
      <button ref={pop.anchor} type="button" className={`ux-al ${alert.tone}`} data-alert={alert.id} aria-expanded={pop.open} aria-controls={pop.open ? id : undefined} aria-label={aria} onClick={() => pop.setOpen(v => !v)}>
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
  return <WideRail alerts={alerts} texts={texts} t={t} />
}

/**
 * The rail of a wide pane: the chips that fit on the line, then « +N » for the others (a chip that is cut or hidden says nothing).
 * The natural width of each chip is measured once it is drawn and kept, so a folded chip is still counted; the rail's own width follows the pane.
 */
function WideRail({ alerts, texts, t }) {
  const rail = useRef(null)
  const [avail, setAvail] = useState(0)
  const [widths, setWidths] = useState({})
  useLayoutEffect(() => {
    const el = rail.current
    if (!el) return undefined
    const read = () => setAvail(el.clientWidth)
    read()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const keys = alerts.map((a, i) => `${a.id}|${texts[i].short}`)
  useLayoutEffect(() => {
    const seen = {}
    rail.current?.querySelectorAll('[data-alw]').forEach(w => { if (w.offsetWidth > 0) seen[w.dataset.alw] = Math.ceil(w.getBoundingClientRect().width) })
    setWidths(prev => (Object.keys(seen).every(k => prev[k] === seen[k]) ? prev : { ...prev, ...seen }))
  })
  const shown = railFit(keys.map(k => widths[k] ?? 0), avail)
  const rest = alerts.slice(shown)
  const worst = rest.length ? foldAlerts(rest).worst : null
  return (
    <div ref={rail} className="ux-alerts" role="region" aria-label={t('ux.alert.label')} data-alerts data-shown={shown}>
      {alerts.slice(0, shown).map((a, i) => <Chip key={a.id} alert={a} label={texts[i].short} t={t} texts={texts[i]} wkey={keys[i]} />)}
      {rest.length ? (
        <Chip alert={worst} label={t('banner.more', rest.length)} aria={t('ux.alert.rest', rest.length)} t={t} texts={texts[alerts.indexOf(worst)]}>
          {rest.map(a => { const x = texts[alerts.indexOf(a)]; return <div key={a.id}><h5>{x.short}</h5>{x.detail.map((line, j) => <p key={j}>{line}</p>)}</div> })}
        </Chip>
      ) : null}
    </div>
  )
}
