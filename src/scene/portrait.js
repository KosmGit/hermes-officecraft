/* Inspector portrait: the same sprite, front view, on a 28 x 30 buffer. */
import { agentSprite, GREY_STATES } from './agent.js'
import { Px } from './raster.js'

/** The head alone, 14 x 14, for the labels of the scene (the same sprite: who knows the character knows its label). */
export const FACE_SIZE = 14
export function face(a) {
  const px = new Px(FACE_SIZE, FACE_SIZE)
  const grey = GREY_STATES.has(a.state) && a.state !== 'stale'
  agentSprite({ ...a, state: 'active', sleepy: false }, 'front', 1).blit(px, 7, 30, grey)   // no bubble, no crystal row: the head only
  return { W: FACE_SIZE, H: FACE_SIZE, d: px.d }
}

export function portrait(a) {
  const px = new Px(28, 30)
  const shown = { ...a, state: a.state === 'waiting' ? 'active' : a.state }
  agentSprite(shown, 'front', 1).blit(px, 14, 29, GREY_STATES.has(a.state) && a.state !== 'stale')
  return { W: 28, H: 30, d: px.d }
}
