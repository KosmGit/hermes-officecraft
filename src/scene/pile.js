/* The pile of folders on the desk of a bot that runs several cards at once — one folder per card beyond the
   first, PILE_MAX at most (the exact number stays on the label, `CODE +N`). A state, not an event: nothing in it moves, and it never
   makes the scene animate. Drawn only outside `classic`, and only on a FRONT-ROW desk (the bot seen from behind): on a back-row desk (the
   bot facing the camera) the only strip of desk the camera sees lies before the bot, and any pile there covers its torso, its state outline
   or the legs of a standing bot — there the label and the tooltip carry the fact alone. A silent card is not drawn either
   (a grey folder reads as the grey outline of a stale bot): the sign on the label carries it. */
import { runningCards } from '../core/cards.js'
import { NAMED_MAX, codeRef, formatSpan } from '../core/hud.js'
import { DESK_Z } from './constants.js'
import { hx } from './color.js'
import { PAL } from './palette.js'
import { Px, box } from './raster.js'

export const PILE_MAX = 3
/** Running cards the scene model keeps per agent (enough to tell 1, 2, 3 and « 3 or more » folders; the exact number stays on the label). */
export const CARDS_MAX = PILE_MAX + 1
/** States whose desk shows the pile: the bot is at its desk on its cards. At rest, new (a jacket on a chair), offline: no pile. */
const AT_WORK = new Set(['working', 'waiting', 'stale', 'active'])

/** How many folders an agent's desk carries (0 = no pile): one per running card beyond the first, PILE_MAX at most. */
export function pileOf(a) {
  if (!a || !AT_WORK.has(a.state)) return 0
  const n = Number.isFinite(a.cards) ? a.cards : 0
  return Math.max(0, Math.min(PILE_MAX, n - 1))
}

/**
 * The source of the pile on hover: « 3 cards running: T-12 50 min, T-15 3 min » (`tipCards`, the main card first) for EVERY
 * agent of buildOffice that runs two cards or more, whatever its state and whether its desk shows the pile (back row, at rest) or not.
 * '' for one card or none. `t` = the page's translator (useT); the scene label's tooltip uses it when the label's tag does not list the cards.
 */
export function pileTip(a, nowMs, t) {
  const cards = runningCards(a, nowMs)
  if (cards.length < 2) return ''
  const span = c => (c.startedMs && nowMs > c.startedMs ? formatSpan(nowMs - c.startedMs) : '')
  const list = cards.slice(0, NAMED_MAX).map(c => [codeRef(c.title) || String(c.id || ''), span(c)].filter(Boolean).join(' ')).join(', ')
  return t('tipCards', cards.length, list, cards.length > NAMED_MAX ? `+${cards.length - NAMED_MAX}` : '')
}

/** Seat rows that carry a pile: 1 = front row (the bot from behind). The back row (row 0, the bot facing us) never does. */
export const pileRow = row => row === 1

// a folder: a violet cover (no state colour: not the blue / amber / green / grey of a halo) over a white sheet that sticks out. The edges of
// the sheet are the grey of paper in the shade, not the cream of the desk top: with cream edges the desk seems to show between two covers
// and three folders read as loose violet dashes.
const COVER = { t: hx('#9b6ad8'), l: hx('#7c50b8'), r: hx('#613e94') }
const SHEET = { t: hx('#ffffff'), l: hx('#bfbab0'), r: hx('#a39e94') }

/** Where the pile lies on a front-row desk half (tile coordinates of its low corner) and its size; x = the seat, ty = the island's y0.
 *  Between the screens and the keyboard, right of the bot: 0 px of the bot, of its outline or of its floor ring (measured).
 *  The ink ring adds 1 px all round, and the strip of desk between the bot's own head and the head of the bot on its right is
 *  narrow (their 2 px state glows leave ~9 px): at a size of 0.28 x 0.18 no spot keeps the ringed pile out of both glows
 *  (measured on 960 front desks: 40 pods x 4 states x 2 / 4 cards). A folder
 *  of 0.22 x 0.14 fits with its ring; x - 0.12 to x - 0.08 keep it out of both glows on all 960; x - 0.10. */
export function pileSpot(x, ty) {
  return { x: x - 0.1, y: ty + 0.94, w: 0.22, d: 0.14 }   // ends at ty + 1.08, before the keyboard (ty + TD - 0.36)
}

/**
 * On a front-row desk that carries a pile, the cup's place stays empty — no cup, no steam, and no sheet of paper
 * for the bots that keep one there instead (lookOf mug 2). The cup would stand before the pile and hide 3 to 5 of its pixels (one folder then
 * reads as « a violet lid on the cup »), its steam would rise across it, the sheet would lie over its corner; and there is no other place: over 30
 * offsets (0 to 0.30 tile right, -0.20 to +0.16 deep) on 120 front-row desks, every one touches the keyboard, a screen, a skill
 * object, the pile, or comes within 2 px of the bot next door, whose head stands right of the pile (measured; 80 desks of 120 at
 * best). Without a pile, nothing changes.
 */
export const cupOff = n => n > 0

/** The pile at a seat (no-op without folders or on a back-row seat). */
export function drawPile(px, x, ty, row, n) {
  if (!n || !pileRow(row)) return
  const s = pileSpot(x, ty)
  folderPile(px, s.x, s.y, s.w, s.d, Math.min(PILE_MAX, n))
}

/**
 * `n` folders, 2 px each (a sheet then its cover), squared up one on the other: the pile grows in height only. Askew, every folder
 * spreads sideways and three of them read as loose violet dashes on the desk, not as one pile one can count.
 * The whole pile is ringed with the scene's ink (PAL.outline, the 1 px outer line of every sprite, 4-neighbour):
 * in the pod whose hue is the cover's (PROJECT_HUES[3] = 268) the rug, the chairs and the partition take the violet of the folders and
 * the pile would melt into them. The ink is no state colour (blue / amber / green / grey) nor the accent.
 */
export function folderPile(px, x, y, w, d, n, z0 = DESK_Z) {
  const folders = q => {
    for (let i = 0; i < n; i++) {
      const z = z0 + i * 2
      box(q, x + 0.02, y - 0.01, z, w, d, 1, SHEET)
      box(q, x, y, z + 1, w, d, 1, COVER)
    }
  }
  // the silhouette, drawn first into a small buffer of its own (same projection), then ringed on the scene
  const pts = []
  for (const a of [x, x + w + 0.02]) for (const b of [y - 0.01, y + d]) for (const c of [z0, z0 + 2 * n]) pts.push(px.P(a, b, c))
  const bx = Math.floor(Math.min(...pts.map(p => p[0]))) - 2
  const by = Math.floor(Math.min(...pts.map(p => p[1]))) - 2
  const q = new Px(Math.ceil(Math.max(...pts.map(p => p[0]))) + 3 - bx, Math.ceil(Math.max(...pts.map(p => p[1]))) + 3 - by, px.ox - bx, px.oy - by)
  folders(q)
  const on = (i, j) => i >= 0 && j >= 0 && i < q.w && j < q.h && q.d[(j * q.w + i) * 4 + 3] > 0
  for (let j = 0; j < q.h; j++) for (let i = 0; i < q.w; i++) if (!on(i, j) && (on(i - 1, j) || on(i + 1, j) || on(i, j - 1) || on(i, j + 1))) px.put(bx + i, by + j, PAL.outline)
  folders(px)
}
