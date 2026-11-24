/**
 * The device pixel ratio changes when the window is dragged to a screen of another density, and `resize` does not fire then. A media query
 * on the exact ratio does: it stops matching at the change. Each firing re-arms the query on the new ratio. Pure (the window is passed in).
 * -> a function that stops listening.
 */
export function watchDpr(win, onChange) {
  if (typeof win?.matchMedia !== 'function') return () => {}
  let mq = null
  let stopped = false
  const fire = () => {
    if (stopped) return
    mq.removeEventListener?.('change', fire)
    onChange(win.devicePixelRatio || 1)
    arm()
  }
  const arm = () => {
    mq = win.matchMedia(`(resolution: ${win.devicePixelRatio || 1}dppx)`)
    mq.addEventListener?.('change', fire)
  }
  arm()
  return () => { stopped = true; mq?.removeEventListener?.('change', fire) }
}
