import { useEffect, useRef } from 'react'

import { icon, MEDAL_SIZE, medalArt } from '../scene/index.js'

/**
 * A game icon (src/scene/icons.js: the same pixel-art engine as the office, no image file, no emoji font).
 * 14 x 14 art pixels, drawn once into a canvas and scaled with crisp pixels. Decorative: the label is next to it.
 */
export function PixelIcon({ id, size = 20, className = 'oc-icon', ...rest }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    try {
      const i = icon(id)
      cv.getContext('2d').putImageData(new ImageData(i.d, i.W, i.H), 0, 0)
    } catch {
      /* an icon that cannot be drawn leaves an empty square, never a broken page */
    }
  }, [id])
  return <canvas ref={ref} className={className} width={14} height={14} style={{ width: size, height: size }} aria-hidden="true" {...rest} />
}

/**
 * A medal of the showcase (src/scene/medalart.js): 28 x 28 art pixels, drawn once per state into a canvas and scaled with crisp pixels.
 * Decorative: the name, the state and the tier are written next to it (and in the button's label).
 */
export function PixelMedal({ id, family, tier, unlocked, hidden, size = 56, className = 'oc-medal', ...rest }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    try {
      const m = medalArt({ id, family, tier, unlocked, hidden })
      cv.getContext('2d').putImageData(new ImageData(m.d, m.W, m.H), 0, 0)
    } catch {
      /* a medal that cannot be drawn leaves an empty square, never a broken page */
    }
  }, [id, family, tier, unlocked, hidden])
  return <canvas ref={ref} className={className} width={MEDAL_SIZE} height={MEDAL_SIZE} style={{ width: size, height: size }} aria-hidden="true" {...rest} />
}
