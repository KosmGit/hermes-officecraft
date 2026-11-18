// The labels of the scene (what they say, where they sit) and the project filter that washes the scene.
// The 7 setups vary the profiles, the boards (14 cards a board) and the states of agents; the draw of the cards is
// this file's own seeded generator, so what is checked is the SHAPE of each setup.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { foldRank, taskTag } from '../../src/core/hud.js'
import { buildOffice } from '../../src/core/office.js'
import { buildRoster } from '../../src/core/roster.js'
import {
  DECOR_OFF, DOT, WASH_ALPHA, anchors, boardAnchors, buildBase, decorMap, dimOf, drawScene, fitScale, labelOf, labelRank, layoutScene, onCharacters,
  overlappingPairs, placeLabels, podArea, project, spriteBoxes, toSceneModel
} from '../../src/scene/index.js'
import { TH2, TW2 } from '../../src/scene/constants.js'

const NOW = 1_800_000_000_000
const sec = ms => ms / 1000
const DESCS = ['Chief executive: sets priorities.', 'Diseño de interfaces.', 'Backend-Entwicklung: APIs.', 'Revisión de código y seguridad.', 'Rédaction des newsletters.', 'Paid acquisition and SEO.', 'Vendite e partnership.', 'Market research.', 'データ分析', 'Customer support.', 'Contracts and compliance.', 'Facturation, comptabilité.', 'Infrastructure and backups.', 'Product photography.', 'Prepares lessons.', '']
const NAMES = ['ceo', 'diseñadora', 'entwickler', 'revisora', 'autrice', 'growth', 'vendite', 'analyst', 'データ係', 'support', 'legal', 'tresorier', 'ops', 'photographer', 'tutor', 'x7']

// mulberry32: the same cards on every run
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

function setup(nProfiles, slugs) {
  const rows = Array.from({ length: nProfiles }, (_, i) => ({
    name: NAMES[i % NAMES.length] + (i < NAMES.length ? '' : String(i)),
    description: DESCS[i % DESCS.length],
    last_session: i % 3 === 0 ? { id: `s${i}`, source: 'desktop', last_active: sec(NOW - 300_000 * (i + 1)) } : null,
    worker_session: i % 4 === 1 ? { id: `w${i}`, source: 'kanban', last_active: sec(NOW - 30_000) } : null
  }))
  const names = rows.map(r => r.name)
  const boards = slugs.map((slug, j) => {
    const r = rng(slug.split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 7))
    const members = names.filter((_, i) => i % slugs.length === j)
    const kinds = ['done', 'done', 'done', 'done', 'done', 'done', 'todo', 'running', 'blocked', 'ready']
    return {
      slug, createdAt: sec(NOW - (60 - j) * 86_400_000),
      tasks: Array.from({ length: 14 }, (_, k) => {
        const status = kinds[Math.floor(r() * kinds.length)]
        return {
          id: `${slug}-${k}`, title: `T${k + 1} ${slug} task`, status, assignee: members.length ? members[Math.floor(r() * members.length)] : null,
          createdAt: sec(NOW - (14 - k) * 3_600_000), startedAt: sec(NOW - (14 - k) * 3_000_000), heartbeatAt: status === 'running' ? sec(NOW - 20_000) : null
        }
      })
    }
  })
  const desks = buildRoster({ profiles: rows }, NOW)
  return buildOffice(desks, { ok: true, boards, ops: {} }, NOW)
}

export const SETUPS = {
  solo: () => setup(1, []),
  'one-board-12': () => setup(12, ['shop']),
  'multi-8x30': () => setup(30, ['web', 'app', 'api', 'blog', 'sales', 'legal', 'data', 'support']),
  'mixed-langs': () => setup(16, ['studio', 'ops']),
  'no-board-15': () => setup(15, []),
  'big-board-20': () => setup(20, ['factory']),
  'boards-3x5': () => setup(5, ['alpha', 'beta', 'gamma'])
}

/** The page measures a label's width in the DOM; here an estimate of the same label (11 px font, 6.5 px a letter, the padding and the dot). */
const chipSize = ({ name, code }) => ({ w: Math.ceil(7 + 5 + 5 + name.length * 6.5 + (code ? 5 + 10 + code.length * 6.6 : 0) + 4), h: 20 })
const islandSizes = (slug, done, total) => [
  { w: Math.ceil(9 + 8 + 7 + slug.length * 6.6 + 7 + 14 + 7 + `${done}/${total}`.length * 6.6 + 9), h: 24, mode: 'full' },
  { w: Math.ceil(9 + 8 + 7 + slug.length * 6.6 + 7 + `${done}/${total}`.length * 6.6 + 9), h: 24, mode: 'short' },
  { w: DOT + 8, h: 20, mode: 'dot' }
]

function scene(office, { selected = null, stageW = 1000, stageH = 620, night = false } = {}) {
  const model = toSceneModel(office, { nowMs: NOW, night, selected, accent: [61, 123, 253], decor: DECOR_OFF })
  const layout = layoutScene(model)
  const people = layout.pods.reduce((n, p) => n + p.seats.filter(s => s.agent).length, 0) + layout.lounge.seats.length
  const view = fitScale({ availW: stageW, availH: stageH, W: layout.W, H: layout.H, dpr: 1, people })
  return { model, layout, view, people }
}

function place(office, opts = {}) {
  const { model, layout, view } = scene(office, opts)
  if (view.mode !== 'scene') return { layout, view, listed: true }
  const S = view.scale
  const base = buildBase(layout, model)
  const sprites = spriteBoxes(layout)
  const frac = decorMap(layout, base.d)
  const byName = new Map(office.agents.map(a => [a.name, a]))
  const items = anchors(layout).map(a => {
    const ag = byName.get(a.name)
    const lab = labelOf(ag, taskTag(ag, NOW))
    return { name: a.name, ...chipSize(lab), state: ag.state, selected: a.name === opts.selected, lab }
  })
  const bas = boardAnchors(layout)
  const islands = layout.pods.map((p, i) => ({ key: `b:${p.b.slug}`, sizes: islandSizes(p.b.slug, p.b.done, p.b.total), a: [bas[i].sx, bas[i].sy], span: (p.w / 2) * TW2 }))
  const size = { w: layout.W * S, h: layout.H * S }
  const res = placeLabels({ agents: items, islands, sprites, frac, S, size })
  return { layout, view, S, res, items, islands, sprites, size, base }
}

test('a label says the name and the card code, never a count, a time or the state word', () => {
  const run = { state: 'working', label: 'frontend', name: 'frontend', running: [{ title: 'WEB4 — Redesign', startedMs: NOW - 4_620_000 }] }
  assert.deepEqual(labelOf(run, taskTag(run, NOW)), { name: 'frontend', code: 'WEB4' })   // was « frontend WEB4 · 1 h 17 »
  const wait = { state: 'waiting', name: 'support', blocked: [{ title: 'S8.1 x' }, { title: 'S8.2 y' }] }
  assert.deepEqual(labelOf(wait, taskTag(wait, NOW)), { name: 'support', code: 'S8.1' })   // was « support waits · 2 cards »
  const noCode = { state: 'waiting', name: 'default', blocked: [{ title: 'untitled card' }] }
  assert.deepEqual(labelOf(noCode, taskTag(noCode, NOW)), { name: 'default', code: '' }, 'no code, no invented word: the name alone')
  assert.deepEqual(labelOf({ state: 'idle', name: 'x', label: 'Ex' }, null), { name: 'Ex', code: '' })
  for (const l of [labelOf(run, taskTag(run, NOW)), labelOf(wait, taskTag(wait, NOW))]) assert.doesNotMatch(`${l.name} ${l.code}`, /waits|cards?|·|\bmin\b|\bh\b/)
})

test('the order of priority is the one of src/core/hud.js (selected, waits, silent, works, active, name)', () => {
  for (const state of ['waiting', 'stale', 'working', 'active', 'idle', 'new', 'unknown']) for (const selected of [false, true]) assert.equal(labelRank({ state, selected }), foldRank({ state, selected }), `${state} ${selected}`)
})

for (const [name, make] of Object.entries(SETUPS)) {
  for (const stageW of [1000, 760]) {
    test(`${name} @${stageW}px: 0 label on a character, 0 pair of labels that overlap, nothing raw`, () => {
      const office = make()
      const r = place(office, { stageW, stageH: 560 })
      if (r.listed) return assert.equal(r.view.mode, 'list', 'a pane too small for the art is the list (fitScale), not a broken scene')
      const rects = r.res.placed
      assert.deepEqual(overlappingPairs(rects), [], 'overlapping pairs')
      assert.deepEqual(onCharacters(rects, r.sprites, r.S), [], 'labels on a character')
      assert.equal(r.res.agents.size, r.items.length, 'every agent has a place: its label or its dot')
      assert.equal(r.res.islands.size, r.layout.pods.length, 'every island has its label')
      for (const p of rects.filter(q => q.kind !== 'dot')) assert.ok(p.x0 >= 0 && p.y0 >= 0 && p.x1 <= r.size.w && p.y1 <= r.size.h, `${p.key} inside the stage`)
      for (const it of r.items) assert.doesNotMatch(`${it.lab.name} ${it.lab.code}`, /waits|cards?|·/)
    })
  }
}

test('the selected label never folds', () => {
  const office = SETUPS['multi-8x30']()
  for (const who of [office.agents[0].name, office.agents[7].name, office.agents[19].name]) {
    const r = place(office, { stageW: 1100, stageH: 640, selected: who })
    if (r.listed) continue
    assert.equal(r.res.agents.get(who).folded, false, `${who} stays full`)
  }
})

test('a label that would cover something folds into its dot; a moved label carries a leader line', () => {
  const office = SETUPS['multi-8x30']()
  const r = place(office, { stageW: 1000, stageH: 600 })
  assert.ok(!r.listed)
  const all = [...r.res.agents.values()]
  assert.ok(all.some(a => !a.folded), 'some labels stay full')
  for (const a of all.filter(x => x.folded)) { assert.equal(Math.round(a.rect.x1 - a.rect.x0), DOT); assert.equal(a.lead, null) }
  for (const [name, a] of r.res.agents) if (!a.folded && a.lead) assert.ok(Number.isFinite(a.lead.x1 + a.lead.y1 + a.lead.x2 + a.lead.y2), name)
})

test('the island label sits on the front edge of its rug and only slides along that edge', () => {
  const office = SETUPS['boards-3x5']()
  const r = place(office, { stageW: 1000, stageH: 560 })
  assert.ok(!r.listed)
  const anchorsOf = boardAnchors(r.layout)
  r.layout.pods.forEach((p, i) => {
    const got = r.res.islands.get(`b:${p.b.slug}`)
    const a = anchorsOf[i]
    const k = (got.edge.x / r.S - a.sx) / TW2
    assert.ok(Math.abs(k) * TW2 <= (p.w / 2) * TW2 + 0.01, `${p.b.slug} stays on its own edge`)
    assert.ok(Math.abs(got.edge.y / r.S - (a.sy + k * TH2)) < 0.01, `${p.b.slug} follows the edge (slope 1/2)`)
    const h = got.rect.y1 - got.rect.y0
    const rowsDown = (got.rect.y0 - (got.edge.y + 7)) / (h + 4)
    assert.ok(Math.abs(rowsDown - Math.round(rowsDown)) < 0.001 && rowsDown >= 0 && rowsDown <= 2, 'the label hangs 7 px under its edge (one row lower when a neighbour is in the way)')
  })
})

test('same input, same placement (stable between polls)', () => {
  const office = SETUPS['mixed-langs']()
  const a = place(office, { stageW: 1000, stageH: 560 })
  const b = place(office, { stageW: 1000, stageH: 560 })
  assert.deepEqual([...a.res.agents.entries()], [...b.res.agents.entries()])
})

test('the decor map: an area outside the art is not decor and does not crash; the wall of a board is', () => {
  const office = SETUPS['one-board-12']()
  const { model, layout } = scene(office)
  const base = buildBase(layout, model)
  const frac = decorMap(layout, base.d)
  assert.equal(frac({ x0: -9999, y0: -9999, x1: -9990, y1: -9990 }), 0)
  const p = layout.pods[0]
  const [wx, wy] = project(layout, p.wx0 + p.ww / 2, 0, 48)   // the whiteboard on the back wall
  assert.ok(frac({ x0: wx - 6, y0: wy - 3, x1: wx + 6, y1: wy + 3 }) > 0.5, 'a whiteboard counts as decor')
  const [fx, fy] = project(layout, layout.X - 1, layout.Y - 1, 0)   // front corner of the floor
  assert.ok(frac({ x0: fx - 6, y0: fy - 2, x1: fx + 6, y1: fy + 2 }) < 0.5, 'bare floor is not decor')
})

/* ---------- the project filter washes the scene ---------- */

test('dimOf: with a project chosen, the other islands and the common room are washed; no filter or an unknown project: nothing', () => {
  const layout = layoutScene(toSceneModel(SETUPS['boards-3x5'](), { nowMs: NOW, decor: DECOR_OFF }))
  assert.deepEqual(dimOf('beta', layout), { boards: ['alpha', 'gamma'], hall: true })
  assert.equal(dimOf(null, layout), null)
  assert.equal(dimOf('', layout), null)
  assert.equal(dimOf('nope', layout), null, 'a project the scene does not know washes nothing (the lists still filter)')
})

test('drawScene washes only the islands the filter names, towards the room\'s own neutral, and nothing without a filter', () => {
  const office = SETUPS['boards-3x5']()
  const model = toSceneModel(office, { nowMs: NOW, night: false, selected: null, accent: [61, 123, 253], decor: DECOR_OFF })
  const layout = layoutScene(model)
  const base = buildBase(layout, model)
  const plain = drawScene(layout, base, model, 0).d
  const none = drawScene(layout, base, { ...model, dim: null }, 0).d
  assert.deepEqual(Buffer.from(none), Buffer.from(plain), 'no filter: the same pixels')
  const dim = dimOf('alpha', layout)
  const washed = drawScene(layout, base, { ...model, dim }, 0).d
  const moved = (a, b, test) => {
    let n = 0
    let lighter = 0
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue
      const x = (i / 4) % layout.W
      const y = Math.floor(i / 4 / layout.W)
      if (!test(x + 0.5, y + 0.5)) continue
      n++
      if (b[i] + b[i + 1] + b[i + 2] > a[i] + a[i + 1] + a[i + 2]) lighter++
    }
    return { n, lighter }
  }
  const alpha = podArea(layout, layout.pods.find(p => p.b.slug === 'alpha'))
  const gamma = podArea(layout, layout.pods.find(p => p.b.slug === 'gamma'))
  const onGamma = moved(plain, washed, gamma.inFloor)
  assert.ok(onGamma.n > 400, `the washed island changed (${onGamma.n} px)`)
  assert.ok(onGamma.lighter > onGamma.n * 0.5, 'by day the wash lightens')
  // only gamma washed (alpha is two islands away): the alpha island, its desks and its characters are untouched
  const gammaOnly = drawScene(layout, base, { ...model, dim: { boards: ['gamma'], hall: false } }, 0).d
  assert.equal(moved(plain, gammaOnly, alpha.inFloor).n, 0, 'an island the filter keeps is untouched')
  assert.equal(moved(plain, gammaOnly, (x, y) => x >= alpha.box.x0 && x <= alpha.box.x1 && y >= alpha.box.y0 + 30 && y <= alpha.box.y1).n, 0, 'nor its characters')
  const hallOnly = drawScene(layout, base, { ...model, dim: { boards: [], hall: true } }, 0).d
  assert.equal(moved(plain, hallOnly, gamma.inFloor).n, 0, 'the common-room wash leaves the islands alone')
  assert.ok(WASH_ALPHA > 0.3 && WASH_ALPHA < 0.8, 'dimmed, never hidden')
  const nm = { ...model, night: true }
  const nb = buildBase(layout, nm)
  const np = drawScene(layout, nb, nm, 0).d
  const nw = drawScene(layout, nb, { ...nm, dim }, 0).d
  let darker = 0
  let lighter = 0
  for (let i = 0; i < np.length; i += 4) { const a = np[i] + np[i + 1] + np[i + 2]; const b = nw[i] + nw[i + 1] + nw[i + 2]; if (b < a) darker++; else if (b > a) lighter++ }
  assert.ok(darker > lighter * 2, 'by night the wash darkens')
})

test('the wash stays inside the 60 ms budget of drawScene on 30 agents (median of 5)', () => {
  const office = SETUPS['multi-8x30']()
  const model = toSceneModel(office, { nowMs: NOW, night: false, selected: null, accent: [61, 123, 253], decor: DECOR_OFF })
  const layout = layoutScene(model)
  const base = buildBase(layout, model)
  const dim = dimOf('web', layout)
  drawScene(layout, base, { ...model, dim }, 0)
  const times = []
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); drawScene(layout, base, { ...model, dim }, i); times.push(performance.now() - t0) }
  times.sort((a, b) => a - b)
  assert.ok(times[2] < 60, `median ${times[2].toFixed(1)} ms`)
})
