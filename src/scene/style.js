/* The decorator's fiche, drawn by the engine: the model only ever returns a closed JSON object (colours, a floor,
   a view); this module turns it into pixels. It draws nothing the fiche does not say and ignores any value it does not know.
   The scene reads its colours from PAL (src/scene/palette.js). A style overrides the PAL entries it owns, in place, and
   `setStyle(null)` puts every one back: buildBase() and drawScene() both call setStyle(model.decor.style) first, so the same
   model always gives the same pixels whatever was drawn before (a postcard, another model). */
import { hx, mixc, mulc } from './color.js'
import { outdoorView } from './outdoor.js'
import { PAL } from './palette.js'
import { hash } from './util.js'

export const FLOORS = Object.freeze(['planks', 'concrete'])
export const VIEWS = Object.freeze(['city', 'sea', 'forest'])
/** The colour keys of a fiche, in the order the agent half validates them (hermes_officecraft/llm.py DECOR_KEYS). */
export const STYLE_COLORS = Object.freeze(['left', 'back', 'wainscot', 'seam', 'sofa', 'cushion', 'cabinets', 'desk'])

/** The default look of the office, as a fiche. Not what is drawn without a style: see DEFAULT_PAL. */
export const STYLE_BASE = Object.freeze({
  left: '#f0e8da', back: '#e3d8c6', wainscot: '#a3bba7', floor: 'planks', planks: Object.freeze(['#c99863', '#c18f5d', '#d0a06b', '#ba8656']),
  seam: '#94643d', view: 'city', sofa: '#5d7fa6', cushion: '#e9c46a', cabinets: '#7f9db4', desk: '#f4f2ed'
})

const HEX = /^#[0-9a-f]{6}$/
const isHex = v => typeof v === 'string' && HEX.test(v)

/**
 * A fiche, made safe: a complete style where every key that is valid is taken and every other key keeps its default. An unknown
 * enumeration value (a floor or a view the engine does not draw), a colour that is not `#rrggbb`, a `planks` that is not four such
 * colours and a key nobody knows are ignored, one by one. Not an object -> null (no style). Pure.
 */
export function normalizeStyle(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = { ...STYLE_BASE }
  for (const k of STYLE_COLORS) if (isHex(raw[k])) out[k] = raw[k]
  if (FLOORS.includes(raw.floor)) out.floor = raw.floor
  if (VIEWS.includes(raw.view)) out.view = raw.view
  if (Array.isArray(raw.planks) && raw.planks.length === 4 && raw.planks.every(isHex)) out.planks = Object.freeze([...raw.planks])
  return Object.freeze(out)
}

/*
 * The art direction holds whatever the fiche says. A model may answer « cyberpunk neon » with #ff00ff walls and a #00ffff
 * floor, or « all black » with a black room: drawn as is, the office stops being a lit human office (desks melt into the floor, the room
 * melts into the night around it). Each surface has a lightness range and a most vivid colour (HSL lightness, chroma, 0..1) that the
 * house palette keeps; a colour outside them is mixed with the house colour of that surface (STYLE_BASE) only as far as it stays inside
 * them. A colour already inside is drawn exactly; the drawn colour always moves from the house colour toward the fiche's, never away.
 * Then the back wall stays a step darker than the lit left wall (the room's light comes from the glazing on the left).
 */
const DA = Object.freeze({
  left: [0.4, 0.96, 0.38], back: [0.34, 0.96, 0.38], wainscot: [0.22, 0.82, 0.36], plank: [0.26, 0.82, 0.42], seam: [0.12, 0.7, 0.36],
  sofa: [0.22, 0.78, 0.55], cushion: [0.3, 0.85, 0.62], cabinets: [0.22, 0.85, 0.4], desk: [0.62, 0.97, 0.28]
})
const BACK_STEP = 0.03
const lightOf = c => (Math.max(c[0], c[1], c[2]) + Math.min(c[0], c[1], c[2])) / 510
const chromaOf = c => (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255
const fits = (c, [lo, hi, cmax]) => { const l = lightOf(c); return l >= lo - 1e-9 && l <= hi + 1e-9 && chromaOf(c) <= cmax + 1e-9 }
const tamed = new Map()
/** How many drawn colours the table holds now (tests). */
export const tamedSize = () => tamed.size
const TAMED_MAX = 1024   // the house palette is a few dozen; a fiche chooses its colours freely, so the table must not grow with them
/** The colour drawn for `hex` on a surface (`rule` = DA key), anchored on the house colour `anchor`. Memoised (called every frame). */
export function tame(hex, anchor, rule) {
  const key = `${rule}:${hex}:${anchor}`
  let c = tamed.get(key)
  if (c) return c
  const want = hx(hex)
  const bounds = DA[rule]
  if (!bounds || fits(want, bounds)) c = want
  else {
    const from = hx(anchor)
    let w = 0
    for (let k = 1; k <= 64; k++) { if (!fits(mixc(from, want, k / 64), bounds)) break; w = k / 64 }
    c = Object.freeze(mixc(from, want, w).map(Math.round))
  }
  if (tamed.size >= TAMED_MAX) tamed.clear()
  tamed.set(key, c)
  return c
}
/** The colours the engine draws for a style (normalizeStyle() result), as [r, g, b]: what the room shows, what the decorator's swatches show. */
export function drawnColors(s) {
  const left = tame(s.left, STYLE_BASE.left, 'left')
  let back = tame(s.back, STYLE_BASE.back, 'back')
  const top = lightOf(left) - BACK_STEP
  if (lightOf(back) > top) back = mulc(back, top / lightOf(back)).map(Math.round)
  return {
    left, back,
    wainscot: tame(s.wainscot, STYLE_BASE.wainscot, 'wainscot'),
    planks: s.planks.map((p, i) => tame(p, STYLE_BASE.planks[i], 'plank')),
    seam: tame(s.seam, STYLE_BASE.seam, 'seam'),
    sofa: tame(s.sofa, STYLE_BASE.sofa, 'sofa'),
    cushion: tame(s.cushion, STYLE_BASE.cushion, 'cushion'),
    cabinets: tame(s.cabinets, STYLE_BASE.cabinets, 'cabinets'),
    desk: tame(s.desk, STYLE_BASE.desk, 'desk')
  }
}
/** [r, g, b] -> '#rrggbb' (for the swatches). */
export const hexOf = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

/* what PAL holds with no style: kept as it was at load (the default wainscot shade of the back wall is not 0.9 x the left one) */
const OWNED = ['wallL', 'wallB', 'wainL', 'wainB', 'seam', 'sofa', 'sofaD', 'sofaT', 'cushion', 'cab', 'cabD', 'deskT', 'deskL', 'deskR']
const DEFAULT_PAL = Object.freeze({ ...Object.fromEntries(OWNED.map(k => [k, PAL[k]])), plank: Object.freeze([...PAL.plank]) })

/**
 * Make PAL say what `style` (a normalizeStyle() result, or null = the default office) says. Applied in full on every call (a dozen
 * assignments, colours memoised): no « what is applied now » is remembered here, so the engine stays a function of its model.
 */
export function setStyle(style) {
  const s = style || null
  if (!s) {
    for (const k of OWNED) PAL[k] = DEFAULT_PAL[k]
    PAL.plank = [...DEFAULT_PAL.plank]
    return
  }
  const d = drawnColors(s)   // inside the art direction's bounds
  PAL.wallL = d.left
  PAL.wallB = d.back
  PAL.wainL = d.wainscot
  PAL.wainB = mulc(d.wainscot, 0.9)
  PAL.plank = d.planks
  PAL.seam = d.seam
  PAL.sofa = d.sofa
  PAL.sofaD = mulc(d.sofa, 0.82)
  PAL.sofaT = mixc(d.sofa, [255, 255, 255], 0.14)
  PAL.cushion = d.cushion
  PAL.cab = d.cabinets
  PAL.cabD = mulc(d.cabinets, 0.84)
  PAL.deskT = d.desk
  PAL.deskL = mulc(d.desk, 0.89)
  PAL.deskR = mulc(d.desk, 0.78)
}

/** What the style draws for the floor: 'concrete' or 'planks' (the base shader keeps planks). */
export const floorOf = style => (style && style.floor === 'concrete' ? 'concrete' : 'planks')
/** The glazing's view: the fiche's (a fiche without one keeps STYLE_BASE's 'city'); no fiche -> 'park', the park alone. */
export const viewOf = style => (style && VIEWS.includes(style.view) ? style.view : style ? 'city' : 'park')

/** Concrete: large polished slabs (1.5 tiles), seams between them, a faint grain. (u, v) = floor coordinates in tiles. Needs setStyle() done. */
export function floorColor(u, v) {
  const tu = Math.floor(u / 1.5)
  const tv = Math.floor(v / 1.5)
  if (u / 1.5 - tu < 0.02 || v / 1.5 - tv < 0.02) return PAL.seam
  const n = (hash('cc' + Math.floor(u * 6) + ':' + Math.floor(v * 6)) % 100) / 100
  return mulc(PAL.plank[(tu + tv) & 3], 0.96 + n * 0.08)
}

/**
 * What the glazing shows for a view, at (s, v) of a pane of height `Hd` (`s` along the wall, `v` the height inside the pane).
 * Every view looks out on the park drawn around the building (src/scene/outdoor.js); 'city', 'sea' and 'forest' only change the far
 * distance beyond it, 'park' (no fiche) has none. An unknown view -> null (viewOf() never returns one).
 */
export function viewColor(view, s, v, Hd, night) {
  if (view !== 'park' && !VIEWS.includes(view)) return null
  return outdoorView(view, s, v, Hd, night)
}
