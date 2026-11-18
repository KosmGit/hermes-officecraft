import { STATE_ICON_SIZE, face, stateIconCells } from '../scene/index.js'
import { useEffect, useRef } from 'react'

/**
 * The sign of a state (src/scene/stateicons.js), drawn as SVG rects in the text colour: no image file, no emoji, no literal colour
 * (the label's CSS gives the hue of the state). Decorative: the state is in the button's label.
 */
export function StateIcon({ state, size = STATE_ICON_SIZE }) {
  return (
    <svg className="oc-sti" viewBox={`0 0 ${STATE_ICON_SIZE} ${STATE_ICON_SIZE}`} width={size} height={size} shapeRendering="crispEdges" fill="currentColor" aria-hidden="true" focusable="false">
      {stateIconCells(state).map(([x, y]) => <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" />)}
    </svg>
  )
}

/** The agent's head (the scene's own sprite, 14 x 14) at the start of its label. `agent`: the scene model's agent (it carries the outfit). */
export function Face({ agent }) {
  const ref = useRef(null)
  const key = agent ? JSON.stringify([agent.name, agent.state, agent.roleOverride, agent.modelRole, agent.description, agent.skills, agent.copiedSkills]) : ''
  useEffect(() => {
    const cv = ref.current
    if (!cv || !agent) return
    try {
      const p = face(agent)
      cv.getContext('2d').putImageData(new ImageData(p.d, p.W, p.H), 0, 0)
    } catch {
      /* a head that cannot be drawn leaves an empty square, never a broken page */
    }
  }, [key])   // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="oc-face" width={14} height={14} aria-hidden="true" />
}
