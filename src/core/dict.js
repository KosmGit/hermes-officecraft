/**
 * A table indexed by a name the backend gives (a bot, a model): an object without prototype, so that a bot called
 * `constructor` is a name like any other. With a plain `{}`, `table['constructor']` is Object's own function: the entry
 * "exists" before it was written and the page throws on it. Pure: no SDK, no DOM.
 */
export const dict = entries => Object.assign(Object.create(null), entries)

/** The empty table, shared and frozen. */
export const NO_ENTRIES = Object.freeze(Object.create(null))
