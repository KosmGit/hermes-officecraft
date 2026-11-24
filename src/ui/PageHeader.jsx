import { useEffect, useId } from 'react'

import { Icon } from './icons.jsx'
import { PixelIcon } from './PixelIcon.jsx'
import { PopCard, usePopover } from './Popover.jsx'
import { moreMenuTarget } from './targets.js'
import { WhyButton } from './Why.jsx'
import { useT } from './useT.js'

/**
 * The entry of the trophies in the header: three segments of the same structure (icon + value over its caption), 32 px like the buttons beside it, one axis:
 * « Campus · lvl 4 » on a bar and `247/1000`, `22/35` over « trophies », `10 d` over « streak ». Each segment's tooltip says what it counts.
 * Every part carries `data-game`: sober mode renders none of it. Opens the showcase window (level, trophies on their shelves, postcard).
 */
function GameBadge({ game, onOpen, t }) {
  const lvl = game.office
  const got = game.achievements.filter(a => a.unlocked).length
  const total = game.achievements.length
  const pct = lvl.next ? Math.min(100, Math.round((lvl.done / lvl.next) * 1000) / 10) : 100   // the bar says what « done/next » says
  const streak = game.quests?.streakDays ?? 0
  const name = t(`game.levelName.${lvl.name}`)
  return (
    <button type="button" className="ux-game" data-game data-badge aria-haspopup="dialog" title={t('ux.badge.tip')} aria-label={t('ux.badge.open', [`${name}, ${t('ux.badge.level', lvl.level)}`, t('ux.badge.trophiesTip', got, total), streak > 0 ? t('ux.badge.streakLabel', streak) : ''].filter(Boolean).join(', '))} onClick={onOpen}>
      <span className="ux-gs lvl" data-game data-level={lvl.level} data-level-name={lvl.name} title={t('ux.badge.levelTip', lvl.done, lvl.next)}>
        <PixelIcon id="office" size={20} />
        <span className="ux-g2">
          <b>{name} · {t('ux.badge.level', lvl.level)}</b>
          <span className="ux-g2b">
            <span className="ux-mbar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
            <small className="ux-mono">{lvl.next ? `${lvl.done}/${lvl.next}` : lvl.done}</small>
          </span>
        </span>
      </span>
      <span className="ux-gs" data-game data-trophy-count title={t('ux.badge.trophiesTip', got, total)}>
        <PixelIcon id="chain" size={20} />
        <span className="ux-g2"><b className="ux-mono">{got}<span className="of">/{total}</span></b><small>{t('ux.badge.trophies')}</small></span>
      </span>
      {streak > 0 ? (
        <span className="ux-gs" data-game data-streak={streak} title={t('game.streakTip')}>
          <PixelIcon id="flame" size={20} />
          <span className="ux-g2"><b className="ux-mono">{t('ux.badge.days', streak)}</b><small>{t('ux.badge.streak')}</small></span>
        </span>
      ) : null}
    </button>
  )
}

/**
 * « More » of a narrow pane: the actions that left the header, in a real menu (role=menu): the focus goes into it when it opens, the
 * arrows, Home and End move between the items, Escape closes it and gives the focus back to the button, Tab leaves it. An item that
 * opens a window hands the focus back to this button when the window closes (the item is gone by then, the header's own button is hidden).
 */
function MoreMenu({ items, label }) {
  const pop = usePopover()
  const id = useId()
  const placed = Boolean(pop.pos)
  const entries = () => [...(pop.card.current?.querySelectorAll('[role^="menuitem"]') ?? [])]
  // the card stays hidden (so unfocusable) until it is placed: the focus enters once it is
  useEffect(() => { if (pop.open && placed) entries()[0]?.focus() }, [pop.open, placed])   // eslint-disable-line react-hooks/exhaustive-deps
  const onKeyDown = e => {
    const list = entries()
    const at = list.indexOf(document.activeElement)
    const to = moreMenuTarget(e.key, at, list.length)
    if (to != null) { e.preventDefault(); list[to]?.focus() } else if (e.key === 'Tab') { pop.setOpen(false); pop.anchor.current?.focus() }
  }
  return (
    <span className="ux-menu only-n-wrap">
      <button ref={pop.anchor} type="button" className="ux-b ico keep only-n" data-more-toggle aria-haspopup="menu" aria-expanded={pop.open} aria-controls={pop.open ? id : undefined} aria-label={label} onClick={() => pop.setOpen(v => !v)}>
        <Icon name="more" />
      </button>
      <PopCard pop={pop} id={id} label={label} className="menu" role="menu" onKeyDown={onKeyDown}>
        {items.map(it => (
          <button key={it.key} type="button" role={it.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={it.pressed === undefined ? undefined : it.pressed} tabIndex={-1} data-more={it.key}
            aria-disabled={it.disabled ? true : undefined} onClick={() => { pop.setOpen(false); if (!it.disabled) it.onClick() }}>
            <Icon name={it.icon} size={14} />{it.label}{it.disabled && it.why ? <small className="why">{it.why}</small> : null}
          </button>
        ))}
      </PopCard>
    </span>
  )
}

/**
 * The header, one row: the brand, the live state in three buttons (working, decisions, agents: each one takes you to what it counts),
 * the game badge, then the actions: replay, resources, recruit, (decorator), the panel and the settings. Under 1500 px of pane the labels
 * are icons (their text stays in aria-label and title); in a narrow pane only the decisions pill, the badge, « more » and the settings stay.
 */
export function PageHeader({ t, counts, decisionCount, game, onBadge, onGo, replayOn, replay, usage, recruit, campaign, decor, panel, gear, narrow }) {
  const more = []
  if (replay) more.push({ key: 'replay', icon: 'replay', label: t('replay.open'), pressed: replayOn, disabled: replay.disabled, why: replay.disabled ? t('replay.openBusy') : '', onClick: replay.onClick })
  if (usage) more.push({ key: 'usage', icon: 'usage', label: t('usage.open'), onClick: usage.onClick })
  if (recruit) more.push({ key: 'recruit', icon: 'recruit', label: t('recruit.open'), onClick: recruit.onClick })
  if (campaign) more.push({ key: 'campaign', icon: 'layers', label: t('campaign.open'), onClick: campaign.onClick })
  if (decor) more.push({ key: 'decor', icon: 'spark', label: t('llm.decor.open'), onClick: decor.onClick })
  return (
    <header className="ux-top">
      <div className="ux-brand">
        <span className="mk" aria-hidden="true"><Icon name="house" size={20} /></span>
        <h1>{t('title')}</h1>
      </div>
      {counts.total > 0 ? (
        <div className="ux-live" role="group" aria-label={t('ux.pill.label')}>
          <button type="button" className="ux-lvp working" data-go="agent" aria-label={t('ux.pill.workingLabel', counts.working)} title={t('ux.pill.workingTip')} onClick={() => onGo('agent')}>
            <span className={`ux-pulse${counts.working ? '' : ' off'}`} aria-hidden="true" />
            <b>{counts.working}</b><span className="w">{t('ux.pill.working', counts.working)}</span>
          </button>
          <button type="button" className={`ux-lvp dec${decisionCount ? ' warn' : ''}`} data-go="decisions" title={t('ux.pill.decisionsTip')} onClick={() => onGo('decisions')}>
            <Icon name="warn" size={14} />
            <b>{decisionCount ?? '—'}</b><span className="w">{t('ux.pill.decisions', decisionCount ?? 0)}</span>
          </button>
          <button type="button" className="ux-lvp agents" data-go="agent" onClick={() => onGo('agent')}>
            <b>{counts.total}</b>{t('ux.pill.agents', counts.total)}
          </button>
        </div>
      ) : null}
      <span className="ux-sp" />
      {game ? <GameBadge game={game} onOpen={onBadge} t={t} /> : null}
      <div className="ux-acts">
        {replay ? (
          <WhyButton buttonRef={replay.ref} className="ux-b" data-replay-open aria-pressed={replayOn} reason={replay.disabled ? t('replay.openBusy') : ''} title={replay.disabled ? t('replay.openBusy') : t('replay.openTip')} aria-label={t('replay.open')} onGo={replay.onClick}>
            <Icon name="replay" /><span className="lb">{t('replay.open')}</span>
          </WhyButton>
        ) : null}
        {usage ? (
          <button ref={usage.ref} type="button" className="ux-b" data-usage-open title={t('usage.openTip')} aria-label={t('usage.open')} onClick={usage.onClick}>
            <Icon name="usage" /><span className="lb">{t('usage.open')}</span>
          </button>
        ) : null}
        {recruit ? (
          <button type="button" className="ux-b" data-recruit-open title={t('recruit.openTip')} aria-label={t('recruit.open')} onClick={recruit.onClick}>
            <Icon name="recruit" /><span className="lb">{t('recruit.open')}</span>
          </button>
        ) : null}
        {campaign ? (
          <button type="button" className="ux-b" data-campaign-open title={t('campaign.openTip')} aria-label={t('campaign.open')} onClick={campaign.onClick}>
            <Icon name="layers" /><span className="lb">{t('campaign.open')}</span>
          </button>
        ) : null}
        {decor ? (
          <button type="button" className="ux-b ico" data-decor-open title={t('llm.decor.openTip')} aria-label={t('llm.decor.open')} onClick={decor.onClick}>
            <Icon name="spark" />
          </button>
        ) : null}
        {panel ? <span className="sep" aria-hidden="true" /> : null}
        {panel ? (
          <button ref={panel.ref} type="button" className={`ux-b ico${replayOn ? ' keep' : ''}`} data-panel-toggle aria-expanded={panel.open} aria-controls="oc-panel" title={panel.open ? t('panel.hideTip') : t('panel.showTip')} aria-label={panel.open ? t('panel.hide') : t('panel.show')} onClick={panel.onClick}>
            <Icon name="panel" />
          </button>
        ) : null}
        {narrow && more.length ? <MoreMenu items={more} label={t('ux.more')} /> : null}
        {gear}
      </div>
    </header>
  )
}
