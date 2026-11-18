/* Desk furniture and per-agent props: monitors (the screen shows the agent's state), chairs, keyboard, mug, plants, floor halos. */
import { E, hslc, hx, mulc } from './color.js'
import { DESK_Z, SEAT_Z, TH2, TW2 } from './constants.js'
import { diploma } from './decor.js'
import { skillProps } from './kits.js'
import { PAL, lookOf } from './palette.js'
import { Lay, Spr, box, onY, shadeFor } from './raster.js'
import { hash, rnd } from './util.js'

export function drawMonitor(px, x, y, w, faceCam, a, frame, night) {
  box(px, x + w / 2 - 0.05, y - 0.02, DESK_Z, 0.1, 0.1, 4, shadeFor(PAL.leg))
  const z = DESK_Z + 4
  const h = 10
  if (!faceCam) { box(px, x, y, z, w, 0.07, h, { t: PAL.bezel, l: PAL.monBack, r: PAL.bezel }); return }
  box(px, x, y, z, w, 0.07, h, { t: PAL.bezel, l: PAL.bezel, r: PAL.bezel })
  const st = a ? a.state : 'off'
  const Y0 = y + 0.07
  const map = onY(px, Y0)
  // stale = frozen grey screen; unknown and any future state fall back to a dead screen
  const scr = { working: hx('#bfe4ff'), active: hx('#a9bfdc'), waiting: hx('#ffe1a8'), idle: hx('#1d2433'), stale: hx('#3a4150'), new: hx('#161a22'), off: hx('#161a22'), unknown: hx('#161a22') }[st] || hx('#161a22')
  const ink = { working: hx('#2f6fc0'), active: hx('#4b6585'), waiting: hx('#c06a12') }[st]
  px.poly([px.P(x + 0.06, Y0, z + 1.5), px.P(x + w - 0.06, Y0, z + 1.5), px.P(x + w - 0.06, Y0, z + h - 1.5), px.P(x + 0.06, Y0, z + h - 1.5)], (sx, sy) => {
    const [wx, wz] = map(sx, sy)
    const u = (wx - x) * TW2
    const v = z + h - wz
    if (!ink) return E(scr)
    if (st === 'waiting') return E(Math.abs(v - 4.5) < 2.2 && u > 3 && u < w * TW2 - 3 ? (u < 6 ? ink : hx('#fff6e6')) : scr)
    const line = Math.floor(v + (st === 'working' ? frame : 0)) % 3 === 0
    const len = 3 + (hash('l' + Math.floor((v + (st === 'working' ? frame : 0)) / 3) + (a?.name || '')) % Math.max(2, Math.floor(w * TW2 - 5)))
    return E(line && u > 2 && u < len ? ink : scr)
  })
  if (night && st !== 'off') px.line(px.P(x, Y0, z + h), px.P(x + w, Y0, z + h), E(mulc(scr, 0.6)))
}

export function drawChairSeat(px, x, y) {
  box(px, x - 0.04, y - 0.04, 0, 0.08, 0.08, SEAT_Z - 2, shadeFor(PAL.chairBase))
  box(px, x - 0.28, y - 0.28, SEAT_Z - 2, 0.56, 0.56, 2, { t: PAL.seat, l: PAL.seatD, r: mulc(PAL.seatD, 0.85) })
}

/**
 * `hue`: the chair wears its island's colour, with a lit top edge. Backs of the same dark grey as the screens and
 * most heads of hair make an agent seen from behind a dark slab. Without a hue: the first chair (your desk, the first art direction's look).
 */
export function drawChairBack(px, x, y, side, hue = null) {
  const yb = side < 0 ? y - 0.34 : y + 0.26
  if (hue == null) { box(px, x - 0.27, yb, SEAT_Z, 0.54, 0.08, 13, { t: mulc(PAL.seat, 1.1), l: PAL.seat, r: PAL.seatD }); return }
  box(px, x - 0.27, yb, SEAT_Z, 0.54, 0.08, 13, { t: hslc(hue, 36, 62), l: hslc(hue, 38, 46), r: hslc(hue, 38, 36), hi: hslc(hue, 40, 72) })
}

/** A wisp of steam over something hot at (x, y, z): three puffs that climb and drift over 4 frames, mixed in (never opaque). */
export function steam(px, x, y, z, frame) {
  const [sx, sy] = px.P(x, y, z).map(Math.round)
  const f = ((frame % 4) + 4) % 4
  const c = [255, 255, 255]
  const puff = (x, y, a) => { px.mix(x, y, c, a); px.mix(x, y - 1, c, a) }
  puff(sx + (f & 1), sy - 1 - f, 0.55)
  puff(sx + 1 - (f & 1), sy - 4 - f, 0.38)
  puff(sx + (f >> 1), sy - 7 - f, 0.2)
}

/** The light a lit screen throws at night, on the desk before it (tile rectangle) : a tint over what is drawn there. */
export function screenGlow(px, x0, y0, x1, y1, z, c, a) {
  px.poly([px.P(x0, y0, z), px.P(x1, y0, z), px.P(x1, y1, z), px.P(x0, y1, z)], (sx, sy) => { px.mix(Math.floor(sx), Math.floor(sy), c, a); return null })
}
/** The colour of the light a screen gives, by its agent's state (null: a dark screen). The same tones as the pools of base.js. */
export const screenLight = st => (st === 'working' ? [120, 190, 255] : st === 'active' ? [120, 160, 215] : st === 'waiting' ? [255, 190, 100] : null)

/** A meeting table for the empty front of the common room: a wooden top on a foot, two stools, a laptop and a few sheets. */
export function meetingTable(px, x, y) {
  const wood = { t: PAL.woodT, l: PAL.wood, r: PAL.woodD, hi: mulc(PAL.woodT, 1.15) }
  const stool = (sx, sy) => { box(px, sx - 0.04, sy - 0.04, 0, 0.08, 0.08, 7, shadeFor(PAL.chairBase)); box(px, sx - 0.18, sy - 0.18, 7, 0.36, 0.36, 2, { t: PAL.cushion, l: mulc(PAL.cushion, 0.84), r: mulc(PAL.cushion, 0.7) }) }
  stool(x - 0.45, y - 0.88); stool(x + 0.45, y - 0.88)
  box(px, x - 0.1, y - 0.1, 0, 0.2, 0.2, 13, shadeFor(PAL.leg))
  box(px, x - 0.9, y - 0.5, 13, 1.8, 1.0, 2, wood)
  box(px, x - 0.55, y - 0.25, 15, 0.34, 0.26, 0, shadeFor(hx('#f4f1ea')))
  box(px, x - 0.48, y - 0.18, 15, 0.34, 0.26, 0, shadeFor(hx('#e6e1d6')))
  box(px, x + 0.2, y - 0.2, 15, 0.42, 0.3, 1, shadeFor(hx('#aab3bd')))
  box(px, x + 0.2, y - 0.22, 16, 0.42, 0.04, 7, { t: hx('#3a3f48'), l: hx('#8fd0ff'), r: hx('#2b2f36') })
  stool(x - 0.45, y + 0.88); stool(x + 0.45, y + 0.88)
}

/** Keyboard, mug, diploma (a skill modified in the last 7 days, hidden in sober mode) and the bot's own skill objects. */
export function deskProps(px, x, y, a, row, sober, hot = null, noCup = false) {
  box(px, x - 0.28, y, DESK_Z, 0.56, 0.2, 1, { t: PAL.kbdT, l: PAL.kbd, r: PAL.kbd })
  const L0 = a ? lookOf(a.name) : null
  const L = L0 && noCup ? { ...L0, mug: 3 } : L0   // the cup's place stays empty (no cup, no steam, no sheet) beside a pile of folders (pile.js cupOff)
  const mx = row ? x + 0.36 : x - 0.52
  if (L && L.mug < 2) box(px, mx, y + 0.02, DESK_Z, 0.14, 0.14, 4, shadeFor(L.mug ? hx('#f2efe9') : hx('#e76f51')))
  if (L && L.mug < 2 && hot != null && a.state === 'working') steam(px, mx + 0.07, y + 0.09, DESK_Z + 4, hot + hash(a.name))   // who works has a hot cup
  if (L && L.mug === 2) box(px, mx - 0.05, y - 0.05, DESK_Z, 0.3, 0.22, 2, shadeFor(hx('#f4f1ea')))
  if (a && !sober && a.recentSkill) diploma(px, row ? x - 0.5 : x + 0.38, y + 0.02)
  skillProps(px, x, y, a, row)
}

export function plant(px, x, y, big, o = {}) {
  box(px, x - 0.18, y - 0.18, 0, 0.36, 0.36, big ? 9 : 7, { t: PAL.potD, l: PAL.pot, r: PAL.potD })
  const [cx, cy] = px.P(x, y, big ? 9 : 7)
  const l = new Lay()
  const H = o.H ?? (big ? 26 : 14)
  const n = o.n ?? (big ? 9 : 5)
  const leaves = o.wilt ? ['#8a7a3a', '#6f5f2c', '#a08c48'].map(hx) : PAL.leaf
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (rnd('p', x, y, i) - 0.5) * 2.4
    const r = 3 + rnd('q', x, i) * Math.max(1, H - 6)
    l.ell(Math.round(Math.cos(ang) * r * 0.6), Math.round(Math.sin(ang) * r + (o.wilt ? 2 : 0)), 2.6, o.wilt ? 3 : 4, leaves[i % 3])
  }
  l.shade((x2, y2, c) => (((x2 + y2) & 3) === 0 ? mulc(c, 1.15) : null))
  const s = new Spr()
  s.add(l, o.wilt ? hx('#4a3e1c') : hx('#1f4d2c'))
  if (o.flowers) {
    for (let i = 0; i < 5; i++) {
      s.add(new Lay().rect(Math.round((rnd('f', i) - 0.5) * 10), -Math.round(6 + rnd('g', i) * (H - 8)), Math.round((rnd('f', i) - 0.5) * 10) + 1, -Math.round(6 + rnd('g', i) * (H - 8)) + 1, hx(['#ff7aa8', '#ffd75e', '#ff9d5c'][i % 3])), false)
    }
  }
  s.blit(px, Math.round(cx), Math.round(cy - 2))
}

/** State halo on the floor (RTS-style): blue = working (pulses), amber = waiting on you (pulses), green = active, grey = silent. */
export const HALO = { working: [77, 140, 255], waiting: [242, 165, 22], active: [47, 174, 107], stale: [150, 156, 170] }

export function halo(px, x, y, state, frame) {
  const c = HALO[state]
  if (!c) return
  const beat = state !== 'active' && frame % 4 < 2
  const r2 = 0.5 + (beat ? 0.05 : 0)
  const r1 = r2 - 0.11
  const [cx, cy] = px.P(x, y)
  const rx = Math.ceil(r2 * 23) + 1
  const ry = Math.ceil(r2 * 12) + 1
  for (let py = Math.floor(cy - ry); py <= cy + ry; py++) {
    for (let qx = Math.floor(cx - rx); qx <= cx + rx; qx++) {
      const a = (qx + 0.5 - px.ox) / TW2
      const b = (py + 0.5 - px.oy) / TH2
      const u = (a + b) / 2 - x
      const v = (b - a) / 2 - y
      const d = Math.hypot(u, v)
      if (d <= r2) px.mix(qx, py, c, d >= r1 ? 0.9 : (beat ? 0.3 : 0.2))
    }
  }
}
