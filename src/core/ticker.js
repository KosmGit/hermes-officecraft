/**
 * Frame ticker for the scene: one local interval, never started by itself, never alive after stop().
 * Timers are injected so a node test can prove "no timer left after unmount" and "no frame while hidden".
 * One frame every 260 ms; frames are skipped while the page is hidden.
 */
export const FRAME_MS = 260
export const FRAME_COUNT = 840

export function createTicker({ paint, hidden = () => false, periodMs = FRAME_MS, startFrame = 0, timers = globalThis }) {
  let id = null
  const state = { frame: startFrame % FRAME_COUNT, painted: 0 }
  const tick = () => {
    if (hidden()) return
    state.frame = (state.frame + 1) % FRAME_COUNT
    state.painted += 1
    paint(state.frame)
  }
  return {
    start() { if (id === null) id = timers.setInterval(tick, periodMs) },
    stop() { if (id !== null) { timers.clearInterval(id); id = null } },
    get running() { return id !== null },
    get frame() { return state.frame },
    get painted() { return state.painted },
    tick
  }
}

/** Animate only when a fact needs motion, the page is visible and the user did not ask for less motion. */
export const shouldAnimate = ({ needs, visible, reducedMotion }) => Boolean(needs && visible && !reducedMotion)
