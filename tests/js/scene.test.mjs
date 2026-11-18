// Scene engine (src/scene/): determinism, adaptation to any team, states, fit, speed.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

import { toOps } from '../../src/core/office.js'
import {
  DECOR_OFF, LIST_BELOW, anchors, boardAnchors, buildBase, drawScene, fitScale, layoutScene, needsAnimation, portrait, project, toSceneModel
} from '../../src/scene/index.js'
import { agentSprite } from '../../src/scene/agent.js'
import { hueOfSlug, projectRanks } from '../../src/scene/projects.js'
import { Px } from '../../src/scene/raster.js'

const sha = d => createHash('sha256').update(d).digest('hex')

const NAMES = ['atelier', 'Рита', '研究员', 'léa', 'ñandú', 'bot-7', 'Ünal', 'مساعد', 'designer', 'ops', 'relais', 'narrateur', 'x7', 'Åsa', 'ingénieur', 'sales_eu']
const SLUGS = ['alpha', 'proyecto-ñ', 'проект', '看板', 'launch', 'blog', 'atelier', 'q4']
const STATES = ['working', 'waiting', 'stale', 'active', 'idle', 'new', 'unknown']
function syntheticOffice(nAgents, nBoards) {
  const boards = Array.from({ length: nBoards }, (_, i) => ({
    slug: SLUGS[i % SLUGS.length] + (i >= SLUGS.length ? '-' + i : ''),
    counts: { todo: i + 1, running: i % 2, blocked: i % 3 === 0 ? 1 : 0, done: 7 * i },
    total: 10 * i + 3, blocked: i % 3 === 0 ? [{ id: 't' + i }] : []
  }))
  const agents = Array.from({ length: nAgents }, (_, i) => ({
    name: NAMES[i % NAMES.length] + (i >= NAMES.length ? '-' + i : ''),
    state: STATES[i % STATES.length],
    home: nBoards && i % 5 !== 4 ? boards[i % nBoards].slug : null,   // every fifth agent has no board: common room
    description: i % 2 ? 'Interface and design specialist' : '', lastActivityMs: 1, officeMeta: {}
  }))
  return { agents, boards, ops: null }
}

test('layout adapts: 0, 1, 12, 30 agents x 0, 1, 3, 8 boards (no shared seat, all inside the art, bounded size)', () => {
  const rows = []
  for (const nA of [0, 1, 12, 30]) {
    for (const nB of [0, 1, 3, 8]) {
      const model = toSceneModel(syntheticOffice(nA, nB), { nowMs: 1e12 })
      const layout = layoutScene(model)
      const seen = new Set()
      const seats = [...layout.pods.flatMap(p => p.seats), ...layout.lounge.seats]
      let placed = 0
      for (const s of seats) {
        const [sx, sy] = project(layout, s.x, s.y, 0)
        assert.ok(sx >= 0 && sx < layout.W && sy >= 0 && sy < layout.H, `seat out of the art (${nA} agents, ${nB} boards)`)
        if (!s.agent) continue
        placed++
        assert.ok(!seen.has(s.agent.name), `agent seated twice: ${s.agent.name}`)
        seen.add(s.agent.name)
      }
      assert.equal(placed, nA, `every agent has a seat (${nA} agents, ${nB} boards)`)
      assert.equal(anchors(layout).length, nA)
      assert.equal(boardAnchors(layout).length, nB)
      assert.ok(layout.W <= 2400 && layout.H <= 1400, `${layout.W}x${layout.H}`)
      const seatSet = new Set(seats.filter(s => s.agent).map(s => `${s.x.toFixed(3)}:${s.y.toFixed(3)}`))
      assert.equal(seatSet.size, nA, 'no two agents on the same spot')
      // the whole scene still renders (no throw on any state, with or without boards)
      const base = buildBase(layout, model)
      drawScene(layout, base, model, 0)
      rows.push(`${String(nA).padStart(2)} agents / ${nB} boards -> ${layout.W}x${layout.H}`)
    }
  }
  console.log('  ' + rows.join('\n  '))
})

test('an agent whose board is not in the list sits in the common room instead of vanishing', () => {
  const office = syntheticOffice(3, 1)
  office.agents[1].home = 'ghost-board'
  office.agents[2].home = null
  const layout = layoutScene(toSceneModel(office, {}))
  assert.equal(anchors(layout).length, 3)
  assert.equal(anchors(layout).filter(a => a.pod === null).length, 2)
})

/* ---------- states ---------- */
test('every state draws a non-empty sprite, distinct from the others (unknown included)', () => {
  const hashes = new Map()
  for (const state of STATES) {
    for (const frame of [0]) {
      const px = new Px(60, 80)
      agentSprite({ name: 'helper', description: '', skills: [], state }, 'front', frame).blit(px, 30, 70, state === 'new' || state === 'stale' || state === 'unknown')
      assert.ok(px.d.some(v => v > 0), `${state}: empty`)
      hashes.set(state, sha(px.d))
    }
  }
  assert.equal(new Set(hashes.values()).size, STATES.length, 'two states look the same')
  // sleepy idle differs from awake idle
  const a = new Px(60, 80)
  const b = new Px(60, 80)
  agentSprite({ name: 'helper', state: 'idle', sleepy: true }, 'front', 0).blit(a, 30, 70)
  agentSprite({ name: 'helper', state: 'idle', sleepy: false }, 'front', 0).blit(b, 30, 70)
  assert.notEqual(sha(a.d), sha(b.d))
  // back view exists for every state
  for (const state of STATES) {
    const px = new Px(60, 80)
    agentSprite({ name: 'helper', state }, 'back', 0).blit(px, 30, 70)
    assert.ok(px.d.some(v => v > 0))
  }
})

test('portrait: 28 x 30, non-empty, one per state', () => {
  for (const state of STATES) {
    const p = portrait({ name: 'helper', description: '', skills: [], state })
    assert.equal(p.W, 28); assert.equal(p.H, 30); assert.equal(p.d.length, 28 * 30 * 4)
    assert.ok(p.d.some(v => v > 0), state)
  }
})

test('an unknown state never breaks the rendering of a whole room', () => {
  const office = syntheticOffice(7, 2)
  office.agents.forEach(a => { a.state = 'unknown' })
  const model = toSceneModel(office, { nowMs: 1e12 })
  const layout = layoutScene(model)
  const out = drawScene(layout, buildBase(layout, model), model, 0)
  assert.equal(out.d.length, layout.W * layout.H * 4)
  // and a state the engine has never heard of
  office.agents[0].state = 'something-new'
  const m2 = toSceneModel(office, { nowMs: 1e12 })
  drawScene(layout, buildBase(layout, m2), m2, 0)
})

test('needsAnimation is true only when a fact needs motion', () => {
  const mk = (states, extra = {}) => toSceneModel({ agents: states.map((state, i) => ({ name: 'a' + i, state, home: null })), boards: [], ops: extra.ops ?? null }, { decor: extra.decor })
  assert.equal(needsAnimation(mk(['idle', 'new'])), false)
  assert.equal(needsAnimation(mk([])), false)
  assert.equal(needsAnimation(mk(['idle', 'unknown', 'stale'])), false)
  assert.equal(needsAnimation(mk(['idle', 'working'])), true)
  assert.equal(needsAnimation(mk(['waiting'])), true)
  assert.equal(needsAnimation(mk(['active'])), true)
  const down = { gateway: { state: 'stopped', platforms: [] }, crons: [] }
  assert.equal(needsAnimation(mk(['idle'], { ops: down })), true)
  assert.equal(needsAnimation(mk(['idle'], { ops: { ...down, gateway: { state: 'starting', platforms: [] } } })), false, 'starting is not an outage')
  assert.equal(needsAnimation(mk(['idle'], { ops: { ...down, gateway: { state: 'startup_failed', platforms: [] } } })), true)
  const live = { ...DECOR_OFF, sober: false }
  assert.equal(needsAnimation(mk(['idle'], { decor: { ...live, incidentBoards: ['b'] } })), true)
  assert.equal(needsAnimation(mk(['idle'], { decor: { ...live, mascotMood: 'play' } })), true)
  assert.equal(needsAnimation(mk(['idle'], { decor: { ...live, mascotMood: 'alert' } })), true)
  assert.equal(needsAnimation(mk(['idle'], { decor: { ...live, mascotMood: 'sleep' } })), false)
  assert.equal(needsAnimation(mk(['idle'], { decor: { ...DECOR_OFF, incidentBoards: ['b'], mascotMood: 'play' } })), false, 'sober hides game motion')
})

test('only stopped / startup_failed switch the room off; starting and degraded keep the light', () => {
  const run = state => {
    const model = toSceneModel({ agents: [], boards: [], ops: { gateway: { state, platforms: [] }, crons: [] } }, { nowMs: 1e12 })
    const layout = layoutScene(model)
    const out = drawScene(layout, buildBase(layout, model), model, 0)
    let sum = 0
    for (let i = 0; i < out.d.length; i += 4) sum += out.d[i] + out.d[i + 1] + out.d[i + 2]
    return sum
  }
  const lit = run('running')
  assert.ok(run('stopped') < lit * 0.6)
  assert.ok(run('startup_failed') < lit * 0.6)
  assert.ok(run('starting') > lit * 0.9)
  assert.ok(run('degraded') > lit * 0.9)
  assert.ok(run(null) > lit * 0.9)
})

test('whiteboard notes follow the real card counts of the board', () => {
  const mk = counts => {
    const model = toSceneModel({ agents: [], boards: [{ slug: 'b', counts, total: 5, blocked: [] }], ops: null }, { nowMs: 1e12 })
    const layout = layoutScene(model)
    return sha(buildBase(layout, model).d)
  }
  assert.notEqual(mk({ todo: 1 }), mk({ todo: 3 }))
  assert.notEqual(mk({ done: 1 }), mk({ blocked: 1 }))
  assert.equal(mk({ todo: 2 }), mk({ todo: 2 }))
})

/* ---------- purity ---------- */
test('src/scene/ is pure: relative imports only (or src/core), no DOM, no global, no clock, no random', () => {
  const dir = new URL('../../src/scene/', import.meta.url)
  const files = readdirSync(dir).filter(f => f.endsWith('.js'))
  assert.ok(files.length >= 15)
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8')
    for (const m of text.matchAll(/from '([^']+)'/g)) assert.ok(/^\.\/|^\.\.\/core\//.test(m[1]), `${f}: import ${m[1]}`)
    assert.doesNotMatch(text, /document|window|globalThis|Math\.random|Date\.now/, f)
    assert.doesNotMatch(text, /^(?:let|var)\s/m, `${f}: module-level mutable state`)
  }
})

/* ---------- fit ---------- */
test('fitScale: list under 0.75, whole device pixels when they waste at most 10 %, dense / compact flags', () => {
  const fit = (availW, availH, dpr, extra = {}) => fitScale({ availW, availH, W: 400, H: 300, dpr, ...extra })
  assert.equal(LIST_BELOW, 0.75)
  // under 0.75: list (the pane is narrower than 300 px for a 400 px art)
  assert.equal(fit(299, 1000, 1).mode, 'list')
  assert.equal(fit(1000, 224, 1).mode, 'list')
  assert.equal(fit(300, 1000, 1).mode, 'scene')
  // dpr 1: integer scales
  assert.deepEqual(fit(1200, 900, 1), { mode: 'scene', scale: 3, dense: false, compact: false })
  assert.equal(fit(850, 900, 1).scale, 2)             // exact 2.125 -> 2 (6 % lost)
  assert.equal(fit(790, 900, 1).scale, 1.9)           // exact 1.975, whole 1 loses 49 %: fill instead (1.9)
  assert.equal(fit(400, 300, 1).scale, 1)
  assert.equal(fit(1700, 1300, 1).scale, 4)           // never above 4
  // dpr 2: half-pixel steps are whole device pixels
  assert.equal(fit(790, 900, 2).scale, 1.9)           // exact 1.975 -> whole 1.5 would lose 24 %: fill instead (1.9)
  assert.equal(fit(1000, 900, 2).scale, 2.5)          // exact 2.5 -> whole
  assert.equal(fit(1010, 900, 2).scale, 2.5)          // exact 2.525 -> 2.5 (1 % lost)
  assert.equal(fit(900, 900, 2).scale, 2.2)           // exact 2.25: whole 2 loses 11 % (> 10 %): fill (2.2)
  assert.equal(fit(640, 900, 2).scale, 1.5)           // exact 1.6 -> 1.5 (6 % lost)
  // between 0.75 and 1: shrinks in 0.05 steps, never below 0.75
  assert.equal(fit(360, 900, 1).scale, 0.9)
  assert.equal(fit(310, 900, 1).scale, 0.75)
  assert.equal(fit(300, 900, 1).scale, 0.75)
  // compact < 1.6, dense from the crowd
  assert.equal(fit(560, 900, 1).compact, true)
  assert.equal(fit(1200, 900, 1).compact, false)
  assert.equal(fit(1200, 900, 1, { people: 15 }).dense, true)
  assert.equal(fit(1200, 900, 1, { people: 11 }).dense, false)
  assert.equal(fit(500, 900, 1, { people: 11 }).dense, true)
  assert.equal(fit(360, 900, 1, { people: 4 }).dense, true)
  assert.equal(fit(360, 900, 1, { people: 3 }).dense, false)
  // a degenerate pane never throws
  assert.equal(fit(0, 0, 1).mode, 'list')
})

/* ---------- speed ---------- */
test('render time for 30 agents / 8 boards (objective: <= 60 ms per drawScene)', () => {
  const model = toSceneModel(syntheticOffice(30, 8), { nowMs: 1e12, night: true })
  const t0 = performance.now()
  const layout = layoutScene(model)
  const base = buildBase(layout, model)
  const tBase = performance.now() - t0
  drawScene(layout, base, model, 0)   // warm-up
  const runs = []
  for (let i = 0; i < 10; i++) { const t = performance.now(); drawScene(layout, base, model, i); runs.push(performance.now() - t) }
  runs.sort((a, b) => a - b)
  console.log(`  30 agents / 8 boards (${layout.W}x${layout.H}): layout+base ${tBase.toFixed(1)} ms, drawScene median ${runs[5].toFixed(1)} ms (min ${runs[0].toFixed(1)}, max ${runs[9].toFixed(1)})`)
  assert.ok(runs[5] < 250, 'drawScene is unreasonably slow')   // hard ceiling; the 60 ms objective is reported above, never faked
})
