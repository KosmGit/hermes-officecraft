/** At or below this pane width (CSS px, the pane the plugin gets, not the window) the settings panel of the gear is a sheet from the bottom edge instead of a popover. */
export const SHEET_AT = 600

/** Sheet (true) or popover anchored to the gear (false); popover until the first measure (width 0). Pure: tested under node. */
export const settingsSheet = width => width > 0 && width <= SHEET_AT
