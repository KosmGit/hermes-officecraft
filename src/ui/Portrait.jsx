import { useEffect, useRef } from 'react'

import { portrait } from '../scene/index.js'

/** The agent's portrait: the scene's own sprite, front view, on its 28 x 30 buffer, drawn by the page. */
export function Portrait({ agent, className = 'oc-portrait' }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || !agent) return
    try {
      const p = portrait(agent)
      cv.getContext('2d').putImageData(new ImageData(p.d, p.W, p.H), 0, 0)
    } catch {
      /* a portrait that cannot be drawn leaves an empty frame, never a broken page */
    }
  }, [agent])
  return <canvas ref={ref} className={className} width={28} height={30} aria-hidden="true" />
}
