/**
 * Fit the row of project chips under the stage into its one row: measured with the counts on, too long -> the chips drop their
 * `done/total` count (data-compact); still too long -> the row scrolls and fades at its end (data-over). `el` is the row (any object
 * with scrollWidth, clientWidth and the attribute methods). Returns 'full' | 'compact' | 'over'.
 */
export function fitDockRow(el) {
  const fits = () => el.scrollWidth <= el.clientWidth + 1
  el.removeAttribute('data-compact')
  el.removeAttribute('data-over')
  if (fits()) return 'full'
  el.setAttribute('data-compact', '')
  if (fits()) return 'compact'
  el.setAttribute('data-over', '')
  return 'over'
}
