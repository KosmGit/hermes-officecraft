/* Hermes infrastructure drawn in the room. Each object is a backend fact:
   breaker box = gateway state, pigeon-holes = messaging platforms, cork board = cron jobs, your desk = decisions waiting on you.
   `ops` is office.ops: { gateway: { state, platforms }, crons: [{ key, enabled, failing }] } or null (roster-only mode). */
import { E, hx, mulc } from './color.js'
import { DESK_Z } from './constants.js'
import { drawChairBack, drawChairSeat, drawMonitor, plant } from './furniture.js'
import { gatewayDegraded, gatewayDown, gatewayKnown, gatewayStateOf } from './model.js'
import { PAL } from './palette.js'
import { box, sprite } from './raster.js'

/** The room goes dark; the emergency light and the exit sign stay on. */
export function powerCut(px, frame, Y) {
  for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) px.dim(x, y, 0.38)
  const blink = frame % 6 < 3
  for (const [cx, cy] of [[px.w * 0.25, 40], [px.w * 0.7, 40]]) {
    for (let y = -14; y <= 14; y++) {
      for (let x = -40; x <= 40; x++) {
        const q = 1 - (x * x) / 1600 - (y * y) / 196
        if (q > 0) px.mix(Math.round(cx + x), Math.round(cy + y + 30), [255, 244, 210], q * 0.18)
      }
    }
  }
  sprite(px, 0.05, Y - 1.6, 50, l => {
    l.rect(-6, -4, 6, 0, E(hx(blink ? '#2fd27a' : '#1fa35c')))
    l.rect(-4, -3, -3, -1, E(hx('#ffffff'))).rect(-1, -3, 4, -3, E(hx('#ffffff'))).rect(2, -2, 3, -1, E(hx('#ffffff')))
  }, hx('#0b3b22'))
}

/** Breaker box on the left wall: its LED is the gateway state. */
export function powerPanel(px, x, y, frame, ops) {
  box(px, 0.02, y, 4, 0.06, 0.5, 15, { t: hx('#c9ced6'), l: hx('#aab1bb'), r: hx('#8e96a1'), hi: hx('#e8ebef') })
  const down = gatewayDown(ops)
  const [lx, ly] = px.P(0.08, y + 0.25, 15)
  const c = !gatewayKnown(ops) || gatewayStateOf(ops) === 'starting'
    ? hx('#8a8f99')
    : down ? (frame % 4 < 2 ? hx('#ff4b3e') : hx('#8a1d17')) : gatewayDegraded(ops) ? hx('#f2a516') : hx('#36d27c')
  for (let i = -1; i <= 1; i++) px.put(Math.round(lx) + i, Math.round(ly), E(c), true)
  for (let k = 0; k < 3; k++) {
    const [bx, by] = px.P(0.08, y + 0.1 + k * 0.14, 9)
    px.put(Math.round(bx), Math.round(by), hx('#3a3f48'))
    px.put(Math.round(bx), Math.round(by) - 1, hx('#3a3f48'))
  }
}

const PLATFORM_COLOR = { connected: '#36d27c', connecting: '#f2a516', retrying: '#f2a516' }

/** Pigeon-holes on the back wall, one lit slot per messaging platform. */
export function mailRoom(px, x, ops) {
  const plats = ops?.gateway?.platforms || []
  box(px, x, 0.02, 24, 0.9, 0.2, 12, { t: PAL.woodT, l: PAL.wood, r: PAL.woodD, hi: mulc(PAL.woodT, 1.12) })
  for (let i = 0; i < 8; i++) {   // 4 x 2 pigeon-holes; the first ones belong to the platforms
    const p = plats[i]
    const [sx, sy] = px.P(x + 0.08 + (i % 4) * 0.21, 0.22, 33 - Math.floor(i / 4) * 5)
    for (let t = 0; t < 4; t++) for (let u = 0; u < 4; u++) px.put(Math.round(sx) + u, Math.round(sy) - t + Math.floor(u / 2), hx('#4a3220'))
    if (p) {
      const on = gatewayDown(ops) ? '#8a8f99' : (PLATFORM_COLOR[p.state] || '#ff4b3e')
      px.put(Math.round(sx) + 1, Math.round(sy) - 1, hx('#f4f1ea'))
      px.put(Math.round(sx) + 2, Math.round(sy) - 1, hx('#f4f1ea'))
      px.put(Math.round(sx) + 3, Math.round(sy) - 3, E(hx(on)), true)
    }
  }
}

/** Cork board: one pin per active cron, a red pin per failing one, a yellow post-it for the first three failures. */
export function shiftBoard(px, x, night, ops) {
  box(px, x, 0.02, 24, 1.5, 0.06, 22, { t: hx('#a87f4c'), l: hx('#c49a63'), r: hx('#8c6a3e') })
  const crons = ops?.crons || []
  const act = crons.filter(c => c.enabled)
  const bad = new Set(crons.filter(c => c.failing).map(c => c.key))
  act.slice(0, 12).forEach((c, i) => {
    const [sx, sy] = px.P(x + 0.15 + (i % 6) * 0.22, 0.08, 40 - Math.floor(i / 6) * 8)
    const col = bad.has(c.key) ? hx('#ff5a4a') : night ? E(hx('#ffe08a')) : hx('#f4f1ea')
    for (let u = 0; u < 3; u++) for (let t = 0; t < 3; t++) px.put(Math.round(sx) + u, Math.round(sy) - t, col, !!col.e)
  })
  ;[...bad].slice(0, 3).forEach((n, i) => {
    const [sx, sy] = px.P(x + 1.0 + i * 0.16, 0.08, 30)
    for (let u = 0; u < 4; u++) for (let t = 0; t < 4; t++) px.put(Math.round(sx) + u, Math.round(sy) - t, hx('#ffd75e'))
  })
}

/** Your desk: the decisions waiting on you pile up here (empty chair: you are not simulated). */
export function yourDesk(px, layout, pending) {
  const { x, y } = layout.you
  for (const [lx, ly] of [[x - 0.55, y - 0.3], [x + 0.47, y - 0.3], [x - 0.55, y + 0.22], [x + 0.47, y + 0.22]]) box(px, lx, ly, 0, 0.08, 0.08, DESK_Z - 2, { t: PAL.leg, l: mulc(PAL.leg, 0.86), r: mulc(PAL.leg, 0.72) })
  box(px, x - 0.6, y - 0.35, DESK_Z - 2, 1.2, 0.65, 2, { t: hx('#e9d7b9'), l: hx('#c9b393'), r: hx('#ae9878'), hi: hx('#ffffff') })
  // the screen faces your chair (in front of the desk, +y). Off: you are not simulated.
  drawMonitor(px, x - 0.15, y - 0.25, 0.6, true)
  const n = Math.min(10, pending)
  for (let i = 0; i < n; i++) box(px, x - 0.5 + (i % 2) * 0.03, y - 0.08, DESK_Z + i * 2, 0.36, 0.28, 2, { t: hx('#fbf8f1'), l: hx('#d8d2c6'), r: hx('#c4bdb0'), hi: hx('#ffffff') })
  if (n) sprite(px, x - 0.32, y + 0.06, DESK_Z + n * 2 + 1, l => l.rect(0, -6, 0, 0, hx('#3a3f48')).rect(1, -6, 3, -4, hx('#ff5a4a')))
  if (!n) plant(px, x - 0.35, y + 0.05, false, { n: 3, H: 8 })
  drawChairSeat(px, x, y + 0.75)
  drawChairBack(px, x, y + 0.75, 1)
}

/** Decisions waiting on you: blocked cards across the boards. */
export const pendingDecisions = model => (model.boards || []).reduce((n, b) => n + (b.blocked?.length || 0), 0)
