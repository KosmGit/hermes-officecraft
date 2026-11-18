/* Game-layer decor, drawn only from real achievements (hidden in sober mode by the caller):
   trophies, bell, extinguisher, moving box, night light, incident beacon, mascot, season props, diploma. */
import { E, hx, mulc } from './color.js'
import { DESK_Z } from './constants.js'
import { PAL } from './palette.js'
import { box, shadeFor, sprite } from './raster.js'
import { hash } from './util.js'

/** Metal of a tier (the shape says it too: 1 / 2 / 3 pips above the medal). A single-level achievement takes its family colour, with no pip. */
export const TIER_METAL = Object.freeze({ bronze: '#cd7f32', silver: '#c0c8d2', gold: '#f2c94c' })
export const FAMILY_METAL = Object.freeze({ chains: '#4cc9b0', boards: '#3d7bfd', reliability: '#2f9e6e', decider: '#e8863a', team: '#8b62c9', command: '#d33a2c' })

/* One 3x3 glyph per achievement, row by row ('1' = dark pixel on the medal): the 35 are all different. */
const GLYPH = {
  chain: '111101111', centurion: '101010101', zero: '010111010', quick: '110011001', review: '011110011', owl: '101111010', thrifty: '111010111', hire: '010101111', builder: '101111101', fire: '010010111',
  smooth: '110101011', architect: '111010101', teamwork: '101010111', quickstart: '011010110', wide: '111000111', versatile: '010111101', multimodel: '110110011', rescue: '011101110', iron: '111111010',
  ontime: '010110011', firstpass: '001010100', swiss: '101000101', present: '111011100', noqueue: '000111000', fullteam: '101101101', training: '011111000', firstmission: '110111100', veteran: '010101010',
  pilot: '011001111', recruiter: '110101111', guardian: '111101010',
  twin: '110011110', fastlane: '001011111', quiet: '011110010', comeback: '100010111'
}
const glyphOf = id => GLYPH[id] || (hash(id) % 512).toString(2).padStart(9, '0')

/** 3 x 5 digits for the « +N » plaque. */
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111']

/** One medal, anchored at its bottom centre: a disc in the tier's metal (or the family's), its glyph, and 0-3 pips above (the tier by shape). */
export function medal(l, m) {
  const metal = hx(m.pips ? TIER_METAL[m.tier] || TIER_METAL.bronze : FAMILY_METAL[m.family] || '#c9d1d9')
  const dark = mulc(metal, 0.55)
  // the cabinet is lit from inside: the metal is emissive, so a medal stays legible at night (the glyph stays dark)
  l.ell(0, -3, 2.7, 2.7, E(metal)).set(-1, -5, E(mulc(metal, 1.25)))
  const g = glyphOf(m.id)
  for (let i = 0; i < 9; i++) if (g[i] === '1') l.set((i % 3) - 1, -4 + Math.floor(i / 3), dark)
  for (let k = 0; k < m.pips; k++) l.set(Math.round((k - (m.pips - 1) / 2) * 2), -7, E(mulc(metal, 1.3)))
}

/** « +N » plaque: a plus sign and the number (2 digits at most), for the achievements that do not fit in the cabinet. */
export function morePlaque(l, n) {
  // the plate is tight around the digits (5 px for one, 9 for two) and starts 2 px left of the slot centre: it grows rightwards, never into the medal on its left (6 px away)
  const s = String(Math.min(99, Math.max(0, n)))
  const w = s.length * 4 - 1
  const plus = Math.floor((w - 1) / 2) - 1
  l.rect(-2, -9, w - 1, 0, hx('#2b2f36')).rect(plus, -8, plus, -6, hx('#f2efe9')).rect(plus - 1, -7, plus + 1, -7, hx('#f2efe9'))
  s.split('').forEach((d, k) => {
    for (let i = 0; i < 15; i++) if (DIGITS[Number(d)][i] === '1') l.set(-1 + k * 4 + (i % 3), -5 + Math.floor(i / 3), hx('#ffffff'))
  })
}

export const CABINET_COLS = 4
export const CABINET_SLOTS = 12
/**
 * The trophy cabinet, against the left wall (plane x = 0, facing +x), centred on `y`: three shelves of four medals, best tier first from the top shelf; beyond 12 the last slot is a « +N » plaque (the collection lists them all). `medals`: [{ id, family, tier, pips }] (core/game.js medalsOf), else plain medals. In a crowded office the back wall is hidden by the desk
 * rows, whose agents sit right in front of any cabinet there: the left wall stays in view whatever the number of boards.
 * Medals read left to right on screen, which is decreasing y on this wall.
 */
export function trophyCabinetLeft(px, y, ids, medals = null) {
  box(px, 0.02, y - 0.8, 0, 0.45, 1.6, 40, { t: PAL.woodT, l: PAL.wood, r: PAL.woodD })
  box(px, 0.45, y - 0.75, 3, 0.02, 1.5, 34, { t: E(hx('#dff2fb')), l: hx('#bfe0ee'), r: hx('#bfe0ee') })
  for (let k = 0; k < 3; k++) px.line(px.P(0.47, y - 0.75, 12 + k * 10), px.P(0.47, y + 0.75, 12 + k * 10), PAL.woodD)
  const all = medals || ids.map(id => ({ id, family: null, tier: null, pips: 0 }))
  const overflow = all.length > CABINET_SLOTS
  const shown = overflow ? all.slice(0, CABINET_SLOTS - 1) : all
  const at = i => y + 0.54 - (i % CABINET_COLS) * 0.36
  shown.forEach((m, i) => sprite(px, 0.48, at(i), 13 + (2 - Math.floor(i / CABINET_COLS)) * 10, l => medal(l, m), hx('#3a2a14')))
  if (overflow) sprite(px, 0.48, at(CABINET_COLS - 1), 13, l => morePlaque(l, all.length - (CABINET_SLOTS - 1)), hx('#3a2a14'))
}

export function bell(px, x, y, z) {
  sprite(px, x, y, z, l => l.rect(-2, -1, 2, 0, hx('#8a6a2a')).ell(0, -3, 2.6, 2.4, hx('#f2c94c'), (a, b) => b <= -2).set(0, -6, hx('#f2c94c')), hx('#4a3510'))
}

export function extinguisher(px, x, y) {
  box(px, x - 0.09, y - 0.09, 0, 0.18, 0.18, 14, { t: hx('#d33a2c'), l: hx('#c0392b'), r: hx('#962d22') })
  sprite(px, x, y, 14, l => l.rect(-1, -2, 1, 0, hx('#2b2f36')).rect(2, -3, 4, -2, hx('#2b2f36')))
}

export function movingBox(px, x, y) {
  box(px, x - 0.17, y - 0.14, 0, 0.34, 0.28, 7, { t: hx('#d8b07a'), l: hx('#c49a63'), r: hx('#a87f4c') })
  px.line(px.P(x, y - 0.14, 7), px.P(x, y + 0.14, 7), hx('#9c7444'))
}

export function nightLight(px, x, y, night) {
  box(px, x - 0.06, y - 0.06, DESK_Z, 0.12, 0.12, 2, shadeFor(hx('#3a3f48')))
  sprite(px, x, y, DESK_Z + 2, l => l.ell(0, -3, 2.4, 2.6, night ? E(hx('#ffe08a')) : hx('#f5e6b8')).set(1, -4, night ? E(hx('#fff4c8')) : hx('#ffffff')), hx('#6b5a2a'))
}

export function beacon(px, x, y, frame) {
  box(px, x - 0.08, y - 0.08, DESK_Z + 9, 0.16, 0.16, 2, shadeFor(hx('#2b2f36')))
  sprite(px, x, y, DESK_Z + 11, l => {
    l.ell(0, -2, 2.4, 2.6, E(frame % 2 ? hx('#ff3b30') : hx('#b3261e')))
    if (frame % 2) l.rect(3, -3, 6, -2, E(hx('#ff7a70'))).rect(-6, -3, -3, -2, E(hx('#ff7a70')))
  }, hx('#3a0a08'))
}

/** mood: 'hide' (only the tail sticks out) | 'sleep' | 'play' | 'alert'. */
export function mascot(px, x, y, mood, frame) {
  const fur = hx('#e8a35a')
  const furD = hx('#c98340')
  const dark = hx('#2a1d17')
  sprite(px, x, y, 0, l => {
    if (mood === 'hide') { l.rect(0, -2, 0, 0, fur).rect(1, -3, 1, -2, furD); return }
    if (mood === 'sleep') { l.ell(0, -2, 5, 2.6, fur).ell(-4, -2, 2.4, 2.2, fur).set(-5, -4, furD).set(-3, -4, furD).rect(-5, -2, -4, -2, dark).rect(2, -1, 5, -1, furD); return }
    l.ell(0, -3, 3.4, 3, fur).ell(-1, -8, 2.8, 2.5, fur).set(-3, -11, fur).set(1, -11, fur).set(-3, -10, furD).set(1, -10, furD)
    l.set(-2, -8, dark).set(0, -8, dark)
    if (mood === 'alert') l.set(-2, -9, hx('#2a6f3a')).set(0, -9, hx('#2a6f3a'))
    const t = mood === 'play' ? frame % 4 : 0
    l.rect(3, -2 - t, 3, 0, furD).set(4, -3 - t, furD)
  }, hx('#3a2412'))
  if (mood === 'sleep') {
    const t = frame % 12
    sprite(px, x, y, 0, l => l.rect(4 + (t >> 2), -8 - (t >> 1), 5 + (t >> 2), -8 - (t >> 1), E(hx('#aab6d3'))), false)
  }
  if (mood === 'alert') sprite(px, x, y, 0, l => l.rect(-1, -18, 0, -15, E(PAL.warn)).rect(-1, -13, 0, -13, E(PAL.warn)), E(hx('#3a2a10')))
}

export function pumpkin(px, x, y) {
  sprite(px, x, y, 0, l => {
    l.ell(0, -3, 4, 3, hx('#f08a24')).rect(-1, -3, -1, -1, hx('#c96a12')).rect(1, -3, 1, -1, hx('#c96a12')).rect(0, -7, 0, -6, hx('#4a7a2a'))
    l.set(-2, -4, E(hx('#ffd75e'))).set(2, -4, E(hx('#ffd75e'))).rect(-1, -2, 1, -2, E(hx('#ffd75e')))
  })
}

export function xmasTree(px, x, y, frame) {
  box(px, x - 0.12, y - 0.12, 0, 0.24, 0.24, 4, shadeFor(hx('#7a4a2a')))
  sprite(px, x, y, 4, l => {
    for (let k = 0; k < 4; k++) l.ell(0, -4 - k * 5, 7 - k * 1.5, 3.4, hx(['#2f7d45', '#3a9554', '#2f7d45', '#45a862'][k]))
    l.rect(-1, -26, 1, -24, E(hx('#ffd75e')))
    ;[[-4, -5], [3, -8], [-2, -12], [2, -16], [-3, -19]].forEach(([a, b], i) => l.set(a, b, E(hx(['#ff5a4a', '#7cc8ff', '#ffd75e'][(i + (frame >> 2)) % 3]))))
  }, hx('#173d22'))
}

/** A skill touched in the last 7 days: a small diploma on the desk. */
export function diploma(px, x, y) {
  box(px, x - 0.1, y, DESK_Z, 0.2, 0.05, 6, { t: hx('#c9a24a'), l: hx('#f4ecd4'), r: hx('#b8902f') })
}
