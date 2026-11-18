/**
 * The views of the details panel, as pure data. Wide pane: four tabs next to the office (Decisions first).
 * Narrow pane (<= NARROW_AT): one view at a time and a bar of four at the bottom (Office, Decisions, Projects, Journal); the Agent view
 * is reached from the roster or an agent, not from the bar. Keyboard: the tab list follows the WAI-ARIA pattern (arrows, Home, End).
 */
export const TABS = Object.freeze(['decisions', 'agent', 'projects', 'journal'])
export const BAR = Object.freeze(['office', 'decisions', 'projects', 'journal'])
/** At or below this pane width (CSS px) the page shows one view at a time. */
export const NARROW_AT = 700

export const isTab = v => TABS.includes(v)
export const isNarrow = width => width > 0 && width <= NARROW_AT

/** Next tab for a key on the tab list (roving focus): arrows wrap, Home / End jump; null for any other key. */
export function tabForKey(list, current, key) {
  const i = Math.max(0, list.indexOf(current))
  if (key === 'ArrowRight' || key === 'ArrowDown') return list[(i + 1) % list.length]
  if (key === 'ArrowLeft' || key === 'ArrowUp') return list[(i + list.length - 1) % list.length]
  if (key === 'Home') return list[0]
  if (key === 'End') return list[list.length - 1]
  return null
}

/** The bar entry that stands for a view (the Agent view belongs to the Office entry: it opens from the scene). */
export const barOf = view => (view === 'agent' ? 'office' : view)
