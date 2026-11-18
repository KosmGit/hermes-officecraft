/* What the page does for the keyboard and the pointer on small objects. Pure: no SDK, no DOM, testable by value. */
import { tipOf } from '../core/tips.js'

/** WCAG 2.5.8 (target size, minimum): 24 x 24 CSS pixels. */
export const MIN_TARGET = 24

/**
 * A clickable / focusable zone of the scene, never smaller than MIN_TARGET CSS px: it grows around its own centre (an invisible
 * margin: the drawing and the tooltip anchor do not move). A zone already big enough is returned as it is.
 * box: { left, top, width, height } in CSS px.
 */
export function hitBox({ left, top, width, height }) {
  const w = Math.max(width, MIN_TARGET)
  const h = Math.max(height, MIN_TARGET)
  return { left: left - (w - width) / 2, top: top - (h - height) / 2, width: w, height: h }
}

/**
 * The skip link « Go to the details »: with the panel open, the focus goes to its title now; folded, the panel opens first (the drawer
 * on a narrow pane, the side panel on a wide one) and the focus follows once it is there.
 */
export function skipPlan({ panelOpen, narrow }) {
  if (panelOpen) return { focusNow: true, open: null }
  return { focusNow: false, open: narrow ? 'drawer' : 'panel' }
}

/** The tooltip of a scene object (src/core/tips.js). */
export const spotTip = (sp, office, ctx) => tipOf(sp, office, ctx)
