/* One outdoor world. The ground around the room (backdrop.js) and what the glazing shows (base.js) share this palette and
   this light, so the glazing looks out on the park that is drawn around the building: lawn, trees, sky. The decorator's view
   ('city' | 'sea' | 'forest', style.js) only changes the far distance seen beyond the park (a skyline, the sea, a forest edge), never
   the park itself; with no fiche the glazing shows the park alone. Pure: no DOM, no clock, no random. */
import { E, hx, mixc } from './color.js'
import { hash } from './util.js'

export const GRASS = ['#76a755', '#72a353', '#7aac58', '#6fa050'].map(hx)   // close tones: tiles must not read as a checkerboard
export const BLADE = hx('#4f7f3c')
export const BLADE_L = hx('#a2cf7a')
export const BARK = hx('#6b4a33')
export const BARK_D = hx('#4d3524')
export const LEAF = ['#3f7a3d', '#4e8a45', '#5f9d4f', '#73b05a'].map(hx)   // dark outline, shade, body, light
/** Night ambient of the outdoors (the room's own night ambient is base.js; the ground uses this one). */
export const NIGHT_AMB = [0.27, 0.32, 0.52]   // as dark as the room's own night (base.js NIGHT_AMBIENT)
export const DAY_AMB = [1, 0.99, 0.965]

const SKY_LO = hx('#cfeaf8')
const SKY_HI = hx('#83c1ea')
const CLOUD = hx('#f4f9fd')
const NSKY_LO = hx('#1d2a55')
const NSKY_HI = hx('#0c1330')
const STAR = hx('#e8ecff')
const HAZE = hx('#a9c7d8')     // the far distance by day: bluish, pale (aerial perspective)
const HAZE_N = hx('#1a2440')
export const TOWER = hx('#7791ab')     // dark enough against the low sky (#cfeaf8) to read as towers, still paler than the park
export const TOWER_HI = hx('#a9c0d2')
const TOWER_N = hx('#46527c')   // a step lighter than the night sky: the skyline must read as a silhouette
const WIN_N = hx('#f2c96b')
const SEA = [hx('#3f86b4'), hx('#6fb2d6')]
const SEA_N = [hx('#1a3560'), hx('#294a7c')]   // lighter than the sky above the horizon, as water reflects it
const FOAM = hx('#e2f2f9')
const MOON_GLINT = hx('#e8e2b8')
const FAR_WOOD = [hx('#4f7f5a'), hx('#3d6b49')]   // a forest edge in the distance: darker and bluer than the park's own leaves
const FAR_WOOD_N = [hx('#122219'), hx('#0d1913')]

const lit = (c, night) => (night ? [c[0] * NIGHT_AMB[0], c[1] * NIGHT_AMB[1], c[2] * NIGHT_AMB[2]] : c)
const n01 = (...k) => (hash(k.join(':')) % 1000) / 1000

/**
 * What a pane of the glazing shows at (s, v): `s` along the wall in art pixels (any origin: only its variations matter), `v` the height
 * above the bottom of the pane, `Hd` the pane's height. Layers from near to far: lawn, the park's trees, the far distance of the
 * view, the sky. Emissive (the room light never tints the outdoors). `view`: 'park' (no fiche), 'city', 'sea', 'forest'.
 */
export function outdoorView(view, s, v, Hd, night) {
  const t = v / Hd
  const si = Math.floor(s)
  // 1. the lawn, at the foot of the pane (the same grass as the ground drawn around the room)
  // 5-6 px: the pane frame hides the lowest 1.5 px, and a 1-2 px strip does not read as the lawn under the sea
  const lawn = 5 + (Math.sin(s * 0.21) > 0.6 ? 1 : 0)
  if (v < lawn) {
    const r = n01('wl', si, Math.floor(v))
    return E(lit(r < 0.12 ? BLADE : r < 0.18 ? BLADE_L : GRASS[si & 3], night))
  }
  // 2. the park's trees: round crowns on short trunks, lit from the upper left like the trees outside
  const cell = Math.floor((s + 1000) / 13)
  for (const c of [cell - 1, cell, cell + 1]) {
    // by the sea the park is open: fewer trees; before the city too, or their crowns hide the whole skyline
    if (view !== 'park' && view !== 'forest' && n01('tk', c) < (view === 'sea' ? 0.55 : 0.4)) continue
    const cx = c * 13 - 1000 + 6.5 + (n01('tx', c) - 0.5) * 5
    const r = 5 + n01('tr', c) * 3
    const cy = lawn + 4 + r * 0.9 + n01('ty', c) * 3
    const dx = s - cx
    const dy = v - cy
    const q = (dx * dx) / (r * r) + (dy * dy) / (r * r * 0.85)
    if (q <= 1) {
      const edge = q > 0.78
      const light = -dx / r + dy / r   // upper left = light (s grows to the right, v grows upward)
      const k = edge ? 0 : light > 0.55 ? 3 : light < -0.5 ? 1 : 2
      return E(lit(LEAF[k], night))
    }
    if (Math.abs(dx) < 1 && v < cy - r * 0.6) return E(lit(dx > 0 ? BARK_D : BARK, night))
  }
  // 3. the far distance, beyond the park
  const far = farLayer(view, s, v, Hd, night, lawn)
  if (far) return E(far)
  // 4. the sky
  if (night) return E(n01('st', si, Math.floor(v)) < 0.012 ? STAR : mixc(NSKY_LO, NSKY_HI, t))
  const cloud = Math.sin((s + 3) * 0.35) + Math.sin(s * 0.13 + v * 0.4) > 1.25 && t > 0.6
  return E(cloud ? CLOUD : mixc(SKY_LO, SKY_HI, t))
}

function farLayer(view, s, v, Hd, night, lawn) {
  const si = Math.floor(s)
  if (view === 'city') {
    // a low skyline far behind the park, pale with distance; lit offices at night
    // towers 6 px wide, of unequal heights, 2 px of low blocks between them and the tallest above the crowns of the
    // park: a skyline with sky between the towers, not a grey band behind the trees
    const bi = Math.floor((s + 400) / 8)
    const tower = s + 400 - bi * 8 < 6
    const bh = lawn + (tower ? 9 + (hash('b' + bi) % 12) : 4)
    if (v >= bh) return null
    if (night) return tower && v < bh - 2 && n01('w', bi, Math.floor(v / 2)) < 0.3 && si % 2 === 0 && Math.floor(v) % 2 === 0 ? WIN_N : TOWER_N
    return (si + bi) % 3 === 0 && Math.floor(v) % 3 === 0 ? TOWER_HI : TOWER
  }
  if (view === 'sea') {
    // the sea from the end of the lawn to the horizon; a moon glint at night
    const hz = lawn + Math.round(Hd * 0.24)
    if (v >= hz) return null
    const wave = n01('wv', Math.floor(s / 2), Math.floor(v)) < 0.09
    if (night) return (wave || n01('mg', si, Math.floor(v)) < 0.25) && Math.abs((((s % 40) + 40) % 40) - 20) < 3 ? MOON_GLINT : mixc(SEA_N[0], SEA_N[1], (v - lawn) / (hz - lawn))
    return wave ? FOAM : mixc(SEA[0], SEA[1], (v - lawn) / (hz - lawn))
  }
  if (view === 'forest') {
    // a dense forest edge closing the park: pointed crowns, darker than the park's trees
    const h = lawn + Hd * (0.3 + 0.1 * Math.abs(Math.sin(s * 0.45)) + 0.06 * Math.sin(s * 1.7))
    if (v >= h) return null
    return night ? FAR_WOOD_N[(si + Math.floor(v)) % 5 === 0 ? 0 : 1] : FAR_WOOD[(si + Math.floor(v)) % 5 === 0 ? 0 : 1]
  }
  // the park alone: a low line of distant trees, hazy
  const h = lawn + 3 + 2 * Math.abs(Math.sin(s * 0.5)) + Math.abs(Math.sin(s * 0.17)) * 2
  if (v >= h) return null
  return night ? HAZE_N : HAZE
}
