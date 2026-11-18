/* The medal of the showcase: a 28 x 28 pixel-art medal drawn with the same engine as the office (no image file).
   Pure: RGBA buffer out. The art palette lives here; the page only blits the buffer into a canvas.
   - ribbon = the family's colour; rim = the tier's metal (bronze, silver, gold: the shape says it too, 1 / 2 / 3 pips) or, for a
     single-level achievement, the family's colour; face = a dark plate carrying the achievement's own pixel icon;
   - locked = grey metal and a dimmed icon; locked AND hidden = a « ? » and nothing else (it gives nothing away). */
import { hx, mixc, mulc } from './color.js'
import { FAMILY_METAL, TIER_METAL } from './decor.js'
import { icon } from './icons.js'

export const MEDAL_SIZE = 28
const CX = 13.5
const CY = 16.5
const R_RIM = 11.4
const R_FACE = 9.2
const GREY = hx('#aab1bb')
const GREY_RIBBON = hx('#8c939e')
const PLATE = hx('#1e2431')
const PIP = hx('#fff4c8')

const put = (d, x, y, c, a = 255) => {
  if (x < 0 || y < 0 || x >= MEDAL_SIZE || y >= MEDAL_SIZE) return
  const i = (y * MEDAL_SIZE + x) * 4
  d[i] = c[0]
  d[i + 1] = c[1]
  d[i + 2] = c[2]
  d[i + 3] = a
}

/** The colour of a family (CSS hex): the ribbon of its medals, and the key of its shelf and chip in the showcase (one colour code). */
export const familyColor = family => FAMILY_METAL[family] || '#3d7bfd'

/** The colours of one medal: { ribbon, rim, face }. */
export function medalColors({ family, tier, unlocked }) {
  if (!unlocked) return { ribbon: GREY_RIBBON, rim: GREY, face: mixc(PLATE, GREY, 0.12) }
  const ribbon = hx(familyColor(family))
  const rim = tier ? hx(TIER_METAL[tier] || TIER_METAL.bronze) : ribbon
  return { ribbon, rim, face: mixc(PLATE, rim, 0.2) }
}

/** The number of pips under the glyph: 1 / 2 / 3 for a reached tier, none for a single-level achievement or a locked one. */
export const pipsOf = ({ tier, unlocked }) => (unlocked && tier ? { bronze: 1, silver: 2, gold: 3 }[tier] || 0 : 0)

/**
 * medalArt({ id, family, tier, unlocked, hidden }) -> { W, H, d } (RGBA, transparent outside the medal).
 * A hidden achievement that is still locked draws the « ? » icon, whatever its id.
 */
export function medalArt(m) {
  const d = new Uint8ClampedArray(MEDAL_SIZE * MEDAL_SIZE * 4)
  const secret = Boolean(m.hidden && !m.unlocked)
  const { ribbon, rim, face } = medalColors(m)
  // ribbon: two tails that cross behind the disc
  for (let y = 0; y < 10; y++) {
    const s = Math.floor(y / 3)
    for (let x = 0; x < 4; x++) put(d, 7 + s + x, y, y % 2 ? mulc(ribbon, 0.92) : ribbon)
    for (let x = 0; x < 4; x++) put(d, 16 - s + x, y, mulc(ribbon, 0.7))
  }
  // disc: bevelled rim (light from the top left), flat dark face
  for (let y = 0; y < MEDAL_SIZE; y++) {
    for (let x = 0; x < MEDAL_SIZE; x++) {
      const dx = x - CX
      const dy = y - CY
      const r = Math.hypot(dx, dy)
      if (r > R_RIM) continue
      if (r > R_FACE) put(d, x, y, mulc(rim, dx + dy < 0 ? 1.18 : 0.78))
      else put(d, x, y, r > R_FACE - 1 ? mulc(face, 0.7) : face)
    }
  }
  if (!secret && m.unlocked) { put(d, 5, 11, mulc(rim, 1.4)); put(d, 6, 10, mulc(rim, 1.4)); put(d, 5, 12, mulc(rim, 1.25)) }
  // glyph: the achievement's own pixel icon, centred on the face (a locked one dimmed to grey)
  const art = icon(secret ? 'hidden' : m.id)
  for (let y = 0; y < art.H; y++) {
    for (let x = 0; x < art.W; x++) {
      const i = (y * art.W + x) * 4
      if (art.d[i + 3] < 128) continue
      let c = [art.d[i], art.d[i + 1], art.d[i + 2]]
      if (!m.unlocked && !secret) { const g = (c[0] + c[1] + c[2]) / 3; c = mixc([g, g, g], face, 0.45) }
      put(d, 7 + x, 9 + y, c)
    }
  }
  // pips: the tier by number as well as by metal
  const n = pipsOf(m)
  for (let k = 0; k < n; k++) {
    const x = Math.round(CX - 0.5 + (k - (n - 1) / 2) * 4)
    put(d, x, 24, PIP); put(d, x + 1, 24, PIP); put(d, x, 25, mulc(PIP, 0.8)); put(d, x + 1, 25, mulc(PIP, 0.8))
  }
  return { W: MEDAL_SIZE, H: MEDAL_SIZE, d }
}
