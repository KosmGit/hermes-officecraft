import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentSprite, STAND } from '../../src/scene/agent.js'
import { BACK_SHADE, NIGHT_AMBIENT } from '../../src/scene/base.js'
import { band } from '../../src/scene/color.js'
import { floorProps } from '../../src/scene/floorprops.js'
import { FACE_SIZE, STATE_ICONS, STATE_ICON_SIZE, buildBackdrop, buildBase, drawScene, face, layoutScene, normalizeStyle, portrait, setStyle, stateIconCells, toSceneModel, hotspots, fitScale } from '../../src/scene/index.js'
import * as sceneApi from '../../src/scene/index.js'
import { PAL } from '../../src/scene/palette.js'
import { BACKDROP_STEP, FRAME_PAD, bleedOf } from '../../src/scene/backdrop.js'
import { BLADE, BLADE_L, GRASS, LEAF, TOWER, TOWER_HI } from '../../src/scene/outdoor.js'
import { viewColor } from '../../src/scene/style.js'
import { readFileSync } from 'node:fs'

// ===== scene-art =====
{
// The second art direction of the scene: what it promises, measured on the pixels (the first art direction is kept, pixel for
// pixel, under `classic`).
const agent = (name, state, home) => ({ name, label: name, state, home, task: null, badge: null, tag: null })
const office = (states = ['working', 'waiting', 'idle', 'active', 'working', 'offline'], boards = 2) => ({
  agents: states.map((s, i) => agent('a' + i, s, 'b' + (i % boards))),
  boards: Array.from({ length: boards }, (_, i) => ({ slug: 'b' + i, counts: {}, total: 0, blocked: [] })),
  ops: null
})
const scene = (extras = {}, o = office()) => {
  const model = toSceneModel(o, { nowMs: 1e12, ...extras })
  const layout = layoutScene(model)
  return { model, layout, base: buildBase(layout, model) }
}
/** Every colour painted where the base asked for the flat colour `c` under the light map. */
function paintedAs(base, c) {
  const seen = new Set()
  for (let i = 0; i < base.d.length; i += 4) {
    const li = (i / 4) * 3
    const e = [0, 1, 2].map(k => Math.min(255, Math.floor(c[k] * base.L[li + k])))
    if (Math.abs(base.d[i] - e[0]) <= 1 && Math.abs(base.d[i + 1] - e[1]) <= 1 && Math.abs(base.d[i + 2] - e[2]) <= 1) seen.add(`${base.d[i]},${base.d[i + 1]},${base.d[i + 2]}`)
  }
  return seen
}

test('band(): one scalar snapped to steps, never negative, exact on a step, hard edges at amp 0', () => {
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
    assert.equal(band(0, 16, x, y), 0)
    assert.equal(band(0.5, 16, x, y), 0.5)
    assert.equal(band(0.26, 4, x, y, 0), 0.25)
  }
  const seen = new Set()
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) seen.add(band(0.53, 16, x, y, 1))
  assert.deepEqual([...seen].sort(), [0.5, 0.5625])
})

test('the light never shifts the hue of a flat wall: one colour by day, one by night (it was 3 and 2, yellow / pink / green speckles)', () => {
  for (const night of [false, true]) {
    const { base } = scene({ night }, office(['idle', 'idle', 'idle', 'idle']))
    const L = base.L
    // far from any pool, the light map is the ambient itself, the same on every pixel
    const flat = new Set()
    for (let i = 0; i < 300; i += 3) flat.add(`${L[i]},${L[i + 1]},${L[i + 2]}`)
    assert.equal(flat.size, 1, night ? 'night' : 'day')
  }
  const day = scene({}, office(['idle', 'idle', 'idle', 'idle']))
  assert.ok(paintedAs(day.base, PAL.wallL).size <= 2, [...paintedAs(day.base, PAL.wallL)].join(' | '))
})

test('every light of the map is the ambient plus a pool whose three channels move together (same hue on every step)', () => {
  const { base } = scene({ night: true })
  const L = base.L
  let lit = 0
  for (let i = 0; i < L.length; i += 3) {
    const d = [L[i] - NIGHT_AMBIENT[0], L[i + 1] - NIGHT_AMBIENT[1], L[i + 2] - NIGHT_AMBIENT[2]]
    assert.ok(d.every(v => v >= -1e-6), 'never under the ambient')
    if (d[0] > 0.02) lit++
  }
  assert.ok(lit > 500, 'the lit desks throw pools of light')
})

test('a real night: the ambient is at least a fifth under the first one, and the classic scene keeps the first one', () => {
  assert.ok(NIGHT_AMBIENT[0] <= 0.33 * 0.85 && NIGHT_AMBIENT[2] <= 0.56 * 0.85)
  const lum = b => { let s = 0; for (let i = 0; i < b.d.length; i += 4) s += b.d[i] + b.d[i + 1] + b.d[i + 2]; return s }
  const o = office(['idle', 'idle'])
  assert.ok(lum(scene({ night: true }, o).base) < lum(scene({ night: true, classic: true }, o).base) * 0.9)
})

test('one light: the back wall is painted BACK_SHADE under its colour, the left wall is not', () => {
  const { base } = scene({}, office(['idle', 'idle']))
  const shaded = PAL.wallB.map(v => v * BACK_SHADE)
  assert.ok(paintedAs(base, shaded).size >= 1, 'the shaded back wall is there')
  assert.ok(BACK_SHADE <= 0.9 && BACK_SHADE >= 0.85)
})

test('the bays throw their light on the floor: brighter than the same floor in the classic scene, by day and by night', () => {
  for (const night of [false, true]) {
    const o = office(['idle', 'idle'])
    const a = scene({ night }, o)
    const c = scene({ night, classic: true }, o)
    let brighter = 0; let n = 0
    for (let i = 0; i < a.base.d.length; i += 4) {
      const da = a.base.d[i] + a.base.d[i + 1] + a.base.d[i + 2]
      const dc = c.base.d[i] + c.base.d[i + 1] + c.base.d[i + 2]
      if (da > dc * 1.12 && dc > 0) brighter++
      n++
    }
    assert.ok(brighter > 600, `${night ? 'night' : 'day'}: ${brighter} px of ${n} lit by the bays`)
  }
})

test('who waits on you stands up with its arms crossed (STAND px taller); sofa and classic sprites stay seated', () => {
  const a = agent('quill', 'waiting', 'b0')
  const top = s => Math.min(...[...s.m.keys()].map(k => k >> 9))
  for (const facing of ['front', 'back']) {
    const seated = agentSprite(a, facing, 0, undefined)
    const up = agentSprite(a, facing, 0, undefined, { art: true })
    assert.equal(top(seated) - top(up), STAND, facing)
    assert.ok(up.m.size > seated.m.size, 'legs')
    assert.equal(top(agentSprite(a, facing, 0, 'sofa', { art: true })), top(agentSprite(a, facing, 0, 'sofa')))
  }
})

test('marker: false swaps the state crystal over a working head for a bubble of running dots, and touches nothing below', () => {
  const a = agent('echo', 'working', 'b0')
  const full = agentSprite(a, 'front', 0, undefined, { art: true })
  const bare = agentSprite(a, 'front', 0, undefined, { art: true, marker: false })
  const dy = k => (k >> 9) - 128
  const below = s => [...s.m].filter(([k]) => dy(k) > -30).map(([k, c]) => `${k}:${c}`).sort()
  assert.deepEqual(below(bare), below(full), 'the body is the same')
  assert.ok([...bare.m.keys()].some(k => dy(k) < -34) && [...full.m.keys()].some(k => dy(k) < -34), 'one sign above the head, each way')
  // the dots run: one dot lit per frame, then a pause; the loop is 4 frames long
  const at = f => JSON.stringify([...agentSprite(a, 'front', f, undefined, { art: true, marker: false }).m].filter(([k]) => dy(k) < -34))
  assert.equal(new Set([0, 1, 2, 3].map(at)).size, 4)
  assert.equal(at(1), at(5))
  const idle = agent('echo', 'idle', 'b0')
  assert.deepEqual([...agentSprite(idle, 'front', 0, undefined, { art: true }).m], [...agentSprite(idle, 'front', 0, undefined, { art: true, marker: false }).m])
})

test('the front of the room is furnished when it is empty, and only then; never on a seat', () => {
  const small = layoutScene(toSceneModel(office(['idle', 'idle'], 1), { nowMs: 1e12 }))
  const big = layoutScene(toSceneModel(office(Array(12).fill('idle'), 3), { nowMs: 1e12 }))
  for (const layout of [small, big]) {
    for (const f of floorProps(layout)) {
      assert.ok(f.x - f.r >= 0 && f.x + f.r <= layout.X && f.y - f.r >= 0 && f.y + f.r <= layout.Y, 'inside the room')
      for (const s of layout.lounge.seats) assert.ok(Math.hypot(s.x - f.x, s.y - f.y) > f.r + 0.3, `${f.kind} on a seat of the common room`)
      for (const p of layout.pods) assert.ok(f.x - f.r > p.x0 + p.w || f.y - f.r > p.y0 + 2.2 || f.y + f.r < p.y0 - 1, `${f.kind} in an island`)
    }
  }
  assert.ok(floorProps(big).some(f => f.kind === 'table'), 'a tall room has its meeting table')
})

test('the scene stays deterministic and its animation loops over 12 frames (steam included)', () => {
  const { layout, base, model } = scene({ night: true })
  const hash = px => { let h = 0; for (let i = 0; i < px.d.length; i += 97) h = (h * 31 + px.d[i]) >>> 0; return h }
  assert.equal(hash(drawScene(layout, base, model, 1)), hash(drawScene(layout, base, model, 1)))
  assert.equal(hash(drawScene(layout, base, model, 1)), hash(drawScene(layout, base, model, 13)))
  assert.notEqual(hash(drawScene(layout, base, model, 0)), hash(drawScene(layout, base, model, 1)))
})

test('lamp posts: amber pools in hard bands (a handful of distinct lights on the lawn, where a gradient gave hundreds)', () => {
  const { layout } = scene({ night: true })
  const bd = buildBackdrop(layout, { night: true, bleed: { l: 48, t: 16, r: 48, b: 48 } })
  const day = buildBackdrop(layout, { night: false, bleed: { l: 48, t: 16, r: 48, b: 48 } })
  // where the night ground is redder than green, a lamp or the room lights it: amber, never the pale lime of the first pools
  let amber = 0
  for (let i = 0; i < bd.d.length; i += 4) if (bd.d[i + 3] && bd.d[i] > bd.d[i + 1] * 1.05 && bd.d[i] > bd.d[i + 2] * 1.3 && day.d[i + 1] > day.d[i]) amber++
  assert.ok(amber > 300, `${amber} px of lawn turned amber`)
})

test('a portrait does not depend on the style the scene drew last (the palette is global: this is the guard)', () => {
  const a = agent('quill', 'working', 'b0')
  setStyle(null)
  const ref = JSON.stringify(portrait(a))
  setStyle(normalizeStyle({ left: '#102030', back: '#203040', wainscot: '#405060', seam: '#111111', sofa: '#aa0000', cushion: '#00aa00', cabinets: '#0000aa', desk: '#333333', floor: 'concrete', view: 'city' }))
  const styled = JSON.stringify(portrait(a))
  setStyle(null)
  assert.equal(styled, ref)
})

// ---------- states that read without colour ----------

test('postures: idle leans back hands behind the head under a still « zz », stale hangs its head, new is a jacket on an empty chair', () => {
  const dy = k => (k >> 9) - 128
  const dx = k => (k & 511) - 256
  const spr = (state, facing = 'front', f = 0, kind, extra = {}) => agentSprite({ ...agent('echo', state, 'b0'), ...extra }, facing, f, kind, { art: true, marker: false })
  const top = s => Math.min(...[...s.m.keys()].map(dy))
  const wide = s => Math.max(...[...s.m.keys()].filter(k => dy(k) > -26 && dy(k) < -8).map(k => Math.abs(dx(k))))
  for (const facing of ['front', 'back']) {
    const idle = spr('idle', facing)
    const active = spr('active', facing)
    assert.ok(wide(idle) > wide(active), `${facing}: the elbows stick out`)
    assert.ok(top(idle) < top(active), `${facing}: a zz above the head`)
    // nobody on the chair: no head (nothing above the shoulders), and far fewer pixels than a seated agent
    const coat = spr('new', facing)
    assert.ok(top(coat) >= -17, `${facing}: no head, ${top(coat)}`)
    assert.ok(coat.m.size > 60 && coat.m.size < active.m.size * 0.6, `${coat.m.size} / ${active.m.size}`)
    assert.deepEqual([...coat.m], [...spr('new', facing, 3).m], 'a jacket does not move')
  }
  // the head of who went silent is lower than the head of the same agent with a session open
  const headTop = s => {   // the first row as wide as a head (the bubble above is narrower)
    for (let y = -34; y < 0; y++) if ([...s.m.keys()].filter(k => dy(k) === y).length >= 14) return y
  }
  for (const facing of ['front', 'back']) assert.ok(headTop(spr('stale', facing)) > headTop(spr('active', facing)), facing)
  // on the sofa two neighbours would cross their elbows: the arms stay down there; who sleeps for a day keeps its own pose
  assert.equal(wide(spr('idle', 'front', 0, 'sofa')), wide(spr('active', 'front', 0, 'sofa')))
  assert.ok(wide(spr('idle', 'front', 0, undefined, { sleepy: true })) < wide(spr('idle')))
  // the classic sprite never changes
  for (const st of ['idle', 'stale', 'new']) assert.ok(top(agentSprite(agent('echo', st, 'b0'), 'front', 0)) <= -27, `classic ${st} keeps its head`)
})

test('in the scene: jackets on the chairs of « new » agents are not people at rest, and stay in their colours', () => {
  const o = office(['new', 'new', 'new', 'new'], 1)
  const { layout, base, model } = scene({}, o)
  const coats = { d: drawScene(layout, base, model, 0).d.slice() }   // drawScene reuses its buffer
  const o2 = office(['idle', 'idle', 'idle', 'idle'], 1)
  const r2 = scene({}, o2)   // the layout carries the agents: one layout per office
  const rest = drawScene(r2.layout, r2.base, r2.model, 0)
  let diff = 0
  for (let i = 0; i < coats.d.length; i += 4) if (coats.d[i] !== rest.d[i] || coats.d[i + 1] !== rest.d[i + 1] || coats.d[i + 2] !== rest.d[i + 2]) diff++
  assert.ok(diff > 400, `${diff} px differ between four jackets and four people at rest`)
  // classic: a « new » agent is still a grey character on its chair
  const c = scene({ classic: true }, o)
  const grey = { d: drawScene(c.layout, c.base, c.model, 0).d.slice() }
  const c2 = scene({ classic: true }, o2)
  const crest = drawScene(c2.layout, c2.base, c2.model, 0)
  let cdiff = 0
  for (let i = 0; i < grey.d.length; i += 4) if (grey.d[i] !== crest.d[i]) cdiff++
  assert.ok(cdiff > 0 && cdiff < diff, `${cdiff} < ${diff}`)
})

test('state signs: one 9 x 9 shape per state, all different, an unknown state falls back to « ? »', () => {
  const states = ['working', 'active', 'waiting', 'idle', 'stale', 'queued', 'new', 'unknown']
  assert.deepEqual(Object.keys(STATE_ICONS).sort(), [...states].sort())
  for (const st of states) {
    assert.equal(STATE_ICONS[st].length, STATE_ICON_SIZE)
    for (const row of STATE_ICONS[st]) assert.match(row, /^[.#]{9}$/)
    const n = stateIconCells(st).length
    assert.ok(n >= 14 && n <= 62, `${st}: ${n} cells of ink`)
  }
  // no two signs are near twins: a shape must tell the state without its colour
  for (const a of states) for (const b of states) if (a < b) {
    const A = STATE_ICONS[a].join(''); const B = STATE_ICONS[b].join('')
    let d = 0
    for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) d++
    assert.ok(d >= 12, `${a} / ${b}: ${d}`)
  }
  assert.deepEqual(stateIconCells('whatever'), stateIconCells('unknown'))
})

test('face: the head of the sprite on 14 x 14, the same whatever the state shows above it, grey when nothing is live', () => {
  const a = agent('quill', 'working', 'b0')
  const f = face(a)
  assert.deepEqual([f.W, f.H, f.d.length], [FACE_SIZE, FACE_SIZE, FACE_SIZE * FACE_SIZE * 4])
  let ink = 0
  for (let i = 3; i < f.d.length; i += 4) if (f.d[i]) ink++
  assert.ok(ink > 90, `${ink} px of head`)
  for (const st of ['waiting', 'idle', 'active', 'stale']) assert.deepEqual([...face({ ...a, state: st }).d], [...f.d], st)
  assert.notDeepEqual([...face({ ...a, state: 'new' }).d], [...f.d])
  assert.notDeepEqual([...face(agent('echo', 'working', 'b0')).d], [...f.d], 'two agents, two heads')
})

test('the selection square on the floor takes the state hue of the selected agent (resting: a neutral); classic keeps the accent', () => {
  const ringOf = (state, extras = {}) => {
    const o = office([state, 'idle'], 1)
    const s = scene(extras, o)
    const off = Uint8ClampedArray.from(drawScene(s.layout, s.base, { ...s.model, selected: null }, 0).d)
    const on = drawScene(s.layout, s.base, { ...s.model, selected: 'a0' }, 0).d
    const seen = new Map()
    for (let i = 0; i < on.length; i += 4) if (on[i] !== off[i] || on[i + 1] !== off[i + 1] || on[i + 2] !== off[i + 2]) {
      const k = `${on[i]},${on[i + 1]},${on[i + 2]}`
      seen.set(k, (seen.get(k) || 0) + 1)
    }
    // the dominant new colour, named by the nearest candidate hue (the room light and the halo under it move it a few steps)
    const c = [...seen].sort((p, q) => q[1] - p[1])[0][0].split(',').map(Number)
    const d = h => h.reduce((t, v, k) => t + (v - c[k]) ** 2, 0)
    return Object.entries(HUES).sort((p, q) => d(p[1]) - d(q[1]))[0][0]
  }
  const HUES = { working: [77, 140, 255], waiting: [242, 165, 22], active: [47, 174, 107], stale: [150, 156, 170], idle: [226, 230, 238], accent: [200, 40, 200] }
  for (const st of ['working', 'waiting', 'active', 'stale', 'idle']) assert.equal(ringOf(st), st)
  for (const st of ['working', 'waiting', 'idle']) assert.equal(ringOf(st, { classic: true, accent: HUES.accent }), 'accent')
})
}

// ===== scene-art =====
{
// The pixel art of the room tells one consistent story.
//   - the glazing looks out on the park drawn around the building (same lawn, same leaves), whatever the decorator's view;
//   - no hanging lamp in the room (the night itself says the lights are on);
//   - outdoors: the street lamps (the park's, they stay) stand clear of the room canvas, trees in front of the room never slip under it.
const lampsGone = sceneApi.lampSpots
const STATES = ['working', 'waiting', 'stale', 'active', 'idle', 'new']
function office(nA, nB) {
  const boards = Array.from({ length: nB }, (_, i) => ({ slug: `b${i}`, counts: { todo: 1 }, total: 1, blocked: [] }))
  const agents = Array.from({ length: nA }, (_, i) => ({ name: `agent-${i}`, state: STATES[i % 6], home: nB && i % 5 !== 4 ? `b${i % nB}` : null, description: '', lastActivityMs: 1, officeMeta: {} }))
  return { agents, boards, ops: null }
}
const SIZES = [[1, 1], [2, 1], [5, 1], [7, 2], [13, 3], [14, 2], [22, 5], [30, 8], [30, 1], [9, 0]]

test('every view looks out on the same lawn and the same trees as the ground drawn around the room', () => {
  const near = c => [...GRASS, BLADE, BLADE_L, ...LEAF].some(g => Math.abs(g[0] - c[0]) + Math.abs(g[1] - c[1]) + Math.abs(g[2] - c[2]) < 2)
  for (const view of ['park', 'city', 'sea', 'forest']) {
    let lawn = 0
    let leaves = 0
    for (let s = 0; s < 60; s++) {
      if (near(viewColor(view, s, 1, 42, false))) lawn++
      for (let v = 4; v < 20; v++) if (LEAF.some(g => g.every((x, i) => Math.abs(x - viewColor(view, s, v, 42, false)[i]) < 1))) { leaves++; break }
    }
    assert.equal(lawn, 60, `${view}: the foot of the pane is the ground's lawn`)
    assert.ok(leaves >= (view === 'sea' ? 4 : 20), `${view}: the park's trees show in the pane (${leaves} columns)`)
  }
})

test('what the view adds is seen: the lawn shows above the pane frame under the sea, the skyline rises above the park', () => {
  // base.js paneColor(): the frame covers v < 1.5, so only rows from 1.5 up are seen. The lawn was 3-4 px: 2 px seen, the sea read as
  // lapping at the wall; the towers stopped under the crowns of the trees and read as a grey band (13 % of the columns).
  const isC = (c, list) => list.some(g => g.every((x, i) => Math.abs(x - c[i]) < 1))
  let lawn = 0
  let high = 0
  const roofs = new Set()
  for (let s = 0; s < 400; s++) {
    if (isC(viewColor('sea', s + 0.5, 4.5, 42, false), [...GRASS, BLADE, BLADE_L])) lawn++
    let top = -1
    for (let v = 0; v < 42; v++) if (isC(viewColor('city', s + 0.5, v + 0.5, 42, false), [TOWER, TOWER_HI])) top = v
    if (top >= 16) high++
    roofs.add(top)
  }
  assert.equal(lawn, 400, 'sea: 3 px of lawn above the frame, on every column')
  assert.ok(high >= 100, `city: a tower shows above the crowns on a quarter of the columns at least (${high}/400)`)
  assert.ok(roofs.size >= 8, 'city: roofs of unequal heights')
})

test('the lamps are gone: no lamp is exported, drawn or pointed at; the room keeps its night light without an object', () => {
  // the lamps were useless (they only said « night light: the lamps are on », which the night itself says)
  assert.equal(lampsGone, undefined, 'the scene no longer exports lampSpots')
  for (const [nA, nB] of SIZES) {
    const model = toSceneModel(office(nA, nB), { nowMs: 1e12 })
    const layout = layoutScene(model)
    assert.equal(hotspots(layout, { decor: {} }).filter(s => s.kind === 'lamp').length, 0, `${nA} agents / ${nB} boards: no lamp zone`)
    // night still reads: the ambient pools and the screens light the room, so the night is clearly darker and warmer than the day's grade
    // but never black (every column of the room keeps some colour)
    const day = buildBase(layout, { ...model, night: false })
    const night = buildBase(layout, { ...model, night: true })
    let dayLum = 0
    let nightLum = 0
    let nightLit = 0
    let nightWarm = 0
    for (let i = 0; i < day.d.length; i += 4) {
      if (!day.d[i + 3]) continue
      dayLum += day.d[i] + day.d[i + 1] + day.d[i + 2]
      const l = night.d[i] + night.d[i + 1] + night.d[i + 2]
      nightLum += l
      if (l > 150) nightLit++
      // a pixel of a warm pool (red well above blue, bright); « lit > 150 » alone still held with the pools all but off (0.12)
      if (night.d[i] > night.d[i + 2] + 40 && l > 200) nightWarm++
    }
    assert.ok(nightLum < dayLum * 0.85, `${nA} agents / ${nB} boards: the night is darker than the day`)
    assert.ok(nightLum > dayLum * 0.3, `${nA} agents / ${nB} boards: the night stays readable (${(nightLum / dayLum).toFixed(2)} of the day)`)
    assert.ok(nightLit > 800, `${nA} agents / ${nB} boards: the night keeps lit pixels (${nightLit})`)
    // one warm pool over each island and one over the common room (base.js): measured 6 472 to 38 412 warm pixels, ~0 to 133 without them
    const pools = layout.pods.length + 1
    assert.ok(nightWarm >= 2000 * pools, `${nA} agents / ${nB} boards: warm light pools remain at night (${nightWarm} warm pixels for ${pools} pools)`)
  }
})

test('outdoors: whatever is drawn under the room canvas in front of the room stays clear of its opaque pixels', () => {
  // the crown of a tree, too: a tree in front of the room that keeps its crown has it cut by the room canvas
  for (const [nA, nB] of [[24, 4], [30, 4]]) {   // two sizes where such a tree exists
    const model = toSceneModel(office(nA, nB), { nowMs: 1e12 })
    const layout = layoutScene(model)
    const room = drawScene(layout, buildBase(layout, model), model, 0)
    const bleed = { l: BACKDROP_STEP * 4, r: BACKDROP_STEP * 4, t: BACKDROP_STEP * 4, b: BACKDROP_STEP * 6 }
    const bare = buildBackdrop({ ...layout }, { night: false, bleed })
    let crown = 0
    for (let y = 0; y < layout.H; y++) {
      for (let x = 0; x < layout.W; x++) {
        if (!room.d[(y * layout.W + x) * 4 + 3]) continue
        const a = (x - layout.origin.ox) / 16; const b = (y - layout.origin.oy) / 8
        if ((a + b) / 2 <= layout.X && (b - a) / 2 <= layout.Y) continue
        const j = ((y + bleed.t) * bare.w + x + bleed.l) * 4
        if (LEAF.some(c => [0, 1, 2].every(k => Math.abs(c[k] - bare.d[j + k]) < 5))) crown++
      }
    }
    assert.equal(crown, 0, `${nA}/${nB}: ${crown} pixels of a tree crown under the room`)
  }
  for (const [nA, nB] of [[7, 2], [30, 8]]) {
    for (const night of [false, true]) {
      const model = toSceneModel(office(nA, nB), { nowMs: 1e12, night })
      const layout = layoutScene(model)
      const room = drawScene(layout, buildBase(layout, model), model, 0)
      const bleed = { l: BACKDROP_STEP * 4, r: BACKDROP_STEP * 4, t: BACKDROP_STEP * 4, b: BACKDROP_STEP * 6 }
      const bare = buildBackdrop({ ...layout }, { night, bleed })
      assert.equal(bare.d.length, bare.w * bare.h * 4)
      // a pixel of the ground that differs from plain grass / walk / shadow under an opaque room pixel would be hidden; we only
      // check what the ground puts there is never a tree trunk or a lamp post in front of the room: those are dark, narrow columns
      let hidden = 0
      for (let y = 0; y < layout.H; y++) {
        for (let x = 0; x < layout.W; x++) {
          if (!room.d[(y * layout.W + x) * 4 + 3]) continue
          const [u, v] = [x - layout.origin.ox, y - layout.origin.oy]
          const a = u / 16; const b = v / 8
          const tx = (a + b) / 2; const ty = (b - a) / 2
          if (tx <= layout.X && ty <= layout.Y) continue   // the room itself, or what is behind it: hidden on purpose
          const j = ((y + bleed.t) * bare.w + x + bleed.l) * 4
          const c = [bare.d[j], bare.d[j + 1], bare.d[j + 2]]
          if (c[0] + c[1] + c[2] < 200 && c[1] < c[0] + 10) hidden++   // trunk / pole tones (dark, not green)
        }
      }
      assert.ok(hidden < 12, `${nA}/${nB} ${night ? 'night' : 'day'}: ${hidden} trunk or pole pixels under the room`)
    }
  }
})
}

// ===== scene-art =====
{
// The room alone covers only 31-44 % of the frame (a diamond in a rectangle). The ground around the room is a separate layer
// (src/scene/backdrop.js) that reaches the edges of the frame; the room's own pixels (drawScene, the postcard, the `classic` render) do not change.
// Whole device pixels per art pixel are kept only when they waste at most 10 % of the pane.
const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const NOW = new Date(2026, 10, 12, 11, 10).getTime()
const office = (nA, nB) => {
  const boards = Array.from({ length: nB }, (_, i) => ({ slug: `b${i}`, counts: { todo: i + 1, running: 0, blocked: 0, done: 3 }, total: i + 4, blocked: [] }))
  const agents = Array.from({ length: nA }, (_, i) => ({ name: `a${i}`, state: ['working', 'idle', 'waiting'][i % 3], home: nB ? boards[i % nB].slug : null, description: '', lastActivityMs: 1, officeMeta: {} }))
  return { agents, boards, ops: null }
}
const sceneOf = (nA, nB, night = false) => {
  const model = toSceneModel(office(nA, nB), { nowMs: NOW, night })
  return { model, layout: layoutScene(model) }
}

test('the ground covers the whole frame at every size, for 0 to 30 agents and 0 to 8 boards', () => {
  for (const [nA, nB] of [[0, 0], [3, 1], [13, 4], [30, 8]]) {
    const { layout } = sceneOf(nA, nB)
    for (const [availW, availH, dpr] of [[1000, 650, 1], [1200, 800, 1], [1500, 880, 2], [1900, 1000, 1], [560, 700, 1], [380, 600, 1], [3000, 1600, 2]]) {
      const view = fitScale({ availW, availH, W: layout.W, H: layout.H, dpr })
      if (view.mode !== 'scene') continue
      const S = view.scale
      const b = bleedOf({ availW, availH, W: layout.W, H: layout.H, S })
      // the room is centred: the buffer, scaled, spans from (stage left - l*S) to (stage right + r*S) and must pass the frame's edges
      const stageL = FRAME_PAD[0] + Math.max(0, availW - layout.W * S) / 2
      const stageT = FRAME_PAD[2] + Math.max(0, availH - layout.H * S) / 2
      const frameW = availW + FRAME_PAD[0] + FRAME_PAD[1]
      const frameH = availH + FRAME_PAD[2] + FRAME_PAD[3]
      const msg = `${nA}/${nB} in ${availW}x${availH}@${dpr} (x${S})`
      assert.ok(stageL - b.l * S <= 0, `left edge: ${msg}`)
      assert.ok(stageL + (layout.W + b.r) * S >= frameW, `right edge: ${msg}`)
      assert.ok(stageT - b.t * S <= 0, `top edge: ${msg}`)
      assert.ok(stageT + (layout.H + b.b) * S >= frameH, `bottom edge: ${msg}`)
      for (const v of Object.values(b)) assert.equal(v % BACKDROP_STEP, 0, 'sized in steps: a resize rebuilds it rarely')
    }
  }
})

test('the ground is opaque everywhere, deterministic, and night differs from day', () => {
  const { layout } = sceneOf(5, 2)
  const bleed = bleedOf({ availW: 1100, availH: 700, W: layout.W, H: layout.H, S: 1.5 })
  const a = buildBackdrop(layout, { night: false, bleed })
  assert.equal(a.w, layout.W + bleed.l + bleed.r)
  assert.equal(a.h, layout.H + bleed.t + bleed.b)
  assert.equal(a.d.length, a.w * a.h * 4)
  for (let i = 3; i < a.d.length; i += 4) if (a.d[i] !== 255) assert.fail(`transparent pixel at ${(i - 3) / 4}`)
  const again = buildBackdrop(layout, { night: false, bleed })
  assert.ok(a.d.every((v, i) => v === again.d[i]), 'same model, same pixels')
  const n = buildBackdrop(layout, { night: true, bleed })
  const mean = d => { let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3 }
  assert.ok(mean(n.d) < mean(a.d) * 0.7, `night is darker (${mean(n.d).toFixed(0)} vs ${mean(a.d).toFixed(0)})`)
  // it is not a flat colour: grass, stones, trees, a shadow (the corners must be dressed, not painted over)
  const colours = new Set()
  for (let i = 0; i < a.d.length; i += 4) colours.add((a.d[i] << 16) | (a.d[i + 1] << 8) | a.d[i + 2])
  assert.ok(colours.size > 60, `${colours.size} distinct colours`)
})

test('the ground is dressed with life: trees and a paved walk, not just a green fill', () => {
  const { layout } = sceneOf(8, 3)
  const bleed = bleedOf({ availW: 1500, availH: 900, W: layout.W, H: layout.H, S: 1.8 })
  const a = buildBackdrop(layout, { night: false, bleed })
  let leaf = 0; let stone = 0; let bark = 0
  for (let i = 0; i < a.d.length; i += 4) {
    const [r, g, b] = [a.d[i], a.d[i + 1], a.d[i + 2]]
    if (g > r + 25 && g > b + 40 && g < 150 && r < 90) leaf++            // tree / bush foliage (darker than the grass)
    if (Math.abs(r - g) < 22 && Math.abs(g - b) < 40 && r > 150 && b > 120) stone++   // paving
    if (r > 80 && r < 120 && g > 60 && g < 90 && b < 60) bark++
  }
  assert.ok(leaf > 3000, `foliage pixels ${leaf}`)
  assert.ok(stone > 1500, `paving pixels ${stone}`)
  assert.ok(bark > 40, `trunk pixels ${bark}`)
})

test('fidelity: the room is untouched (drawScene never reads the ground; the corners of its canvas stay transparent)', () => {
  const { model, layout } = sceneOf(13, 4)
  const px = drawScene(layout, buildBase(layout, model), model, 0)
  let transparent = 0
  for (let i = 3; i < px.d.length; i += 4) if (!px.d[i]) transparent++
  assert.ok(transparent > px.d.length / 4 * 0.3, 'the diamond leaves its corners empty: they are the ground\'s to dress')
  for (const f of ['src/scene/draw.js', 'src/scene/base.js', 'src/ui/postcard.js']) assert.doesNotMatch(src(f), /backdrop/i, `${f} does not know the ground`)
})

test('the scene stacks the ground under the room canvas on the same pixel grid', () => {
  const scene = src('src/ui/OfficeScene.jsx')
  assert.match(scene, /bleedOf\(/)
  assert.match(scene, /buildBackdrop\(/)
  assert.match(scene, /className="oc-ground"/)
  assert.match(scene, /-ground\.bleed\.l \* S/, 'offset by whole art pixels: same grid as the room')
  assert.match(scene, /-Math\.round\(ground\.bleed\.l \* gback\.k\) \/ dpr/, 'JIT: by whole device pixels when the scale is not one')
  const css = src('src/ui/sceneStyles.js')
  assert.match(css, /\.oc-stage\{[^}]*isolation:isolate/)
  assert.match(css, /\.oc-ground\{[^}]*z-index:-1/)
  assert.match(css, /\.oc-ground\{[^}]*image-rendering:pixelated/)
})

test('whole device pixels only when they waste at most 10 % of the pane', () => {
  const fit = (availW, availH, dpr) => fitScale({ availW, availH, W: 400, H: 300, dpr }).scale
  assert.equal(fit(900, 900, 2), 2.2, 'exact 2.25: whole 2 would waste 11 %: fill (2.2)')   // was 2 with the 20 % threshold
  assert.equal(fit(850, 900, 1), 2, 'exact 2.125: whole 2 wastes 6 %: kept')
  assert.equal(fit(1000, 900, 1), 2.5, 'exact 2.5: whole 2 would waste 20 %: fill (was 2)')
  assert.equal(fit(790, 900, 1), 1.9, 'unchanged: exact 1.975, whole 1 wastes 49 %')
  assert.equal(fit(400, 300, 1), 1, 'exact: whole')
})
}
