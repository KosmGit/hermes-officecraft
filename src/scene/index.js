/* Public API of the scene engine (consumed by the page).
   Pure ES modules: no DOM, no SDK, no React, no clock. Same model in, same pixels out. */
import { whiteboard } from './base.js'
import { posterSlots } from './art.js'
import { TW2, projectAt } from './constants.js'

export { toSceneModel, needsAnimation, DECOR_OFF } from './model.js'
export { layoutScene, project, anchors, boardAnchors } from './layout.js'
export { BOT_HUES, PROJECT_HUES, botColors, dimOf, hueOfSlug, nextProjectColor, projectColor, projectColors, projectRanks } from './projects.js'
export { DOT, decorMap, labelOf, labelRank, onCharacters, overlappingPairs, placeLabels, spriteBoxes } from './labels.js'
export { WASH_ALPHA, podArea } from './draw.js'
export { buildBase } from './base.js'
export { drawScene } from './draw.js'
export { FACE_SIZE, face, portrait } from './portrait.js'
export { STATE_ICONS, STATE_ICON_SIZE, stateIconCells } from './stateicons.js'
export { backingOf, fitScale, LIST_BELOW, upscale } from './fit.js'
export { bleedOf, buildBackdrop } from './backdrop.js'
export { ICON_ART, icon } from './icons.js'
export { MEDAL_SIZE, familyColor, medalArt, medalColors, pipsOf } from './medalart.js'
export { ALL_ROLE_IDS, ROLES, ROLE_IDS, detectRole, roleOf, roleLabel, outfitOf, wireRole } from './wardrobe.js'
export { KITS, kitOf, kitsOf, kitLabel } from './kits.js'
export { agentSprite } from './agent.js'
export { MOTIFS, POSTERS_MAX, normalizePosters, posterSlots } from './art.js'
export { RELAYS_MAX, neighboursOf, normalizeSeating, relayWeights, seatOrder } from './seating.js'
export { FLOORS, STYLE_BASE, STYLE_COLORS, VIEWS, drawnColors, hexOf, normalizeStyle, setStyle } from './style.js'

/** Smallest hover / focus target, in art pixels (a plaque is a few pixels wide). */
const MIN_SPOT = 14

/**
 * The scene objects that cite a source, as hover / focus zones in ART pixels (the page scales them by the view scale):
 *   [{ id, kind, rect: { x, y, w, h }, factKey, board? }]
 * `kind`: board (whiteboard) | gateway (breaker box) | mail (pigeon-holes) | crons (night-shift board) | clock | desk (your desk: the
 * decisions waiting) | poster. `factKey` is the i18n key the page builds the tooltip from (src/core/tips.js).
 * Geometry mirrors where draw.js / base.js / infra.js put each object. Pure: same layout -> same zones, in a stable order.
 */
export function hotspots(layout, model) {   // eslint-disable-line no-unused-vars
  const { ox, oy } = layout.origin
  const P = (x, y, z) => projectAt(ox, oy, x, y, z)
  const fit = (x0, y0, x1, y1) => {
    const w = Math.max(MIN_SPOT, Math.ceil(x1 - x0))
    const h = Math.max(MIN_SPOT, Math.ceil(y1 - y0))
    return { x: Math.round((x0 + x1) / 2 - w / 2), y: Math.round((y0 + y1) / 2 - h / 2), w, h }
  }
  /** Bounding rectangle of a box (x, y, z = its low corner, w/d/h = its size in tiles / pixels). */
  const boxRect = (x, y, z, w, d, h) => {
    const pts = []
    for (const dx of [0, w]) for (const dy of [0, d]) for (const dz of [0, h]) pts.push(P(x + dx, y + dy, z + dz))
    return fit(Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1])))
  }
  /** A flat thing on the back wall (plane y = 0): s along the wall, z the height. */
  const wallRect = (s0, s1, z0, z1) => fit(ox + s0, oy + s0 / 2 - z1, ox + s1, oy + s1 / 2 - z0)

  const out = []
  for (const p of layout.pods) {
    const wb = whiteboard(p)
    out.push({ id: `board:${p.b.slug}`, kind: 'board', rect: wallRect(wb.s0, wb.s1, wb.z0, wb.z1), factKey: 'tip.board', board: p.b.slug })
  }
  const L0 = layout.lounge.x0
  out.push({ id: 'gateway', kind: 'gateway', rect: boxRect(0.02, 2.2, 4, 0.06, 0.5, 15), factKey: 'tip.gateway' })
  out.push({ id: 'mail', kind: 'mail', rect: boxRect(L0 + 4.3, 0.02, 24, 0.9, 0.2, 12), factKey: 'tip.mail' })
  out.push({ id: 'crons', kind: 'crons', rect: boxRect(L0 + 5.35, 0.02, 24, 1.5, 0.06, 22), factKey: 'tip.crons' })
  const sc = (L0 + 1.3) * TW2
  out.push({ id: 'clock', kind: 'clock', rect: wallRect(sc - 11, sc + 11, 60 - 11, 60 + 11), factKey: 'tip.clock' })
  const { x: yx, y: yy } = layout.you
  out.push({ id: 'desk', kind: 'desk', rect: boxRect(yx - 0.6, yy - 0.35, 12, 1.2, 0.65, 18), factKey: 'tip.desk' })
  // wall art: one zone per poster hung (base.js hangs the same ones in the same slots); the tooltip says the milestone and its date
  const slots = posterSlots(layout)
  ;(model?.decor?.sober ? [] : model?.decor?.posters || []).slice(0, slots.length).forEach((p, i) => {
    out.push({ id: `poster:${p.key}`, kind: 'poster', rect: wallRect(slots[i].s0, slots[i].s1, slots[i].z0, slots[i].z1), factKey: 'llm.art.fact', poster: { kind: p.kind, tier: p.tier, board: p.board, ms: p.ms } })
  })
  return out
}
