/* Wall art, drawn by the engine: a poster per REAL milestone. The model only picks a motif of a closed
   catalogue and two colours (hermes_officecraft/llm.py MOTIFS, validate_art); the frame, the caption strip and every pixel are drawn here.
   The gilded frame and the tooltip (milestone + date) come from the data, never from the model.
   Pure: no DOM, no clock. */
import { hx, mixc } from './color.js'
import { TW2 } from './constants.js'
import { hash } from './util.js'

export const MOTIFS = Object.freeze(['summit', 'rocket', 'sunrise', 'trophy', 'lighthouse', 'bridge'])
/** The most posters the back wall carries (one per slot below, newest first). */
export const POSTERS_MAX = 4
export const POSTER_W = 18   // art pixels along the wall
export const POSTER_Z0 = 47
export const POSTER_Z1 = 71

const HEX = /^#[0-9a-f]{6}$/
const isHex = v => typeof v === 'string' && HEX.test(v)

/**
 * The posters to hang, made safe: only entries with a known motif and two `#rrggbb` colours, no repeated key, at most POSTERS_MAX.
 * An entry is { key, kind, tier, board, ms, motif, sky, accent }; `ms` (the milestone's real date) is required: no date, no milestone,
 * no poster. Anything else is ignored, one entry at a time. Not an array -> []. Pure.
 */
export function normalizePosters(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    if (typeof p.key !== 'string' || !p.key || seen.has(p.key)) continue
    if (!MOTIFS.includes(p.motif) || !isHex(p.sky) || !isHex(p.accent)) continue
    if (!Number.isFinite(p.ms)) continue
    seen.add(p.key)
    out.push(Object.freeze({
      key: p.key, kind: String(p.kind ?? ''), tier: typeof p.tier === 'string' ? p.tier : null, board: typeof p.board === 'string' ? p.board : null,
      ms: p.ms, motif: p.motif, sky: p.sky, accent: p.accent
    }))
    if (out.length >= POSTERS_MAX) break
  }
  return Object.freeze(out)
}

/**
 * Where the posters hang on the back wall (s = along the wall in art pixels, z = height): the first where the generic poster of the
 * room hangs, the others above the lounge's wall (clock, door, mail slots keep their place: nothing is hidden). Same layout -> same slots.
 */
export function posterSlots(layout) {
  const L0 = layout.lounge.x0
  return [0.1, L0 + 2.05, L0 + 4.2, L0 + 5.5].map(x => ({ s0: x * TW2, s1: x * TW2 + POSTER_W, z0: POSTER_Z0, z1: POSTER_Z1 }))
}

const GOLD = hx('#c9a24a')
const GOLD_HI = hx('#e8c872')
const GOLD_LO = hx('#8f6f26')
const INK = hx('#2b2f36')
const PAPER = hx('#f4ecd4')
const WHITE = hx('#ffffff')

/**
 * The decal shader of one poster in its slot: (s, z, decal) -> colour. Frame: gilded, with a lit and a shaded edge. Bottom strip: the
 * caption band (ticks, no letters: the words are the tooltip's). Inside: the motif, coloured by the fiche's `sky` and `accent`.
 */
export function posterShader(p) {
  const sky = hx(p.sky)
  const accent = hx(p.accent)
  const dusk = mixc(sky, hx('#1d2a55'), 0.55)
  const pale = mixc(sky, WHITE, 0.55)
  const seed = hash(p.key)
  return (s, z, d) => {
    const u = s - d.s0
    const v = z - d.z0
    const W = d.s1 - d.s0
    const Hh = d.z1 - d.z0
    if (u < 1.8 || u > W - 1.8 || v < 1.8 || v > Hh - 1.8) return u < 2.6 && v > Hh / 2 ? GOLD_HI : u > W - 2.6 || v < 2.6 ? GOLD_LO : GOLD
    const x = u / W
    const y = v / Hh
    if (y < 0.22) return Math.floor(u) % 3 === 1 && y > 0.08 && y < 0.16 ? INK : PAPER
    const iy = (y - 0.22) / 0.78   // inside the picture: 0 at the caption strip, 1 at the top
    switch (p.motif) {
      case 'summit': {
        const ridge = 0.25 + 0.5 * (1 - Math.abs(x - 0.55) * 2.2)
        if (iy < ridge) return iy > ridge - 0.1 && x > 0.4 && x < 0.7 ? WHITE : mixc(INK, sky, 0.45)
        if (Math.abs(x - 0.55) < 0.03 && iy < ridge + 0.18) return INK
        if (x > 0.55 && x < 0.68 && iy > ridge + 0.1 && iy < ridge + 0.18) return accent
        return mixc(pale, sky, iy)
      }
      case 'rocket': {
        const cx = Math.abs(x - 0.5)
        if (cx < 0.12 && iy > 0.2 && iy < 0.72) return iy < 0.3 ? accent : Math.abs(iy - 0.5) < 0.05 ? pale : WHITE
        if (cx < 0.08 && iy >= 0.1 && iy <= 0.2) return Math.floor(v) % 2 ? hx('#ffb347') : accent
        return hash('st' + seed + ':' + Math.floor(u) + ':' + Math.floor(v)) % 23 === 0 ? WHITE : dusk
      }
      case 'sunrise': {
        const sun = Math.hypot((x - 0.5) * 1.3, iy - 0.4)
        if (iy < 0.4) return Math.floor(v) % 3 === 0 ? mixc(sky, INK, 0.25) : mixc(sky, INK, 0.1)
        if (sun < 0.2) return accent
        return mixc(accent, pale, iy)
      }
      case 'trophy': {
        const cx = Math.abs(x - 0.5)
        const cup = iy > 0.42 && iy < 0.78 && cx < 0.26 - (0.78 - iy) * 0.45
        if (cup) return cx < 0.04 && iy > 0.55 ? WHITE : accent
        if (iy > 0.2 && iy <= 0.42 && cx < 0.05) return accent
        if (iy > 0.12 && iy <= 0.2 && cx < 0.22) return mixc(accent, INK, 0.35)
        return mixc(sky, pale, iy)
      }
      case 'lighthouse': {
        const cx = Math.abs(x - 0.5)
        const tower = iy < 0.62 && cx < 0.07 + (0.62 - iy) * 0.12
        if (tower) return Math.floor(iy * 10) % 2 ? WHITE : accent
        if (iy >= 0.62 && iy < 0.7 && cx < 0.11) return INK
        if (iy >= 0.7 && iy < 0.76 && cx < 0.05) return hx('#ffe08a')
        if (iy < 0.3) return Math.floor(v) % 3 === 0 ? mixc(sky, INK, 0.3) : mixc(sky, INK, 0.15)
        return hash('lh' + seed + ':' + Math.floor(u) + ':' + Math.floor(v)) % 19 === 0 ? WHITE : mixc(sky, dusk, iy)
      }
      default: {   // bridge
        const deck = iy > 0.28 && iy < 0.34
        if (deck) return accent
        const cable = iy > 0.34 && iy < 0.34 + 0.4 * Math.abs(Math.sin((x - 0.5) * 2.4)) && Math.floor(u) % 3 === 0
        if (cable) return mixc(accent, INK, 0.3)
        if (iy < 0.28) return Math.floor(v) % 3 === 0 ? mixc(INK, sky, 0.5) : mixc(INK, sky, 0.62)
        return mixc(pale, sky, iy)
      }
    }
  }
}
