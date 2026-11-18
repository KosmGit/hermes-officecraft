/**
 * Local UI state that must survive the page being left and opened again. Pure: no SDK, no DOM.
 *
 *  - the selected agent lives in a module-level memory: it outlives the React tree (leaving #/officecraft unmounts the page)
 *    but not the tab (a reload starts clean: a selection is a moment, not a preference). It is forgotten as soon as the
 *    agent no longer exists.
 *  - the side panel open / folded is a layout preference, kept by ctx.storage (src/data/prefs.js); `panelOpenOf` reads it.
 */
let remembered = null

/** The agent selected when the page was left (null if none). */
export const rememberedSelection = () => remembered

/** Remember (or, with null / '', forget) the selected agent. */
export function rememberSelection(name) {
  remembered = typeof name === 'string' && name ? name : null
  return remembered
}

/** The remembered agent if it is still in the roster, else null (and the memory is cleared: « forgotten if it no longer exists »). */
export function recallSelection(names) {
  if (remembered && !(names || []).includes(remembered)) remembered = null
  return remembered
}

/** Stored panel value -> open?  Only an explicit `false` folds it: the default (and any junk) is open. */
export const panelOpenOf = stored => stored !== false
