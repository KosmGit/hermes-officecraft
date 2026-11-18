import { useEffect, useState } from 'react'

import { pageTickDelay } from '../core/daylight.js'

/**
 * A counter that moves once a minute (and at the day/night switch) so the page clock is taken again even when no read
 * changed. One setTimeout, none while the window is hidden (it is re-armed, and ticks once, when the window shows again),
 * cleared on unmount. This is not a data source: nothing is requested.
 */
export function usePageClock() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let timer = null
    const arm = () => {
      clearTimeout(timer)
      timer = null
      const delay = pageTickDelay(document.hidden, new Date())
      if (delay == null) return
      timer = setTimeout(() => { setTick(n => n + 1); arm() }, delay)
    }
    const onVisibility = () => {
      if (document.hidden) { clearTimeout(timer); timer = null; return }
      setTick(n => n + 1)
      arm()
    }
    arm()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [])
  return tick
}
