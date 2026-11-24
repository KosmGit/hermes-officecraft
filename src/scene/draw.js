/* Dynamic layer: furniture and characters in painter's order, on top of the baked base. */
import { agentSprite, GREY_STATES } from './agent.js'
import { drawClockHands } from './clock.js'
import { E, hslc, hx, mulc } from './color.js'
import { DESK_Z, SEAT_Z, TD } from './constants.js'
import { beacon, bell, extinguisher, mascot, movingBox, nightLight, pumpkin, trophyCabinetLeft, xmasTree } from './decor.js'
import { floorProps } from './floorprops.js'
import { cupOff, drawPile, pileOf } from './pile.js'
import { HALO, deskProps, drawChairBack, drawChairSeat, drawMonitor, halo, meetingTable, plant, screenGlow, screenLight, steam } from './furniture.js'
import { mailRoom, pendingDecisions, powerCut, powerPanel, shiftBoard, yourDesk } from './infra.js'
import { achievementIds, gatewayDown, hasAchievement, incidentBoardsOf } from './model.js'
import { PAL, lookOf } from './palette.js'
import { Px, box, shadeFor } from './raster.js'
import { setStyle } from './style.js'
import { hash } from './util.js'

/* The project filter washes what is NOT in that project towards the room's own neutral
   (light by day, dark by night). Only what a project owns is washed, in painter's order (an object drawn later, in front, stays vivid). */
const WASH = { day: [238, 240, 244], night: [16, 18, 26] }
export const WASH_ALPHA = 0.6

/**
 * Draw with `draw()` then wash every pixel of `box` it changed (and, when `inFloor` says so, the bare floor under it). `box` in art pixels.
 * The wash is a mix, so a washed object stays readable: dimmed, never hidden.
 */
function washed(px, box, inFloor, night, draw) {
  const x0 = Math.max(0, Math.floor(box.x0))
  const y0 = Math.max(0, Math.floor(box.y0))
  const x1 = Math.min(px.w, Math.ceil(box.x1))
  const y1 = Math.min(px.h, Math.ceil(box.y1))
  const w = x1 - x0
  if (w <= 0 || y1 <= y0) { draw(); return }
  const before = new Uint8ClampedArray(w * (y1 - y0) * 4)
  for (let y = y0; y < y1; y++) before.set(px.d.subarray((y * px.w + x0) * 4, (y * px.w + x1) * 4), (y - y0) * w * 4)
  draw()
  const c = night ? WASH.night : WASH.day
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const j = (y * px.w + x) * 4
      if (!px.d[j + 3]) continue
      const k = ((y - y0) * w + (x - x0)) * 4
      const changed = px.d[j] !== before[k] || px.d[j + 1] !== before[k + 1] || px.d[j + 2] !== before[k + 2] || px.d[j + 3] !== before[k + 3]
      if (changed || (inFloor && inFloor(x + 0.5, y + 0.5))) px.mix(x, y, c, WASH_ALPHA)
    }
  }
}

/** Art-pixel box of a pod (rug + what stands on it, characters included) and its floor test. Pure geometry, shared with the page's hit tests. */
export function podArea(layout, p) {
  const { ox, oy } = layout.origin
  const P = (x, y, z) => [ox + (x - y) * 16, oy + (x + y) * 8 - z]
  const rx0 = p.x0 - 0.45
  const ry0 = p.y0 - 1.2
  const rw = p.w + 0.9
  const rd = TD + 2.4
  const pts = [P(rx0, ry0, 0), P(rx0 + rw, ry0, 0), P(rx0, ry0 + rd, 0), P(rx0 + rw, ry0 + rd, 0)]
  const box = { x0: Math.min(...pts.map(q => q[0])) - 2, x1: Math.max(...pts.map(q => q[0])) + 2, y0: Math.min(...pts.map(q => q[1])) - 56, y1: Math.max(...pts.map(q => q[1])) + 3 }
  const inFloor = (x, y) => {
    const a = (x - ox) / 16
    const b = (y - oy) / 8
    const u = (a + b) / 2
    const v = (b - a) / 2
    return u >= rx0 && u <= rx0 + rw && v >= ry0 && v <= ry0 + rd
  }
  return { box, inFloor }
}

/** Selection square of an agent at rest (no halo): a light neutral, readable on the floor by day and by night. */
const RING_REST = [226, 230, 238]

/** The frame buffer of each layout, for the callers that paint frame after frame (`opts.reuse`). */
const FRAME_BUFFERS = new WeakMap()

/**
 * One frame of the room: { W, H, d } (RGBA). `d` is a new buffer, owned by the caller. A caller that paints the same layout again and again and
 * uses each frame before the next one (the page's animation) passes `{ reuse: true }`: the frame is then drawn into the buffer of that layout,
 * the same one every time (a 756 KB buffer per frame at 12 bots is ~10 GB an hour for the collector). Such a caller must copy `d` to keep it.
 */
export function drawScene(layout, base, model, frame = 0, opts = null) {
  const { pods, lounge, X, Y } = layout
  const night = !!model.night
  const art = !model.classic   // the second art pass (base.js); false = the first art direction, kept pixel for pixel
  const sprOpt = art ? { art: true, marker: model.markers !== false } : undefined
  const decor = model.decor
  setStyle(decor.style || null)   // furniture colours follow the decorator's fiche, whatever was drawn before
  const sober = !!decor.sober
  const ops = model.ops
  const selected = model.selected
  const accent = model.accent
  const px = new Px(layout.W, layout.H, layout.origin.ox, layout.origin.oy, opts?.reuse ? FRAME_BUFFERS.get(layout) : null)
  if (opts?.reuse) FRAME_BUFFERS.set(layout, px.d)
  px.d.set(base.d)
  px.L = base.L
  const P = (x, y, z) => px.P(x, y, z)
  const agents = model.agents || []
  const anyWorking = agents.some(a => a.state === 'working')
  const incidents = incidentBoardsOf(decor)
  const has = id => hasAchievement(decor, id)
  // the selection square takes the agent's state hue (same as its floor halo); a state without halo (resting, new) gets a neutral light grey.
  // classic keeps the accent ring of the first art direction, pixel for pixel.
  const ring = (x, y, state) => {
    const c = E(art ? HALO[state] || RING_REST : accent)
    const pts = [P(x - 0.42, y - 0.42), P(x + 0.42, y - 0.42), P(x + 0.42, y + 0.42), P(x - 0.42, y + 0.42)]
    for (let i = 0; i < 4; i++) px.line(pts[i], pts[(i + 1) % 4], c)
  }
  const spriteAt = (a, x, y, z, facing, kind, wash = false) => {
    const [ax, ay] = P(x, y, z)
    const spr = agentSprite(a, facing, frame, kind, sprOpt)
    const X0 = Math.round(ax)
    const Y0 = Math.round(ay)
    // at night, who sits before a lit screen has its light on the face and the chest (front row: the screen is between it and us)
    const lit = art && night && facing === 'front' && !kind ? screenLight(a.state) : null
    const put = () => {
      if (HALO[a.state]) spr.aura(px, X0, Y0, HALO[a.state], a.state === 'active' || frame % 4 < 2)
      spr.blit(px, X0, Y0, GREY_STATES.has(a.state) && !(art && a.state === 'new'), lit ? { c: lit, a: 0.1, y0: -30, y1: -8 } : undefined)
    }
    if (wash) washed(px, { x0: X0 - 24, y0: Y0 - 50, x1: X0 + 24, y1: Y0 + 12 }, null, night, put)
    else put()
  }
  // the clock hands: per frame, over the baked face, so the base never depends on the minute
  drawClockHands(px, layout, model.nowMs)
  // back-wall furniture
  box(px, 0.2, 0.15, 0, 0.7, 0.55, 44, { t: PAL.rackT, l: PAL.rack, r: mulc(PAL.rack, 0.8) })
  for (let i = 0; i < 6; i++) {
    const [lx, ly] = P(0.32 + (i % 3) * 0.18, 0.7, 36 - Math.floor(i / 3) * 9)
    const on = !anyWorking || (frame + i) % 3 !== 0
    px.put(Math.round(lx), Math.round(ly), E(i === 5 ? PAL.ledB : on ? PAL.ledG : mulc(PAL.ledG, 0.35)), true)
  }
  const spots = layout.furniture || []
  spots.forEach((ax, i) => {
    if (i === 0 && spots.length > 1) {
      box(px, ax - 0.65, 0.05, 0, 1.3, 0.4, 38, { t: PAL.woodT, l: PAL.wood, r: PAL.woodD })
      for (let k = 0; k < 3; k++) {
        for (let j = 0; j < 6; j++) {
          const [bx, by] = P(ax - 0.6 + j * 0.2, 0.45, 6 + k * 11)
          const c = hslc(hash('book' + k + j) % 360, 45, 52)
          for (let t = 0; t < 7; t++) { px.put(Math.round(bx), Math.round(by) - t, c); px.put(Math.round(bx) + 1, Math.round(by) - t + 1, mulc(c, 0.8)) }
        }
      }
    } else plant(px, ax, 0.45, true)
  })
  if (!sober) trophyCabinetLeft(px, layout.cabinetY, achievementIds(decor), decor.medals || null)
  // kitchenette + door side
  const L0 = lounge.x0
  powerPanel(px, 0, 2.2, frame, ops)
  mailRoom(px, L0 + 4.3, ops)
  shiftBoard(px, L0 + 5.35, night, ops)
  box(px, L0 + 0.25, 0.05, 0, 2.3, 0.55, 15, { t: PAL.counterT, l: PAL.cab, r: PAL.cabD, hi: hx('#ffffff') })
  if (has('thrifty')) {
    box(px, L0 + 0.4, 0.1, 15, 0.5, 0.36, 12, { t: hx('#e9edf1'), l: hx('#c3cbd3'), r: hx('#9aa5b0'), hi: hx('#ffffff') })
    box(px, L0 + 0.48, 0.44, 19, 0.3, 0.06, 4, { t: hx('#2b2f36'), l: hx('#b3261e'), r: hx('#8a1d17') })
  } else box(px, L0 + 0.45, 0.12, 15, 0.35, 0.3, 9, { t: hx('#3a3f48'), l: hx('#2b2f36'), r: hx('#22252b') })
  if (has('quick')) bell(px, L0 + 1.8, 0.35, 15)
  px.put(...P(L0 + 0.62, 0.42, 20).map(Math.round), E(anyWorking ? hx('#ff5a4a') : hx('#7a2a24')), true)
  box(px, L0 + 1.1, 0.15, 15, 0.18, 0.18, 4, shadeFor(hx('#f2efe9')))
  if (art) { steam(px, L0 + 1.19, 0.24, 19, frame); steam(px, L0 + (has('thrifty') ? 0.65 : 0.62), 0.3, has('thrifty') ? 27 : 24, frame + 2) }   // the coffee is hot
  box(px, L0 + 2.7, 0.1, 0, 0.4, 0.4, 16, shadeFor(hx('#e9edf1')))
  box(px, L0 + 2.74, 0.14, 16, 0.32, 0.32, 13, { t: E(hx('#b9e2f7')), l: E(hx('#9fd3f0')), r: E(hx('#86c3e6')) })
  // pods
  const dim = model.dim || null   // { boards: [slug], hall: bool }: what the project filter washes (absent = nothing)
  const dimPods = new Set(dim?.boards || [])
  for (const p of pods) (dimPods.has(p.b.slug) ? (fn => { const a = podArea(layout, p); washed(px, a.box, a.inFloor, night, fn) }) : (fn => fn()))(() => {
    const TY = p.y0
    const r0 = p.seats.filter(s => s.row === 0)
    const r1 = p.seats.filter(s => s.row === 1)
    for (const s of r0) {
      if (s.agent) halo(px, s.x, s.y, s.agent.state, frame)
      drawChairBack(px, s.x, s.y, -1, art ? p.hue : null)
      drawChairSeat(px, s.x, s.y)
      if (s.agent && s.agent.name === selected) ring(s.x, s.y, s.agent.state)
      if (s.agent) spriteAt(s.agent, s.x, s.y, SEAT_Z, 'front')
    }
    for (const [lx, ly] of [[p.x0 + 0.08, TY + 0.08], [p.x0 + p.w - 0.16, TY + 0.08], [p.x0 + 0.08, TY + TD - 0.16], [p.x0 + p.w - 0.16, TY + TD - 0.16]]) box(px, lx, ly, 0, 0.08, 0.08, DESK_Z - 2, shadeFor(PAL.leg))
    box(px, p.x0, TY, DESK_Z - 2, p.w, TD, 2, { t: PAL.deskT, l: PAL.deskL, r: PAL.deskR, hi: hx('#ffffff') })
    if (art && night) {
      // a lit screen lights the desk top before it, on its agent's side (what stands on the desk is drawn over it)
      for (const s of p.seats) {
        const c = s.agent ? screenLight(s.agent.state) : null
        if (c) screenGlow(px, Math.max(p.x0, s.x - 0.55), s.row ? TY + TD / 2 + 0.16 : TY + 0.02, Math.min(p.x0 + p.w, s.x + 0.55), s.row ? TY + TD - 0.02 : TY + 0.5, DESK_Z, c, s.agent.state === 'working' ? 0.22 : 0.13)
      }
    }
    for (const s of r0) {
      deskProps(px, s.x, TY + 0.12, s.agent, 0, sober, art ? frame : null)
      const L = s.agent ? lookOf(s.agent.name) : null
      if (L && L.dual) { drawMonitor(px, s.x - 0.62, TY + 0.5, 0.58, false); drawMonitor(px, s.x + 0.02, TY + 0.5, 0.58, false) } else drawMonitor(px, s.x - 0.36, TY + 0.5, 0.72, false)
    }
    box(px, p.x0 + 0.05, TY + TD / 2 - 0.03, DESK_Z, p.w - 0.1, 0.06, 9, { t: hslc(p.hue, 30, 70), l: hslc(p.hue, 34, 55), r: hslc(p.hue, 34, 44) })
    for (const s of r1) {
      const L = s.agent ? lookOf(s.agent.name) : null
      if (L && L.dual) { drawMonitor(px, s.x - 0.6, TY + TD / 2 + 0.1, 0.58, true, s.agent, frame, night); drawMonitor(px, s.x + 0.02, TY + TD / 2 + 0.1, 0.58, true, s.agent, frame, night) } else drawMonitor(px, s.x - 0.36, TY + TD / 2 + 0.1, 0.72, true, s.agent, frame, night)
      if (art) drawPile(px, s.x, TY, 1, pileOf(s.agent))   // the pile of folders, between its screens and its keyboard (front row only)
      deskProps(px, s.x, TY + TD - 0.36, s.agent, 1, sober, art ? frame : null, art && cupOff(pileOf(s.agent)))   // no cup beside the pile
    }

    for (const s of r1) {
      if (s.agent) halo(px, s.x, s.y, s.agent.state, frame)
      drawChairSeat(px, s.x, s.y)
      if (s.agent && s.agent.name === selected) ring(s.x, s.y, s.agent.state)
      const hung = art && s.agent?.state === 'new'   // the jacket hangs on the chair's back, not behind it
      if (s.agent && !hung) spriteAt(s.agent, s.x, s.y, SEAT_Z, 'back')
      drawChairBack(px, s.x, s.y, 1, art ? p.hue : null)
      if (hung) spriteAt(s.agent, s.x, s.y + 0.3, SEAT_Z + 3, 'back')
    }
    if (has('owl') && decor.owlBoard === p.b.slug) nightLight(px, p.x0 + p.w - 0.2, TY + TD - 0.25, night)
    if (incidents.includes(p.b.slug)) beacon(px, p.x0 + p.w / 2, TY + TD / 2, frame)
    if (!sober) for (const s of p.seats) if (s.agent && (decor.recruits || []).includes(s.agent.name)) movingBox(px, s.x + 0.62, s.y + (s.row ? 0.15 : -0.1))
  })
  // lounge: sofa (faces +y), coffee table, armchairs (face -y)
  box(px, L0 + 0.5, 1.4, 0, 2.8, 0.3, 21, { t: PAL.sofaT, l: PAL.sofa, r: PAL.sofaD })
  box(px, L0 + 0.5, 1.75, 0, 2.8, 0.7, 7, { t: PAL.sofaT, l: PAL.sofa, r: PAL.sofaD })
  box(px, L0 + 0.35, 1.45, 0, 0.18, 1.0, 11, { t: PAL.sofaT, l: PAL.sofa, r: PAL.sofaD })
  box(px, L0 + 3.27, 1.45, 0, 0.18, 1.0, 11, { t: PAL.sofaT, l: PAL.sofa, r: PAL.sofaD })
  for (const s of lounge.seats) halo(px, s.x, s.y + (s.kind === 'sofa' ? 0.35 : 0), s.agent.state, frame)
  for (const s of lounge.seats.filter(s => s.kind === 'sofa')) {
    if (s.agent.name === selected) ring(s.x, s.y, s.agent.state)
    spriteAt(s.agent, s.x, s.y, 6, 'front', 'sofa', Boolean(dim?.hall))
  }
  box(px, L0 + 0.5, 2.38, 0, 2.8, 0.07, 5, { t: PAL.sofaT, l: PAL.sofaD, r: PAL.sofaD })
  if (!lounge.seats.length) box(px, L0 + 1.3, 1.6, 7, 0.4, 0.25, 6, shadeFor(PAL.cushion))
  box(px, L0 + 1.1, 3.0, 0, 1.6, 0.8, 6, { t: PAL.woodT, l: PAL.wood, r: PAL.woodD, hi: mulc(PAL.woodT, 1.15) })
  box(px, L0 + 1.4, 3.2, 6, 0.3, 0.22, 2, shadeFor(hx('#d9644c')))
  for (const s of lounge.seats.filter(s => s.kind === 'arm')) {
    box(px, s.x - 0.35, s.y - 0.3, 0, 0.7, 0.6, 7, { t: PAL.sofaT, l: PAL.sofa, r: PAL.sofaD })
    if (s.agent.name === selected) ring(s.x, s.y, s.agent.state)
    const hung = art && s.agent.state === 'new'
    if (!hung) spriteAt(s.agent, s.x, s.y, 7, 'back', undefined, Boolean(dim?.hall))
    box(px, s.x - 0.35, s.y + 0.25, 0, 0.7, 0.18, 15, { t: PAL.sofaT, l: PAL.sofa, r: PAL.sofaD })
    if (hung) spriteAt(s.agent, s.x, s.y + 0.3, 9, 'back', undefined, Boolean(dim?.hall))
  }
  // front corners: the plant grows with the current streak of runs without a crash (sober: a plain plant)
  if (sober) plant(px, 0.55, Y - 0.6, true)
  else {
    const st = decor.streak || 0
    const stage = Math.min(4, Math.floor(st / 5))
    const wilt = st === 0 && decor.lastFailMs != null
    plant(px, 0.55, Y - 0.6, true, { n: 3 + stage * 2, H: 10 + stage * 5, wilt, flowers: stage >= 4 })
  }
  yourDesk(px, layout, pendingDecisions(model))
  // against the back wall under the pigeon-holes, by the door (not alone at the open right edge, far from any wall)
  if (has('fire')) extinguisher(px, L0 + 4.5, 0.22)
  if (!sober) {
    const mood = decor.mascotMood === 'hidden' ? 'hide' : decor.mascotMood
    if (mood) mascot(px, L0 + 3.05, 4.15, mood, frame)
    if (decor.season === 'halloween') pumpkin(px, L0 + 3.9, 1.3)
    if (decor.season === 'xmas') xmasTree(px, L0 + 3.85, 1.25, frame)
  }
  // the front of the common room is furnished when it is empty (drawn last: nothing stands in front of it)
  if (art) for (const f of floorProps(layout)) (f.kind === 'table' ? meetingTable(px, f.x, f.y) : plant(px, f.x, f.y, true, { n: 8, H: 22 }))
  if (gatewayDown(ops)) powerCut(px, frame, Y)
  return { W: layout.W, H: layout.H, d: px.d }
}
