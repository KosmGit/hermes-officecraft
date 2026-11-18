import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { agentSprite } from '../../src/scene/agent.js'
import { buildBase, drawScene, layoutScene, needsAnimation, project, toSceneModel } from '../../src/scene/index.js'
import { CARDS_MAX, PILE_MAX, drawPile, pileOf, pileRow, pileTip, cupOff } from '../../src/scene/pile.js'
import { Px, box } from '../../src/scene/raster.js'
import { deskProps } from '../../src/scene/furniture.js'
import { TD, DESK_Z } from '../../src/scene/constants.js'
import { en } from '../../src/i18n/en.js'
import { es } from '../../src/i18n/es.js'
import { fr } from '../../src/i18n/fr.js'
import { PAL, lookOf } from '../../src/scene/palette.js'
import { PROJECT_HUES } from '../../src/scene/projects.js'

// ===== scene-pile =====
{
// The pile of folders on the desk of a bot that runs several cards — one folder per card beyond the first, 3 at most, front row
// only, never drawn under `classic`, never animated, never over the bot, its outline or its floor ring. Measured on the pixels of drawScene.
const NOW = 1_794_930_000_000
const NAMES = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5']   // 6 members, 3 columns: b0..b2 sit in the back row (facing us), b3..b5 in the front row
const card = (n, k, o = {}) => ({ id: `${n}_${k}`, board: 'x', title: `X-${k + 1} — t`, status: 'running', startedMs: NOW - (50 - k) * 60_000, heartbeatMs: NOW - 60_000, ...o })
/** The office of buildOffice: every agent runs one card, `who` runs `cards` (state `state`). */
const office = (who, cards, state = 'working', o = {}) => ({
  agents: NAMES.map(n => {
    const mine = n === who
    const running = Array.from({ length: mine ? cards : 1 }, (_, k) => card(n, k, mine && o.quietAll ? { heartbeatMs: NOW - 40 * 60_000 } : {}))
    return { name: n, label: n, state: mine ? state : 'working', home: 'x', running, quiet: mine && o.quietAll ? running : [], blocked: [], lastActivityMs: NOW - 60_000 }
  }),
  boards: [{ slug: 'x', counts: {}, total: 0, done: 0, blocked: [] }],
  ops: null
})
const PROFILES = Object.fromEntries(NAMES.map((n, i) => [n, { skills: [[{ name: 'docker' }, { name: 'arxiv' }], [{ name: 'figma' }, { name: 'email' }], [{ name: 'seo' }, { name: 'notes' }]][i % 3] }]))
function render(o, extras = {}, selected = null) {
  const model = toSceneModel(o, { nowMs: NOW, profiles: PROFILES, ...extras })
  model.markers = false
  if (selected) model.selected = selected
  const layout = layoutScene(model)
  const base = buildBase(layout, model)
  return { model, layout, base, img: drawScene(layout, base, model, 0) }
}
/** Pixels that differ between two renders (indices into W*H). */
function diff(a, b) {
  assert.equal(a.img.d.length, b.img.d.length)
  const out = []
  for (let i = 0; i < a.img.d.length; i += 4) if (a.img.d[i] !== b.img.d[i] || a.img.d[i + 1] !== b.img.d[i + 1] || a.img.d[i + 2] !== b.img.d[i + 2]) out.push(i / 4)
  return out
}
const seatOf = (r, name) => r.layout.pods.flatMap(p => p.seats).find(s => s.agent?.name === name)
/**
 * The pixels of `who`'s pile (its folders and their ink ring) that the scene shows — the pile drawn alone with the room's light,
 * kept where the scene has that very colour. A front desk with a pile has no cup, so the difference with the same desk at
 * 1 card also holds the cup that went: the pile is measured on its own pixels, the cup on `cupPx`.
 */
function pileSeen(r, who) {
  const s = seatOf(r, who)
  const p = r.layout.pods.find(q => q.seats.includes(s))
  const q = new Px(r.img.W, r.img.H, r.layout.origin.ox, r.layout.origin.oy); q.L = r.base.L
  drawPile(q, s.x, p.y0, s.row, pileOf(s.agent))
  const out = []
  for (let i = 0; i < r.img.W * r.img.H; i++) if (q.d[i * 4 + 3] && q.d[i * 4] === r.img.d[i * 4] && q.d[i * 4 + 1] === r.img.d[i * 4 + 1] && q.d[i * 4 + 2] === r.img.d[i * 4 + 2]) out.push(i)
  return out
}
/** The pixels of `who`'s cup and of its steam (frame 0): what deskProps draws with the cup and not without, on a grey buffer (the steam is white). */
function cupPx(r, who) {
  const s = seatOf(r, who)
  const p = r.layout.pods.find(q => q.seats.includes(s))
  const at = noCup => { const q = new Px(r.img.W, r.img.H, r.layout.origin.ox, r.layout.origin.oy); q.d.fill(64); deskProps(q, s.x, p.y0 + TD - 0.36, s.agent, s.row, false, 0, noCup); return q.d }
  const a = at(false), b = at(true), out = new Set()
  for (let i = 0; i < r.img.W * r.img.H; i++) if (a[i * 4] !== b[i * 4] || a[i * 4 + 1] !== b[i * 4 + 1] || a[i * 4 + 2] !== b[i * 4 + 2]) out.add(i)
  return out
}

test('the scene model carries the number of running cards and of silent ones, capped, counts only', () => {
  const m = toSceneModel(office('b3', 12, 'working', { quietAll: true }), { nowMs: NOW })
  const a = m.agents.find(x => x.name === 'b3')
  assert.equal(a.cards, CARDS_MAX)
  assert.equal(a.quietCards, CARDS_MAX)
  assert.equal(m.agents.find(x => x.name === 'b0').cards, 1)
  assert.equal(toSceneModel({ agents: [{ name: 'z', state: 'idle', home: null }], boards: [], ops: null }, { nowMs: NOW }).agents[0].cards, 0)
  // no title, no id reaches the pile: the counts only
  assert.ok(!JSON.stringify(m.agents.map(x => [x.cards, x.quietCards])).includes('X-'))
})

test('pileOf: one folder per card beyond the first, 3 at most; none at rest, new, offline or with no card', () => {
  const at = (state, cards) => pileOf({ state, cards })
  assert.deepEqual([0, 1, 2, 3, 4, 12].map(n => at('working', Math.min(n, CARDS_MAX))), [0, 0, 1, 2, 3, 3])
  for (const s of ['working', 'waiting', 'stale', 'active']) assert.equal(at(s, 3), 2, s)
  for (const s of ['idle', 'new', 'offline']) assert.equal(at(s, 4), 0, s)
  assert.equal(pileOf(null), 0)
  assert.equal(PILE_MAX, 3)
  assert.equal(pileRow(1), true)
  assert.equal(pileRow(0), false)
})

test('front row: 1 card draws nothing; 2, 3, 4 cards draw 1, 2, 3 folders (more pixels each time); 12 cards draw the same as 4', () => {
  const r = n => render(office('b4', n))
  const one = r(1)
  assert.equal(seatOf(one, 'b4').row, 1)
  // 1 card = the same desk as an agent whose model carries no count at all
  const bare = toSceneModel(office('b4', 1), { nowMs: NOW, profiles: PROFILES }); bare.markers = false
  for (const a of bare.agents) delete a.cards
  const L = layoutScene(bare)
  assert.equal(diff(one, { img: drawScene(L, buildBase(L, bare), bare, 0) }).length, 0)
  const counts = [2, 3, 4].map(n => diff(r(n), one).length)
  assert.ok(counts[0] > 0 && counts[0] < counts[1] && counts[1] < counts[2], counts.join(' < '))
  assert.equal(diff(r(12), r(4)).length, 0)
})

test('the sheets of the pile are not the colour of the desk they lie on (a pile whose paper is the desk reads as loose violet dashes)', () => {
  const rgb = (r, i) => [r.img.d[i * 4], r.img.d[i * 4 + 1], r.img.d[i * 4 + 2]]
  for (const who of ['b3', 'b4', 'b5']) {
    const one = render(office(who, 1))
    for (const n of [2, 3, 4]) {
      const px = pileSeen(render(office(who, n)), who)
      // the desk top = the lightest thing the pile hides; a pile pixel within 20 levels of it on every channel is lost on the desk
      const desk = px.map(i => rgb(one, i)).reduce((a, b) => (b[0] + b[1] + b[2] > a[0] + a[1] + a[2] ? b : a))
      const r = render(office(who, n))
      const lost = px.filter(i => rgb(r, i).every((v, k) => Math.abs(v - desk[k]) <= 20)).length
      // only the lit top of a sheet where it sticks out may be that white: a pixel or so per folder, never the edges between two covers
      assert.ok(lost <= n, `${who}, ${n} cards: ${lost} px of ${px.length} are the colour of the desk`)
    }
  }
})

test('the pile is one column: the same width whatever the number of folders, 2 px taller per folder, no hole in it', () => {
  for (const who of ['b3', 'b4', 'b5']) {
    const one = render(office(who, 1))
    const boxes = [2, 3, 4].map(n => {
      const r = render(office(who, n))
      const px = pileSeen(r, who), W = r.img.W
      const xs = px.map(i => i % W), ys = px.map(i => Math.floor(i / W))
      const b = { w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1, n: px.length }
      assert.ok(b.n >= 0.5 * b.w * b.h, `${who}, ${n} cards: ${b.n} px in a box of ${b.w}×${b.h}: the folders are spread, not piled`)
      return b
    })
    // 1 px of slack: a pixel of the pile that happens to have the colour of what it hides is not in the diff
    assert.ok(Math.max(...boxes.map(b => b.w)) - Math.min(...boxes.map(b => b.w)) <= 1, `${who}: the pile widens with the folders (${boxes.map(b => b.w)})`)
    assert.deepEqual(boxes.map(b => b.h - boxes[0].h), [0, 2, 4], `${who}: heights ${boxes.map(b => b.h)}`)
  }
})

test('back row (the bot facing us): no pile at 2, 3, 4 cards — the same pixels as the same desk at 1 card', () => {
  const one = render(office('b1', 1))
  assert.equal(seatOf(one, 'b1').row, 0)
  for (const n of [2, 3, 4, 12]) assert.equal(diff(render(office('b1', n)), one).length, 0, `${n} cards`)
  for (const s of ['waiting', 'stale', 'active']) assert.equal(diff(render(office('b1', 4, s)), render(office('b1', 1, s))).length, 0, s)
})

test('no pile at rest, for a new bot (a jacket on an empty chair), offline, and none under classic', () => {
  for (const s of ['idle', 'new', 'offline']) assert.equal(diff(render(office('b4', 4, s)), render(office('b4', 1, s))).length, 0, s)
  assert.equal(diff(render(office('b4', 4), { classic: true }), render(office('b4', 1), { classic: true })).length, 0, 'classic')
})

/** Every pixel of every bot's sprite, grown by 2 px (its state outline), in the frame of `r`. */
function botsMask(r) {
  const W = r.img.W
  const near = new Set()
  for (const s of r.layout.pods.flatMap(p => p.seats)) {
    if (!s.agent) continue
    const spr = agentSprite(s.agent, s.row ? 'back' : 'front', 0, undefined, { art: true, marker: false })
    const [ax, ay] = project(r.layout, s.x, s.y, 9).map(Math.round)
    for (const k of spr.m.keys()) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) near.add((ay + (k >> 9) - 128 + dy) * W + ax + (k & 511) - 256 + dx)
  }
  return near
}

test('the pile never covers a bot (its own or a neighbour), a state outline (2 px ring) or the floor ring, in every state, day and night', () => {
  for (const night of [false, true]) {
    for (const who of ['b3', 'b4', 'b5']) {   // the three front-row seats: left end, middle, right end
      for (const state of ['working', 'waiting', 'stale', 'active']) {
        for (const n of [2, 4]) {
          const o = (c) => { const x = office(who, c, state); x.agents.forEach((a, i) => { if (a.name !== who) a.state = ['waiting', 'working', 'stale', 'active'][i % 4] }); return x }
          const ref = render(o(1), { night }, who)
          const got = render(o(n), { night }, who)
          const ringPx = new Set(diff(ref, render(o(1), { night })))   // the floor ring of the selected bot: what selecting it draws
          assert.ok(ringPx.size > 0)
          const near = botsMask(ref)
          const changed = diff(got, ref)
          const tag = `${night ? 'night' : 'day'} ${who} ${state} ${n}`
          assert.ok(changed.length > 0, `${tag}: a pile is drawn`)
          // what changed is the pile (with its ink ring) and the cup that went, nothing else; the pile seen keeps clear of all
          const pile = pileSeen(got, who), seen = new Set(pile), cup = cupPx(ref, who)
          assert.ok(pile.length > 0, `${tag}: a pile is seen`)
          assert.deepEqual(changed.filter(i => !seen.has(i) && !cup.has(i)), [], `${tag}: something else than the pile and the cup changed`)
          assert.equal(pile.filter(i => near.has(i)).length, 0, `${tag}: pile over a bot or its outline`)
          assert.equal(pile.filter(i => ringPx.has(i)).length, 0, `${tag}: pile over the floor ring`)
        }
      }
    }
  }
})

test('the pile is a state, not an event: needsAnimation does not change with the number of cards', () => {
  for (const s of ['working', 'waiting', 'stale', 'active', 'idle', 'new', 'offline']) {
    const m = c => needsAnimation(toSceneModel(office('b4', c, s), { nowMs: NOW }))
    assert.equal(m(4), m(1), s)
  }
})

test('the tooltip says how many cards the bot runs, for every bot with two or more, pile drawn or not, in the three languages', () => {
  const tr = dict => (k, ...args) => (typeof dict[k] === 'function' ? dict[k](...args) : dict[k])
  for (const [lang, d, word] of [['en', en, '3 cards running'], ['fr', fr, '3 cartes en cours'], ['es', es, '3 tarjetas en curso']]) {
    for (const who of ['b1', 'b4']) {   // back row (no pile) and front row
      for (const state of ['working', 'waiting', 'stale', 'active', 'idle']) {
        const a = office(who, 3, state).agents.find(x => x.name === who)
        const tip = pileTip(a, NOW, tr(d))
        assert.ok(tip.startsWith(word), `${lang} ${who} ${state}: ${tip}`)
        assert.ok(tip.includes('X-1 50 min'), `${lang}: the main card first, with its time: ${tip}`)
      }
    }
    const one = office('b4', 1).agents.find(x => x.name === 'b4')
    assert.equal(pileTip(one, NOW, tr(d)), '')
    const two = office('b1', 2).agents.find(x => x.name === 'b1')   // two cards is already « several »: the first pile, the first tooltip
    assert.ok(pileTip(two, NOW, tr(d)).startsWith('2 ') && pileTip(two, NOW, tr(d)).includes('X-2'), `${lang}: ${pileTip(two, NOW, tr(d))}`)
    const many = office('b4', 12).agents.find(x => x.name === 'b4')
    assert.ok(pileTip(many, NOW, tr(d)).endsWith(' +9'), pileTip(many, NOW, tr(d)))
  }
})

test('src/scene/pile.js stays pure (no SDK, no DOM, no clock) and the tooltip is wired in the scene', () => {
  const src = readFileSync(new URL('../../src/scene/pile.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /plugin-sdk|from 'react'|window\.|document\.|Date\.now|setInterval|requestAnimationFrame/)
  const ui = readFileSync(new URL('../../src/ui/OfficeScene.jsx', import.meta.url), 'utf8')
  assert.match(ui, /cardsTip\(tag, t\) \|\| pileTip\(a, nowMs, t\)/)
})
}

// ===== scene-pile =====
{
// The pile of folders is ringed with the scene's ink, so it stands out in the pod whose hue is its own violet
// (PROJECT_HUES[3] = 268); a front desk that carries a pile has no cup (the cup hid part of a lone folder, and there is no other room for
// it). Nothing changes on a desk without a pile, on the back row, or under classic. Measured on the pixels of drawScene.
const NOW = 1_794_930_000_000
const VIOLET = PROJECT_HUES[3]
assert.equal(VIOLET, 268)
const BOARDS = ['p0', 'p1', 'p2', 'p3']   // creation rank = hue rank: p3 is the violet pod, p2 the amber one (45), p0 the teal one (178)
/** Names whose look carries a cup (mug 0 = red, 1 = white) or a sheet of paper (mug 2): six of each, picked from lookOf. */
const byMug = m => Array.from({ length: 80 }, (_, i) => `bot${i}`).filter(n => lookOf(n).mug === m).slice(0, 6)
const CUPS = [...byMug(0).slice(0, 3), ...byMug(1).slice(0, 3)]
const SHEETS = byMug(2)

/** An office of one pod (board `home`) whose members are `names` (the 3 last sit in the front row); `cards[name]` running cards (1 else). */
function office(home, names, cards = {}, state = 'working', states = {}) {
  return {
    agents: names.map((name, i) => {
      const n = cards[name] ?? 1
      const st = states[name] || state
      const running = Array.from({ length: n }, (_, k) => ({ id: `${name}_${k}`, board: home, title: `X-${k + 1} — t`, status: 'running', startedMs: NOW - (50 - k) * 60_000, heartbeatMs: st === 'stale' ? NOW - 20 * 60_000 : NOW - 60_000 }))
      return { name, label: name, state: st, home, running, quiet: [], blocked: st === 'waiting' ? [{ id: 'w', title: 'W-1 — w' }] : [], lastActivityMs: NOW - 60_000 }
    }),
    boards: BOARDS.map(slug => ({ slug, counts: {}, total: 0, done: 0, blocked: [] })),
    ops: null
  }
}
function render(o, extras = {}) {
  const model = toSceneModel(o, { nowMs: NOW, profiles: {}, ...extras })
  model.markers = false
  if (extras.selected) model.selected = extras.selected
  const layout = layoutScene(model)
  const base = buildBase(layout, model)
  return { model, layout, base, img: drawScene(layout, base, model, extras.frame || 0) }
}
const seatOf = (r, name) => r.layout.pods.flatMap(p => p.seats).find(s => s.agent?.name === name)
const podOf = (r, s) => r.layout.pods.find(p => p.seats.includes(s))
/** Names seated in a row (0 = back row, the bot facing us; 1 = front row, seen from behind): seats go by name, not by list order. */
const rowOf = (r, row) => r.layout.pods.flatMap(p => p.seats).filter(s => s.agent && s.row === row).map(s => s.agent.name)
const rgb = (d, i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]
const same = (a, i, b, j = i) => a[i * 4] === b[j * 4] && a[i * 4 + 1] === b[j * 4 + 1] && a[i * 4 + 2] === b[j * 4 + 2]
function diff(a, b) {
  const out = []
  for (let i = 0; i < a.img.d.length / 4; i++) if (!same(a.img.d, i, b.img.d)) out.push(i)
  return out
}
/** `who`'s pile drawn alone: { all: Map(i -> lit colour), ink: Set of its ring's pixels } (the ring = the pixels of PAL.outline unlit). */
function pileAlone(r, who) {
  const s = seatOf(r, who), p = podOf(r, s)
  const lit = new Px(r.img.W, r.img.H, r.layout.origin.ox, r.layout.origin.oy); lit.L = r.base.L
  const raw = new Px(r.img.W, r.img.H, r.layout.origin.ox, r.layout.origin.oy)
  drawPile(lit, s.x, p.y0, s.row, pileOf(s.agent)); drawPile(raw, s.x, p.y0, s.row, pileOf(s.agent))
  const all = new Map(), ink = new Set()
  for (let i = 0; i < r.img.W * r.img.H; i++) {
    if (!lit.d[i * 4 + 3]) continue
    all.set(i, rgb(lit.d, i))
    if (rgb(raw.d, i).join() === [...PAL.outline].slice(0, 3).join()) ink.add(i)
  }
  return { all, ink, lit }
}
/** Hue (degrees) of a colour, or null when it has none to speak of (grey, ink, near black: chroma under 24 levels). */
function hueOf([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn
  if (c < 24) return null
  const h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4
  return (h * 60 + 360) % 360
}
const nearHue = (c, hue) => { const h = hueOf(c); return h != null && Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue)) < 15 }

test('pod 268: no pixel on the edge of the pile has only neighbours of the pod\'s violet — the ink ring parts it from rug, chairs, partition', () => {
  const names = ['bot13', 'bot15', 'bot17', ...CUPS.slice(0, 3)]
  const fronts = rowOf(render(office('p3', names)), 1)
  assert.equal(fronts.length, 3)
  for (const night of [false, true]) {
    for (const who of fronts) {
      for (const n of [2, 3, 4]) {
        const r = render(office('p3', names, { [who]: n }), { night })
        assert.equal(podOf(r, seatOf(r, who)).hue, VIOLET)
        assert.equal(seatOf(r, who).row, 1)
        const { all, ink, lit } = pileAlone(r, who)
        const W = r.img.W
        const body = new Set([...all.keys()].filter(i => !ink.has(i)))
        const N8 = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1]
        let edge = 0, melted = 0, touching = 0
        for (const i of body) {
          if (N8.every(d => body.has(i + d))) continue
          edge++
          if (N8.every(d => nearHue(rgb(r.img.d, i + d), VIOLET))) melted++
          // the stricter form: a violet pixel of the room (not of the pile) right against a side of an edge pixel (4-neighbour, as the ring)
          if ([-W, -1, 1, W].some(d => !body.has(i + d) && nearHue(rgb(r.img.d, i + d), VIOLET))) touching++
        }
        const tag = `${night ? 'night' : 'day'} ${who}, ${n} cards`
        assert.ok(edge > 10, `${tag}: an edge`)
        assert.equal(melted, 0, `${tag}: ${melted} px of the edge of the pile have only violet around them (they melt into the pod)`)
        assert.equal(touching, 0, `${tag}: ${touching} px of the edge of the pile touch the violet of the room`)
        // and the ring is dark: under a third of the light of the brightest pixel of the pile, wherever it shows
        const top = Math.max(...[...body].map(i => rgb(r.img.d, i).reduce((a, b) => a + b)))
        for (const i of ink) if (same(r.img.d, i, lit.d)) assert.ok(rgb(r.img.d, i).reduce((a, b) => a + b) < top / 3, `${who} ${n}: ring px ${i} not dark (${rgb(r.img.d, i)} vs top ${top})`)
      }
    }
  }
})

/** The keyboard of a front desk drawn alone with the room's light (the one desk object that stands IN FRONT of the pile, by depth). */
function keyboardAlone(r, who) {
  const s = seatOf(r, who), p = podOf(r, s)
  const q = new Px(r.img.W, r.img.H, r.layout.origin.ox, r.layout.origin.oy); q.L = r.base.L
  box(q, s.x - 0.28, p.y0 + TD - 0.36, DESK_Z, 0.56, 0.2, 1, { t: PAL.kbdT, l: PAL.kbd, r: PAL.kbd })   // furniture.js deskProps
  return q
}
/** The pixels of `who`'s cup, with its steam (frame 0) or not: what deskProps draws with the cup and not without, on a grey buffer (white steam). */
function cupPx(r, who, steam = true) {
  const s = seatOf(r, who), p = podOf(r, s)
  const at = noCup => { const q = new Px(r.img.W, r.img.H, r.layout.origin.ox, r.layout.origin.oy); q.d.fill(64); deskProps(q, s.x, p.y0 + TD - 0.36, s.agent, s.row, false, steam ? 0 : null, noCup); return q.d }
  const a = at(false), b = at(true), out = new Set()
  for (let i = 0; i < r.img.W * r.img.H; i++) if (!same(a, i, b)) out.add(i)
  return out
}

test('a lone folder (2 cards) is seen whole beside a bot that has a cup: the cup is gone, only the keyboard before it overlaps its foot', () => {
  for (const [home, hue] of [['p0', 178], ['p2', 45], ['p3', 268]]) {
    for (const night of [false, true]) {
      for (const names of [CUPS, SHEETS]) {   // six bots with a cup, then six with a sheet: three of each sit in the front row
        const ref = render(office(home, names), { night })
        const fronts = rowOf(ref, 1)
        assert.equal(fronts.length, 3)
        for (const who of fronts) {
          const got = render(office(home, names, { [who]: 2 }), { night })
          const s = seatOf(got, who)
          assert.equal(podOf(got, s).hue, hue)
          assert.equal(s.row, 1)
          const tag = `${home} ${night ? 'night' : 'day'} ${who} (mug ${lookOf(who).mug})`
          const { all } = pileAlone(got, who)
          const kb = keyboardAlone(got, who)
          let shown = 0, underKeyboard = 0
          for (const [i] of all) {
            if (same(got.img.d, i, pileAlone(got, who).lit.d)) shown++
            else { assert.ok(kb.d[i * 4 + 3] && same(got.img.d, i, kb.d), `${tag}: pile px ${i} hidden by something else than the keyboard`); underKeyboard++ }
          }
          assert.equal(shown + underKeyboard, all.size)
          // what the keyboard overlaps is the foot of the pile only: the ring and the lowest sheet's edge, never a cover
          assert.ok(underKeyboard <= 12, `${tag}: ${underKeyboard} px of the pile under the keyboard`)
          // the cup and its steam went — or the sheet of paper that some bots keep in its place (mug 2): it lay over the pile's corner too
          const cup = cupPx(ref, who)
          assert.ok(cup.size >= 16, `${tag}: a cup or a sheet at 1 card`)
          assert.equal(cupOff(pileOf(s.agent)), true)
          // every pixel of its body changed (the steam is a light veil: over a white thing it changes nothing)
          const body = cupPx(ref, who, false)
          const kept = [...body].filter(i => same(got.img.d, i, ref.img.d))
          if (lookOf(who).mug < 2) assert.deepEqual(kept, [], `${tag}: the cup is still drawn (${kept.length} of ${body.size} px)`)
          // the sheet is cream on a cream desk: where its lit top has the desk's very colour, taking it away changes nothing
          else assert.ok(kept.length <= body.size / 3, `${tag}: the sheet is still drawn (${kept.length} of ${body.size} px)`)
          // nothing else on the desk moved: what changed is the pile and the cup that went
          const changed = diff(got, ref)
          assert.deepEqual(changed.filter(i => !all.has(i) && !cup.has(i)), [], `${tag}: something else changed`)
        }
      }
    }
  }
})

test('1 card: the same pixels as a model with no count at all, in the teal, amber and violet pods, cup or sheet, day and night, and classic', () => {
  for (const home of ['p0', 'p2', 'p3']) {
    for (const extras of [{}, { night: true }, { classic: true }]) {
      for (const names of [[...SHEETS.slice(0, 3), ...CUPS.slice(0, 3)], [...CUPS.slice(3), ...SHEETS.slice(3)]]) {
        const one = render(office(home, names), extras)
        const bare = toSceneModel(office(home, names), { nowMs: NOW, profiles: {}, ...extras }); bare.markers = false
        for (const a of bare.agents) delete a.cards
        const L = layoutScene(bare)
        assert.equal(diff(one, { img: drawScene(L, buildBase(L, bare), bare, 0) }).length, 0, `${home} ${JSON.stringify(extras)}`)
        // and a front bot with one card keeps its cup
        for (const who of names.slice(3).filter(n => lookOf(n).mug < 2)) {
          const s = seatOf(one, who)
          if (s.row !== 1 || extras.classic) continue
          assert.equal(cupOff(pileOf(s.agent)), false)
          // the cup is in the scene: its body, drawn alone with the room's light, shows with that very colour
          const p = podOf(one, s)
          const lit = new Px(one.img.W, one.img.H, one.layout.origin.ox, one.layout.origin.oy); lit.L = one.base.L
          deskProps(lit, s.x, p.y0 + TD - 0.36, s.agent, 1, false, null, false)
          const body = [...cupPx(one, who, false)]
          assert.ok(body.length >= 16)
          const shown = body.filter(i => same(one.img.d, i, lit.d)).length
          assert.ok(shown >= 0.8 * body.length, `${home} ${who}: the cup of a 1-card bot is not drawn (${shown} of ${body.length} px)`)
        }
      }
    }
  }
})

test('back row (the bot facing us) at 2, 3, 4 cards, cup or not: no pile, the cup stays — the same pixels as at 1 card', () => {
  for (const home of ['p0', 'p3']) {
    for (const night of [false, true]) {
      const names = [...CUPS.slice(0, 3), ...SHEETS.slice(0, 3)]
      const one = render(office(home, names), { night })
      const backs = rowOf(one, 0)
      assert.equal(backs.length, 3)
      assert.ok(backs.some(n => lookOf(n).mug < 2), 'a back-row bot with a cup')
      for (const who of backs) {
        for (const n of [2, 3, 4]) assert.equal(diff(render(office(home, names, { [who]: n }), { night }), one).length, 0, `${home} ${who} ${n}`)
      }
    }
  }
})

/** Every pixel of every bot's sprite grown by 2 px (its state outline), in the frame of `r`. */
function botsMask(r) {
  const W = r.img.W, near = new Set()
  for (const s of r.layout.pods.flatMap(p => p.seats)) {
    if (!s.agent) continue
    const spr = agentSprite(s.agent, s.row ? 'back' : 'front', 0, undefined, { art: true, marker: false })
    const [ax, ay] = project(r.layout, s.x, s.y, 9).map(Math.round)
    for (const k of spr.m.keys()) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) near.add((ay + (k >> 9) - 128 + dy) * W + ax + (k & 511) - 256 + dx)
  }
  return near
}

test('N = 13, a third of the bots on 2 to 4 cards, every state: the ringed piles and the cups that went keep clear of every bot, outline and ring', () => {
  const STATES = ['working', 'waiting', 'stale', 'active']
  for (const night of [false, true]) {
    for (const [k, st] of STATES.entries()) {
      const names = Array.from({ length: 13 }, (_, i) => `bot${i * 3 + k}`)
      const cards = Object.fromEntries(names.filter((_, i) => i % 3 === 0).map((n, j) => [n, 2 + (j % 3)]))
      const states = Object.fromEntries(names.map((n, i) => [n, cards[n] ? st : STATES[(i + k) % 4]]))
      const o = c => { const x = office('p3', names, c, 'working', states); x.agents.forEach((a, i) => { a.home = BOARDS[i % 4]; a.running.forEach(r => { r.board = a.home }) }); return x }
      const multi = [...names].filter(n => cards[n])
      const ref0 = render(o({}), { night })
      const front = multi.filter(n => seatOf(ref0, n)?.row === 1)
      assert.ok(front.length >= 1, 'a front bot with a pile')
      const sel = front[0]
      const ref = render(o({}), { night, selected: sel })
      const got = render(o(cards), { night, selected: sel })
      const ringPx = new Set(diff(ref, ref0))
      assert.ok(ringPx.size > 0)
      const near = botsMask(ref)
      const piles = new Set(), cups = new Set()
      for (const n of front) { for (const [i] of pileAlone(got, n).all) piles.add(i); for (const i of cupPx(ref, n)) cups.add(i) }
      const changed = diff(got, ref)
      const tag = `${night ? 'night' : 'day'} ${st}`
      assert.deepEqual(changed.filter(i => !piles.has(i) && !cups.has(i)), [], `${tag}: something else than the piles and the cups changed`)
      const drawn = changed.filter(i => piles.has(i))
      assert.ok(drawn.length > 0, `${tag}: piles drawn`)
      assert.equal(drawn.filter(i => near.has(i)).length, 0, `${tag}: a pile within 2 px of a bot`)
      assert.equal(drawn.filter(i => ringPx.has(i)).length, 0, `${tag}: a pile over the floor ring`)
    }
  }
})
}
