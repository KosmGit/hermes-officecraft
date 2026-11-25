import { LLM_ALL } from './llm.js'

/**
 * The structure of the settings, as pure data.
 * The tabs, the keyboard model of the tab list, and the rule of the help line. No SDK, no DOM.
 */

/** The tabs, in order. Every setting lives in exactly one of them (tests/js/settings.test.mjs). */
export const SETTINGS_TABS = Object.freeze(['general', 'notify', 'llm'])

/** Tabs that no longer exist and the one that holds their settings now (a remembered or linked name must not land on nothing). */
export const TAB_ALIASES = Object.freeze({ game: 'general', replay: 'general' })

/** The longest help line under a setting (characters). The rest goes behind the « ? » of the setting. */
export const HELP_MAX = 60

/** A tab that was folded into another one is that one; anything else that is not a known tab is the first. */
export const tabOf = value => (SETTINGS_TABS.includes(value) ? value : Object.hasOwn(TAB_ALIASES, value) ? TAB_ALIASES[value] : SETTINGS_TABS[0])

/**
 * The tab a key moves to from `current` (WAI-ARIA tabs, automatic activation), or null when the key is not for the tab list.
 * Arrows go both ways whatever the layout (the list is vertical on the side and horizontal on top), and wrap around.
 */
export function tabAfterKey(current, key) {
  const at = SETTINGS_TABS.indexOf(tabOf(current))
  const n = SETTINGS_TABS.length
  if (key === 'ArrowDown' || key === 'ArrowRight') return SETTINGS_TABS[(at + 1) % n]
  if (key === 'ArrowUp' || key === 'ArrowLeft') return SETTINGS_TABS[(at + n - 1) % n]
  if (key === 'Home') return SETTINGS_TABS[0]
  if (key === 'End') return SETTINGS_TABS[n - 1]
  return null
}

/** How many LLM functions are switched on, out of how many (the ten switches): the badge of the « LLM functions » tab. null while the server has not answered. */
export function llmOnCount(state) {
  if (!state?.settings?.features) return null
  return { on: LLM_ALL.filter(f => state.settings.features[f] === true).length, of: LLM_ALL.length }
}

/**
 * The badge of the « LLM functions » tab from the read of /llm (a React Query result). While that read fails the tab says the agent half
 * is missing, so the badge says nothing: never the count of a last good answer kept in the cache.
 */
export function llmTabBadge(query) {
  if (!query || query.isError) return null
  return llmOnCount(query.data ?? null)
}

/** The gauge of the month: the dash offset of a ring of radius `r` for a share `pct` (0 to 1) of the cap. */
export function ringDash(pct, r) {
  const length = 2 * Math.PI * r
  const share = Math.min(1, Math.max(0, Number.isFinite(pct) ? pct : 0))
  return { length, offset: length * (1 - share) }
}
