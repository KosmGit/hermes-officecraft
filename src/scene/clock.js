/* The wall clock. The face is baked into the base layer; the hands are drawn per frame, so the base does not depend on the
   minute: it is rebuilt only when the structure or the light (day / night) changes, and the clock stays exact to the minute.
   Same geometry as the baked decal always had: radius 10.5, hour hand 4, minute hand 6.6, hands under the ticks, over the face. */
import { hx } from './color.js'
import { TW2 } from './constants.js'

export const CLOCK_Z = 60
export const HAND = hx('#23262c')
const FACE_R = 8   // the hands live inside the face (the rim starts at 8)

/** Wall position of the clock face centre (art pixels along the back wall). */
export const clockS = layout => (layout.lounge.x0 + 1.3) * TW2

/** On one of the twelve ticks (they sit on the outer ring of the face and win over the hands). */
export const onTick = (u, v) => {
  const ang = Math.atan2(u, v)
  return Math.abs(((ang / (Math.PI / 6)) % 1 + 1) % 1 - 0.5) > 0.42 && Math.hypot(u, v) > 6.4
}

/** (u, v) -> is it under a hand, for a time (the viewer's local time zone). */
export function handsAt(nowMs) {
  const d = new Date(nowMs)
  const hA = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2
  const mA = d.getMinutes() / 60 * Math.PI * 2
  const seg = (u, v, ang, len) => {
    const ex = Math.sin(ang) * len
    const ey = Math.cos(ang) * len
    const t = Math.max(0, Math.min(1, (u * ex + v * ey) / (len * len)))
    return Math.hypot(u - ex * t, v - ey * t) < 0.6
  }
  return (u, v) => seg(u, v, hA, 4) || seg(u, v, mA, 6.6)
}

/** Draw the two hands over the baked face (lit like the face: the base light is already in `px.L`). */
export function drawClockHands(px, layout, nowMs) {
  const hand = handsAt(nowMs)
  const sc = clockS(layout)
  const { ox, oy } = layout.origin
  for (let x = Math.floor(ox + sc - FACE_R - 1); x <= Math.ceil(ox + sc + FACE_R + 1); x++) {
    const s = x + 0.5 - ox
    const u = s - sc
    const yBase = oy + s / 2 - CLOCK_Z
    for (let y = Math.floor(yBase - FACE_R - 1); y <= Math.ceil(yBase + FACE_R + 1); y++) {
      const v = oy + s / 2 - (y + 0.5) - CLOCK_Z
      if (Math.hypot(u, v) > FACE_R || onTick(u, v) || !hand(u, v)) continue
      px.put(x, y, HAND)
    }
  }
}
