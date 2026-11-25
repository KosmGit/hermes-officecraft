import { BAR, barOf, tabForKey } from '../core/tabs.js'
import { Icon } from './icons.jsx'

const ICON = { office: 'office', decisions: 'inbox', projects: 'folder', journal: 'list' }

/**
 * The bar of a narrow pane (<= 700 px): Office, Decisions, Projects, Journal, one view at a time. Each entry is a tab of its own list
 * (arrows move, Home / End jump), the decisions carry their count and the Office the number of agents at work (the header of a narrow pane
 * keeps only the decisions). The Agent view belongs to the Office entry (it opens from an agent).
 */
export function TabBar({ view, onView, decisions, working = 0, t }) {
  const onKey = e => {
    const next = tabForKey(BAR, barOf(view), e.key)
    if (!next) return
    e.preventDefault()
    onView(next)
    const bar = e.currentTarget.parentElement   // read now: React clears currentTarget once the handler returns
    requestAnimationFrame(() => bar?.querySelector(`[data-view="${next}"]`)?.focus())
  }
  return (
    <nav className="ux-bar" role="tablist" aria-label={t('ux.bar.label')} data-tabbar>
      {BAR.map(k => (
        <button key={k} type="button" role="tab" data-view={k} aria-selected={barOf(view) === k} tabIndex={barOf(view) === k ? 0 : -1} onKeyDown={onKey} onClick={() => onView(k)}>
          <Icon name={ICON[k]} size={20} />
          {k === 'office' ? t('ux.bar.office') : t(`ux.tab.${k}`)}
          {k === 'decisions' && decisions ? <span className="ux-n warn" aria-label={String(decisions)}>{decisions}</span> : null}
          {k === 'office' && working > 0 ? <><span className="ux-n work" aria-hidden="true" data-working-count>{working}</span><span className="ux-vh">{t('ux.pill.workingLabel', working)}</span></> : null}
        </button>
      ))}
    </nav>
  )
}
