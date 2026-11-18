import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { test } from 'node:test'
import { LLM_DRAWN, LLM_FEATURES, llmView, toLlm, decorAppliesNow, decorResolveBody, pairsAreSound } from '../../src/core/llm.js'
import { INSTR_MAX, cleanInstructions, isSeatChoice, relaysOfOffice, seatingBody, seatingFor, topRelays } from '../../src/core/seating.js'
import { THOUGHT_EVERY_MS, THOUGHT_MAX, isThought, thoughtGate, thoughtRoles, thoughtsBody, thoughtsShown } from '../../src/core/thoughts.js'
import { MILESTONES_MAX, artBody, isoOf, milestonesOf, pendingMilestones, posterKey, posterTip, postersOf } from '../../src/core/wallart.js'
import { messages } from '../../src/i18n/index.js'
import { MOTIFS, POSTERS_MAX, buildBase, drawScene, hotspots, layoutScene, neighboursOf, normalizePosters, normalizeSeating, posterSlots, relayWeights, seatOrder, toSceneModel } from '../../src/scene/index.js'
import { posterShader } from '../../src/scene/art.js'

// ===== llm-scene =====
{
// Wall art, seating and thought bubbles, in the page.
//  1. wall art: real milestones -> posters (no poster without a milestone, none without a fiche), the engine draws the gilded frame and the motif;
//  2. seating: the hand-offs computed from fake cards = the expected value, the placement is stable, the model's order is a permutation the
//     engine applies, back to the default order = the default layout;
//  3. thought bubbles: none for an agent that does not work, never in sober mode or with a hidden page, at most one request a minute;
//  4. the view as one decision, sober mode, the scene's time, the strings in en / fr / es.
// No real model is called here (a fake `rest`, a fake clock).
const SDK = 'export const useQuery = o => { globalThis.__query = o; return {} }; export const useQueryClient = () => ({ invalidateQueries() {} }); export const randomUuid = () => "00000000-0000-4000-8000-000000000000"'
const REACT = 'export const useRef = v => ({ current: v })'
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === '@hermes/plugin-sdk') return { url: 'data:text/javascript,${encodeURIComponent(SDK)}', shortCircuit: true }
  if (s === 'react') return { url: 'data:text/javascript,${encodeURIComponent(REACT)}', shortCircuit: true }
  return next(s, c)
}`)}`)
const { initLlm } = await import('../../src/data/llm.js')
const { resetThoughtsClock, useThoughts } = await import('../../src/data/thoughts.js')

const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0)
const DAY = 86_400_000

/* ---------- fixtures ---------- */
const ach = (id, extra = {}) => ({ id, unlocked: true, dated: true, unlockedMs: NOW - 5 * DAY, tiered: false, tiers: [], board: null, ...extra })
const GAME = {
  sober: false,
  achievements: [
    ach('chain', { board: 'alpha', unlockedMs: NOW - 2 * DAY }),
    ach('centurion', { board: 'ghost', unlockedMs: NOW - 9 * DAY }),                      // a board the page does not serve: no board in the milestone
    ach('thrifty', { dated: false, unlockedMs: null }),                                   // an aggregate of the whole history: no date, no milestone
    ach('quick', { unlocked: false, dated: false, unlockedMs: null }),                    // locked
    ach('review', { unlocked: false, dated: true, unlockedMs: NOW - DAY }),               // locked, whatever a date field says
    ach('owl', { unlockedMs: NOW + 30 * DAY }),                                           // a future date is not a fact
    ach('zero', { tiered: true, unlockedMs: NOW - 20 * DAY, tiers: [{ tier: 'bronze', at: 5, unlocked: true, ms: NOW - 20 * DAY }, { tier: 'silver', at: 10, unlocked: true, ms: NOW - 8 * DAY }, { tier: 'gold', at: 20, unlocked: false, ms: null }] }),
    ach('hire', { unlockedMs: NOW - 30 * DAY })
  ]
}
const OFFICE = { boards: [{ slug: 'alpha', done: 12, tasks: [] }, { slug: 'beta', done: 3, tasks: [] }], agents: [] }
const POSTER = (motif, sky = '#88aadd', accent = '#cc5533') => ({ poster: { motif, sky, accent }, at: 1 })

const task = (assignee, createdMs, extra = {}) => ({ id: `t${createdMs}${assignee}`, status: 'done', assignee, createdMs, ...extra })
const served = (over = {}) => ({
  ok: true, at: 1, available: true, features: [...LLM_FEATURES],
  settings: { features: { decor: false, outfits: false, art: true, seating: true, thoughts: true }, capUsd: 1, callCap: 300 },
  spend: { month: '2026-11', usd: 0, calls: 0, unpriced: 0, byFeature: {} }, route: { provider: 'p', model: 'm', priced: true },
  fiches: { decor: null, outfits: {}, art: {}, seating: null, thoughts: [] }, sends: {}, costs: {}, ...over
})

/* ---------- 1. wall art ---------- */
test('milestones: only what the history proves and dates, newest first, one per achievement (the highest dated tier)', () => {
  const ms = milestonesOf(GAME, OFFICE, NOW)
  assert.deepEqual(ms.map(m => m.kind), ['chain', 'zero', 'centurion', 'hire'], 'locked, undated and future ones are not milestones; newest first')
  const chain = ms.find(m => m.kind === 'chain')
  assert.deepEqual({ ...chain }, { key: 'chain:-:alpha', kind: 'chain', tier: null, board: 'alpha', cards: 12, ms: NOW - 2 * DAY }, 'the board is served: its real count of cards done')
  const zero = ms.find(m => m.kind === 'zero')
  assert.equal(zero.tier, 'silver', 'the highest tier REACHED (gold is not)')
  assert.equal(zero.ms, NOW - 8 * DAY, 'the date of that tier, not the first one')
  assert.equal(zero.key, 'zero:silver:-')
  assert.equal(ms.find(m => m.kind === 'centurion').board, null, 'a board the page does not serve is dropped (the agent half would refuse it)')
  assert.equal(ms.find(m => m.kind === 'centurion').cards, null)
  assert.deepEqual(milestonesOf({ sober: true, achievements: GAME.achievements }, OFFICE, NOW), [], 'sober: nothing')
  assert.deepEqual(milestonesOf(null, OFFICE, NOW), [])
  assert.deepEqual(milestonesOf({ achievements: [] }, OFFICE, NOW), [], 'no achievement, no milestone')
  assert.equal(posterKey({ kind: 'a', tier: null, board: null }), 'a:-:-')
  assert.equal(isoOf(Date.UTC(2026, 10, 12, 8, 5, 9, 777)), '2026-11-12T08:05:09Z')
  // the page keeps the date of a tier whose own date is missing out of the milestones (nothing invented)
  const undatedTop = { ...GAME, achievements: [ach('zero', { tiered: true, tiers: [{ tier: 'bronze', at: 5, unlocked: true, ms: null }] })] }
  assert.deepEqual(milestonesOf(undatedTop, OFFICE, NOW), [])
})

test('posters: only a real milestone WITH a fiche is hung, never a fiche without a milestone, newest first, at most four', () => {
  const ms = milestonesOf(GAME, OFFICE, NOW)
  const art = { 'chain:-:alpha': POSTER('trophy'), 'zero:silver:-': POSTER('rocket'), 'old:-:-': POSTER('summit') }
  const hung = postersOf(ms, art)
  assert.deepEqual(hung.map(p => p.key), ['chain:-:alpha', 'zero:silver:-'], 'the fiche of a milestone that does not exist (old:-:-) is never drawn')
  assert.equal(hung[0].ms, NOW - 2 * DAY, 'the date comes from the milestone, not from the model')
  assert.deepEqual(postersOf([], art), [], 'no milestone, no poster')
  assert.deepEqual(postersOf(ms, {}), [], 'no fiche, no poster (the generic one stays)')
  assert.deepEqual(postersOf(ms, { 'chain:-:alpha': { poster: { motif: 'dragon', sky: '#88aadd', accent: '#cc5533' } } }), [], 'a motif outside the catalogue')
  assert.deepEqual(postersOf(ms, { 'chain:-:alpha': { poster: { motif: 'trophy', sky: 'blue', accent: '#cc5533' } } }), [], 'a colour that is not #rrggbb')
  const many = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}:-:-`, kind: `k${i}`, tier: null, board: null, ms: NOW - i * DAY }))
  const all = Object.fromEntries(many.map(m => [m.key, POSTER('summit')]))
  assert.equal(postersOf(many, all).length, POSTERS_MAX)
  assert.equal(postersOf(many, all)[0].key, 'k0:-:-')
})

test('the answer of the server is read key by key: a bad poster, order or bubble is dropped, the rest is kept', () => {
  const state = toLlm(served({
    fiches: {
      decor: null, outfits: {},
      art: { 'a:-:-': POSTER('bridge'), 'b:-:-': POSTER('moon'), 'c:-:-': { poster: { motif: 'trophy', sky: '#ABCDEF', accent: '#000000' }, at: 1 }, 'd:-:-': 'x' },
      seating: { pairs: [{ a: 'a', b: 'b', why: 'relay' }, { a: 'b', b: 'c', why: 'instruction' }], at: 5, instructions: 'x'.repeat(900) },
      thoughts: [{ name: 'a', text: 'rereading the diff' }, { name: 'b', text: '<b>x</b>' }, { name: 'c', text: 'see http://x.y' }, { name: 'd', text: '' }, { name: 'e', text: 'x'.repeat(61) }, 7, null]
    }
  }))
  assert.deepEqual(Object.keys(state.fiches.art), ['a:-:-'], 'unknown motif, uppercase hex and a non-object are dropped')
  assert.equal(state.fiches.seating.instructions.length, INSTR_MAX)
  assert.deepEqual(state.fiches.thoughts, [{ name: 'a', text: 'rereading the diff' }], 'markup, a link, empty and too long texts never reach the page')
  assert.equal(toLlm(served({ fiches: { seating: { pairs: [{ a: 'a', b: 'a', why: 'relay' }] } } })).fiches.seating, null, 'an agent with itself: the fiche is not read')
  assert.equal(toLlm(served({ fiches: { seating: { order: ['a', 'b', 'c'] } } })).fiches.seating, null, 'a whole order is no longer a fiche')
  assert.equal(toLlm(served({ fiches: {} })).fiches.seating, null)
  assert.deepEqual(toLlm(served({ fiches: {} })).fiches.thoughts, [])
})

test('the call of the wall art: the milestones without a poster, at most six, an ISO date; nothing to send = no call', () => {
  const ms = milestonesOf(GAME, OFFICE, NOW)
  assert.equal(artBody('id', [], 'fr'), null, 'nothing without a poster: nothing to ask')
  const body = artBody('id1', ms, 'fr')
  assert.deepEqual(Object.keys(body).sort(), ['id', 'lang', 'milestones'], 'the allow-list: closed fields')
  assert.deepEqual(body.milestones[0], { kind: 'chain', tier: null, board: 'alpha', cards: 12, at: isoOf(NOW - 2 * DAY) })
  assert.equal(body.lang, 'fr')
  assert.equal(artBody('i', ms, 'de').lang, 'en')
  const nine = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, kind: `k${i}`, tier: null, board: null, cards: null, ms: NOW - i * DAY }))
  assert.equal(artBody('i', nine, 'en').milestones.length, MILESTONES_MAX)
  for (const m of body.milestones) for (const k of Object.keys(m)) assert.ok(['kind', 'tier', 'board', 'cards', 'at'].includes(k), `${k} is not on the allow-list`)
  // already drawn: not asked again
  const left = pendingMilestones(ms, { 'chain:-:alpha': POSTER('trophy') })
  assert.ok(!left.some(m => m.kind === 'chain') && left.length === ms.length - 1)
})

/* ---------- the engine draws the posters ---------- */
function office(nAgents, nBoards) {
  const boards = Array.from({ length: nBoards }, (_, i) => ({ slug: `b${i}`, counts: { todo: i + 1, running: 1, blocked: 0, done: 5 * i }, total: 10 * i + 3, blocked: [], tasks: [] }))
  const agents = Array.from({ length: nAgents }, (_, i) => ({ name: `agent-${String(i).padStart(2, '0')}`, state: ['working', 'idle', 'waiting'][i % 3], home: nBoards && i % 5 !== 4 ? boards[i % nBoards].slug : null, description: '', lastActivityMs: 1, officeMeta: {} }))
  return { agents, boards, ops: null }
}
const px = (d, W, x, y) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return [d[i], d[i + 1], d[i + 2]] }
const differing = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n }
function render(extras, off = office(6, 2), night = false) {
  const model = toSceneModel(off, { nowMs: 1e12, night, ...extras })
  const layout = layoutScene(model)
  return { model, layout, base: buildBase(layout, model), d: drawScene(layout, buildBase(layout, model), model, 2).d }
}
const P = (key, motif, extra = {}) => ({ key, kind: key.split(':')[0], tier: null, board: null, ms: NOW, motif, sky: '#7fb6e8', accent: '#e76f51', ...extra })

test('the engine hangs a poster per milestone: a gilded frame, the motif, the caption strip; each of the six motifs draws', () => {
  const none = render({ decor: { sober: false } })
  const refs = MOTIFS.map(m => render({ decor: { sober: false, posters: [P('chain:-:alpha', m)] } }))
  for (const [i, r] of refs.entries()) assert.ok(differing(none.d, r.d) > 150, `${MOTIFS[i]} changes the wall`)
  // six motifs, six different pictures (the model's choice is visible)
  for (let i = 0; i < refs.length; i++) for (let j = i + 1; j < refs.length; j++) assert.ok(differing(refs[i].d, refs[j].d) > 20, `${MOTIFS[i]} and ${MOTIFS[j]} look the same`)
  // the colours of the fiche are the poster's colours
  assert.ok(differing(refs[0].d, render({ decor: { sober: false, posters: [P('chain:-:alpha', 'summit', { sky: '#112244' })] } }).d) > 20, 'sky')
  assert.ok(differing(refs[0].d, render({ decor: { sober: false, posters: [P('chain:-:alpha', 'summit', { accent: '#00ff00' })] } }).d) > 0, 'accent')
  // the frame is gold: the decal shader of a slot returns the gold at its border and the cream caption strip above the bottom edge
  const slot = posterSlots(none.layout)[0]
  const shade = posterShader(P('chain:-:alpha', 'summit'))
  const d = { ...slot }
  const gold = shade(slot.s0 + 0.4, slot.z0 + 10, d)
  assert.ok(gold[0] > gold[2] + 40 && gold[1] > gold[2] + 20, `the frame is gilded: ${gold}`)
  const strip = shade(slot.s0 + 8, slot.z0 + 2.5, d)
  assert.ok(strip.every(v => v > 200), `the caption strip is paper: ${strip}`)
})

test('no poster without a milestone: no poster in the model, the generic poster stays; sober mode and the engine ignore bad entries', () => {
  const none = render({ decor: { sober: false } })
  assert.equal(differing(none.d, render({ decor: { sober: false, posters: [] } }).d), 0, 'no poster: the very same pixels as before')
  assert.equal(differing(none.d, render({ decor: { sober: false, posters: [{ key: 'x:-:-', motif: 'summit', sky: '#7fb6e8', accent: '#e76f51' }] } }).d), 0, 'an entry without a date is no milestone: not drawn')
  assert.equal(differing(none.d, render({ decor: { sober: false, posters: [P('x:-:-', 'dragon')] } }).d), 0, 'a motif outside the catalogue')
  assert.equal(differing(none.d, render({ decor: { sober: false, posters: [P('x:-:-', 'summit', { sky: 'red' })] } }).d), 0, 'a colour name')
  assert.equal(differing(render({ decor: { sober: true } }).d, render({ decor: { sober: true, posters: [P('x:-:-', 'summit')] } }).d), 0, 'sober mode draws no poster')
  assert.deepEqual(hotspots(none.layout, none.model).filter(s => s.kind === 'poster'), [])
  const soberRoom = render({ decor: { sober: true, posters: [P('x:-:-', 'summit')] } })
  assert.deepEqual(hotspots(soberRoom.layout, soberRoom.model).filter(s => s.kind === 'poster'), [], 'sober: no zone for a poster that is not drawn')
  assert.equal(normalizePosters('x').length, 0)
  assert.equal(normalizePosters([P('a:-:-', 'summit'), P('a:-:-', 'rocket')]).length, 1, 'a key is hung once')
  assert.equal(normalizePosters(Array.from({ length: 9 }, (_, i) => P(`a${i}:-:-`, 'summit'))).length, POSTERS_MAX)
})

test('a poster has a tooltip zone where it hangs: the milestone and its date, by keyboard too; the poster zones follow the posters', () => {
  const r = render({ decor: { sober: false, posters: [P('chain:-:alpha', 'trophy', { kind: 'chain', board: 'alpha', ms: NOW }), P('zero:silver:-', 'rocket', { kind: 'zero', tier: 'silver', ms: NOW - DAY })] } })
  const spots = hotspots(r.layout, r.model).filter(s => s.kind === 'poster')
  assert.deepEqual(spots.map(s => s.id), ['poster:chain:-:alpha', 'poster:zero:silver:-'])
  const slots = posterSlots(r.layout)
  const { ox, oy } = r.layout.origin
  for (const [i, s] of spots.entries()) {
    const cx = ox + (slots[i].s0 + slots[i].s1) / 2
    const cy = oy + (slots[i].s0 + slots[i].s1) / 4 - (slots[i].z0 + slots[i].z1) / 2
    assert.ok(s.rect.x <= cx && cx <= s.rect.x + s.rect.w && s.rect.y <= cy && cy <= s.rect.y + s.rect.h, `zone ${i} covers its poster`)
    assert.ok(s.rect.w >= 14 && s.rect.h >= 14)
  }
  assert.deepEqual(spots[1].poster, { kind: 'zero', tier: 'silver', board: null, ms: NOW - DAY })
  const tip = posterTip(spots[0].poster, { achName: 'Chain', date: '10 Nov 2026', tierName: '', readClock: '12:00' })
  assert.deepEqual(tip.fact, ['llm.art.fact', 'Chain · alpha', '10 Nov 2026'])
  assert.deepEqual(posterTip(spots[1].poster, { achName: 'Zero', date: 'd', tierName: 'Silver' }).fact, ['llm.art.fact', 'Zero (Silver)', 'd'])
  assert.deepEqual(tip.name, ['llm.art.spot', 'Chain'])
  // the slots never leave the wall and never overlap each other
  for (const s of slots) assert.ok(s.s0 > 0 && s.s1 < r.layout.X * 16, 'on the wall')
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i].s0 >= slots[i - 1].s1, 'slots do not overlap')
})

/* ---------- 2. seating ---------- */
test('relays computed from fake cards = the expected value: two consecutive cards of a board by two different agents', () => {
  const boards = [
    // by creation date (not the order of the list): ana, bob, bob, cleo, ana  -> ana|bob, bob|cleo, ana|cleo
    { tasks: [task('ana', 5), task('cleo', 4), task('bob', 2), task('bob', 3), task('ana', 1), task('', 6), task(null, 7)].reverse() },
    // ana, bob -> ana|bob again
    { tasks: [task('bob', 11), task('ana', 10)] },
    // a lone agent, and one who is not in the roster (zed)
    { tasks: [task('ana', 1), task('ana', 2), task('zed', 3), task('ana', 4)] }
  ]
  // board 1 sorted: ana(1), bob(2), bob(3), cleo(4), ana(5) -> ana|bob, bob|cleo, cleo|ana
  assert.deepEqual(relayWeights(boards), [['ana', 'bob', 2], ['ana', 'zed', 2], ['ana', 'cleo', 1], ['bob', 'cleo', 1]].sort((p, q) => q[2] - p[2] || (p[0] + p[1] < q[0] + q[1] ? -1 : 1)).map(([a, b, n]) => [a < b ? a : b, a < b ? b : a, n]))
  assert.deepEqual(relayWeights(boards, ['ana', 'bob', 'cleo']), [['ana', 'bob', 2], ['ana', 'cleo', 1], ['bob', 'cleo', 1]], 'only the roster counts (the agent half does the same)')
  assert.deepEqual(relayWeights([{ tasks: [task('a', 1), task('a', 2)] }]), [], 'the same agent twice is no relay')
  assert.deepEqual(relayWeights([]), [])
  assert.deepEqual(relayWeights(null), [])
  assert.deepEqual(relayWeights([{ tasks: [task('b', 1), task('a', 2)] }]), [['a', 'b', 1]], 'a pair is a < b, whoever started')
  // the order of the cards is their creation date, not their place in the list
  assert.deepEqual(relayWeights([{ tasks: [task('a', 3), task('b', 1), task('c', 2)] }]), [['a', 'c', 1], ['b', 'c', 1]], 'b, c, a by date')
  // cards without a date keep their list order (0)
  assert.deepEqual(relayWeights([{ tasks: [{ assignee: 'x' }, { assignee: 'y' }, { assignee: 'x' }] }]), [['x', 'y', 2]])
  // the page's own reading of an office
  const off = { agents: [{ name: 'ana' }, { name: 'bob' }], boards: [boards[1]] }
  assert.deepEqual(relaysOfOffice(off), [['ana', 'bob', 1]])
  assert.deepEqual(topRelays([['a', 'b', 3], ['a', 'c', 2]], 1), [{ a: 'a', b: 'b', n: 3 }])
  assert.deepEqual(neighboursOf('ana', [['ana', 'bob', 2], ['ana', 'cleo', 1], ['bob', 'cleo', 5], ['ana', 'dan', 1], ['ana', 'eve', 1]]), [{ who: 'bob', n: 2 }, { who: 'cleo', n: 1 }, { who: 'dan', n: 1 }], 'strongest first, at most three')
})

test('the placement is stable and pure: same input, same order, repeated; nothing is mutated; fewer than three agents are never moved', () => {
  const members = ['a', 'b', 'c', 'd', 'e'].map(name => ({ name }))
  const weights = [['a', 'e', 5], ['e', 'c', 3], ['c', 'b', 2], ['b', 'd', 1]]
  const before = JSON.stringify(members)
  const first = seatOrder(members, { mode: 'relays', weights }).map(m => m.name)
  assert.deepEqual(first, ['a', 'e', 'c', 'b', 'd'], 'a chain that starts with the busiest agent, then the strongest next neighbour')
  for (let i = 0; i < 5; i++) assert.deepEqual(seatOrder(members, { mode: 'relays', weights }).map(m => m.name), first)
  assert.equal(JSON.stringify(members), before)
  assert.deepEqual(seatOrder(members, null).map(m => m.name), ['a', 'b', 'c', 'd', 'e'], 'no seating: by name, as given')
  assert.deepEqual(seatOrder(members.slice(0, 2), { mode: 'relays', weights: [['a', 'b', 4]] }).map(m => m.name), ['a', 'b'], 'two agents: the hand-offs have nothing to change')
  assert.deepEqual(seatOrder(members.slice(0, 1), { mode: 'model', pairs: [{ a: 'a', b: 'b' }] }).map(m => m.name), ['a'])
  // no relay at all: every tie keeps the order given
  assert.deepEqual(seatOrder(members, { mode: 'relays', weights: [['x', 'y', 1]] }).map(m => m.name), ['a', 'b', 'c', 'd', 'e'])
  // the model's pairs: chained by the engine; an agent without a pair goes last in the order given (more in llm-scene.test.mjs)
  assert.deepEqual(seatOrder(members, { mode: 'model', pairs: [{ a: 'd', b: 'a' }, { a: 'a', b: 'b' }] }).map(m => m.name), ['b', 'a', 'd', 'c', 'e'])
})

test('a seating is made safe: a shape the engine does not know is no seating; the default order is the default layout', () => {
  assert.equal(normalizeSeating(null), null)
  assert.equal(normalizeSeating('relays'), null)
  assert.equal(normalizeSeating({ mode: 'chaos' }), null)
  assert.equal(normalizeSeating({ mode: 'model', pairs: [{ a: 'a', b: 'a' }] }), null, 'an agent with itself')
  assert.equal(normalizeSeating({ mode: 'model', pairs: [] }), null, 'no pair: the default order')
  assert.equal(normalizeSeating({ mode: 'model', order: ['a', 'b', 'c'] }), null, 'a whole order is not a seating any more')
  assert.equal(normalizeSeating({ mode: 'model', pairs: 'ab' }), null)
  assert.equal(normalizeSeating({ mode: 'relays', weights: [] }), null, 'no hand-off: nothing to follow')
  assert.equal(normalizeSeating({ mode: 'relays', weights: [['a', 'a', 1], ['a', 'b', 0], ['a', 'b', 1.5], ['a', 7, 1]] }), null, 'bad pairs are dropped one by one')
  assert.deepEqual(normalizeSeating({ mode: 'relays', weights: [['a', 'b', 2], ['x', 'x', 1]] }).weights, [['a', 'b', 2]])
  assert.deepEqual(normalizeSeating({ mode: 'model', pairs: [{ a: 'a', b: 'b' }, { a: 'b', b: 'a' }, { a: 7, b: 'c' }, { a: 'b', b: 'c', why: 'relay' }] }).pairs, [{ a: 'a', b: 'b' }, { a: 'b', b: 'c' }], 'a bad or repeated pair is dropped')
  // layout: seats follow the seating; back to null = the layout of the default order, to the pixel
  const off = office(9, 1)
  const names = pod => pod.seats.map(s => s.agent?.name ?? null)
  const plain = layoutScene(toSceneModel(off, { nowMs: 1e12 }))
  const inPod = [...off.agents].map(a => a.name).filter(n => plain.pods[0].members.some(m => m.name === n))
  const mixed = [...inPod.filter((_, i) => i % 2 === 0), ...inPod.filter((_, i) => i % 2 === 1)]   // not the default order
  const pairs = mixed.slice(1).map((b, i) => ({ a: mixed[i], b }))
  const model = toSceneModel(off, { nowMs: 1e12, seating: { mode: 'model', pairs } })
  const placed = layoutScene(model)
  assert.notDeepEqual(names(placed.pods[0]), names(plain.pods[0]))
  assert.deepEqual(placed.pods[0].members.map(m => m.name).sort(), [...inPod].sort(), 'nobody lost, nobody doubled')
  assert.deepEqual(names(layoutScene(toSceneModel(off, { nowMs: 1e12, seating: null })).pods[0]), names(plain.pods[0]))
  assert.equal(differing(drawScene(plain, buildBase(plain, toSceneModel(off, { nowMs: 1e12 })), toSceneModel(off, { nowMs: 1e12 }), 1).d, drawScene(layoutScene(toSceneModel(off, { nowMs: 1e12, seating: null })), buildBase(plain, toSceneModel(off, { nowMs: 1e12 })), toSceneModel(off, { nowMs: 1e12, seating: null }), 1).d), 0, 'revert = the default pixels')
  // the model and the layout see the same agents: nobody is lost or doubled by a seating
  const seen = placed.pods.flatMap(p => p.seats.map(s => s.agent?.name).filter(Boolean)).sort()
  assert.deepEqual(seen, plain.pods.flatMap(p => p.seats.map(s => s.agent?.name).filter(Boolean)).sort())
})

test('the choice of seating: off or sober or the default choice = nothing; hand-offs by default; the model\'s order only once kept', () => {
  const weights = [['a', 'b', 2]]
  const fiche = { pairs: [{ a: 'c', b: 'b', why: 'relay' }, { a: 'b', b: 'a', why: 'instruction' }] }
  assert.equal(seatingFor({ on: false, choice: 'relays', fiche, weights }), null, 'function off')
  assert.equal(seatingFor({ on: true, choice: 'default', fiche, weights }), null, 'back to the default order')
  assert.deepEqual(seatingFor({ on: true, choice: 'relays', fiche, weights }), { mode: 'relays', weights })
  assert.deepEqual(seatingFor({ on: true, choice: 'model', fiche, weights }), { mode: 'model', pairs: fiche.pairs })
  assert.equal(seatingFor({ on: true, choice: 'model', fiche: { pairs: [] }, weights }), null, 'a kept fiche without a pair: the default order (not the hand-offs)')
  assert.deepEqual(seatingFor({ on: true, choice: 'model', fiche: null, weights }), { mode: 'relays', weights }, 'no kept order: the hand-offs')
  assert.equal(seatingFor({ on: true, choice: 'relays', fiche, weights: [] }), null, 'no hand-off: the default order')
  assert.equal(seatingFor({ on: true, choice: undefined, fiche: null, weights: [] }), null)
  assert.ok(['relays', 'model', 'default'].every(isSeatChoice) && !isSeatChoice('x'))
  const body = seatingBody('i', '  put   seo and\twriter together \u0007 ', 'es')
  assert.deepEqual(body, { id: 'i', instructions: 'put seo and writer together', lang: 'es' }, 'whitespace squeezed, control characters out')
  assert.equal(cleanInstructions('x'.repeat(900)).length, INSTR_MAX)
  assert.deepEqual(Object.keys(body).sort(), ['id', 'instructions', 'lang'])
})

/* ---------- 3. thought bubbles ---------- */
const agent = (name, state, extra = {}) => ({ name, state, description: '', skills: [], roleOverride: null, modelRole: null, ...extra })

test('thought bubbles: none for an agent that does not work, none with the function off, in sober mode or with the page hidden', () => {
  const state = toLlm(served({ fiches: { thoughts: [{ name: 'w', text: 'rereading the diff' }, { name: 'i', text: 'sleeping' }, { name: 'z', text: 'dreaming' }, { name: 'q', text: 'sleeping' }, { name: 'ghost', text: 'haunting' }] } }))
  const agents = [agent('w', 'working'), agent('i', 'idle'), agent('z', 'stale'), agent('q', 'waiting')]
  assert.deepEqual({ ...thoughtsShown(state, agents) }, { w: 'rereading the diff' }, 'only the agent at work; the server keeps a bubble five minutes, the page does not show it once the work ends; an unknown name is no agent')
  assert.deepEqual({ ...thoughtsShown(state, [agent('w', 'idle')]) }, {}, 'the work ended: the bubble goes')
  assert.deepEqual({ ...thoughtsShown(state, []) }, {})
  assert.deepEqual({ ...thoughtsShown(state, agents, { sober: true }) }, {})
  assert.deepEqual({ ...thoughtsShown(state, agents, { visible: false }) }, {}, 'a hidden page shows none')
  assert.deepEqual({ ...thoughtsShown(toLlm(served({ settings: { features: { thoughts: false }, capUsd: 1, callCap: 300 }, fiches: { thoughts: [{ name: 'w', text: 'rereading' }] } })), agents) }, {}, 'function off')
  assert.deepEqual({ ...thoughtsShown(null, agents) }, {})
  // the text is checked again by the page
  for (const bad of ['', ' x', 'x ', 'a<b', 'a>b', 'see http://x', 'https://x', 'go to www.x.y', 'x'.repeat(THOUGHT_MAX + 1), 'a\nb', 'a\u0007b', 'a\u202eb', 'a\u200bb', 42, null, undefined]) assert.equal(isThought(bad), false, JSON.stringify(bad))
  for (const ok of ['I’m looking into the LLM functions', 'x', 'x'.repeat(THOUGHT_MAX), 'I run the tests again']) assert.equal(isThought(ok), true, ok)
})

test('the agents asked are the ones at work and wearing a role of the catalogue; the body carries nothing else', () => {
  const agents = [agent('dev', 'working', { modelRole: 'developer' }), agent('idle', 'idle', { modelRole: 'developer' }), agent('writer', 'working', { roleOverride: 'writer' }), agent('plain', 'working'), agent('wait', 'waiting', { modelRole: 'legal' })]
  assert.deepEqual({ ...thoughtRoles(agents) }, { dev: 'developer', writer: 'writer' }, 'no role in the catalogue: not asked (no role is invented); not working: not asked')
  assert.deepEqual({ ...thoughtRoles([]) }, {})
  assert.deepEqual({ ...thoughtRoles(null) }, {})
  assert.deepEqual(thoughtsBody('i', { dev: 'developer' }, 'fr'), { id: 'i', roles: { dev: 'developer' }, lang: 'fr' })
  assert.deepEqual(Object.keys(thoughtsBody('i', {}, 'xx')).sort(), ['id', 'lang', 'roles'])
})

test('rhythm: at most one request a minute, page visible, function on, someone at work', () => {
  const roles = { a: 'developer' }
  const ok = { nowMs: 1_000_000, lastMs: null, visible: true, ready: true, roles }
  assert.deepEqual(thoughtGate(ok), { ask: true, why: null })
  assert.deepEqual(thoughtGate({ ...ok, ready: false }), { ask: false, why: 'off' })
  assert.deepEqual(thoughtGate({ ...ok, visible: false }), { ask: false, why: 'hidden' })
  assert.deepEqual(thoughtGate({ ...ok, roles: {} }), { ask: false, why: 'idle' }, 'nobody at work: nothing asked, nothing sent')
  assert.deepEqual(thoughtGate({ ...ok, roles: undefined }), { ask: false, why: 'idle' })
  assert.deepEqual(thoughtGate({ ...ok, lastMs: ok.nowMs - 1 }), { ask: false, why: 'soon' })
  assert.deepEqual(thoughtGate({ ...ok, lastMs: ok.nowMs - (THOUGHT_EVERY_MS - 1) }), { ask: false, why: 'soon' })
  assert.deepEqual(thoughtGate({ ...ok, lastMs: ok.nowMs - THOUGHT_EVERY_MS }), { ask: true, why: null }, 'a minute exactly is allowed')
  assert.equal(THOUGHT_EVERY_MS, 60_000)
})

test('the hook: simulated hour of ticks -> at most 60 requests, none while hidden or idle, none by itself with the function off', async () => {
  const posts = []
  initLlm({ rest: async (path, opts) => { posts.push({ path, body: opts?.body }); return { ok: true, result: 'refused', reason: 'unchanged', id: 'x' } } })
  const realNow = Date.now
  const realDoc = globalThis.document
  try {
    let clock = 1_700_000_000_000
    Date.now = () => clock
    const run = async (props, { ticks, everyMs, hidden = false }) => {
      resetThoughtsClock()
      posts.length = 0
      globalThis.document = { hidden }
      useThoughts({ lang: 'en', ...props })
      const q = globalThis.__query
      for (let i = 0; i < ticks; i++) { clock += everyMs; if (q.enabled) await q.queryFn() }   // react-query runs a disabled query never
      return { posts: posts.slice(), q }
    }
    const on = { ready: true, visible: true, roles: { a: 'developer', b: 'writer' } }
    // the page asks far too often (every 5 s for an hour): the rhythm still holds
    const hour = await run(on, { ticks: 720, everyMs: 5_000 })
    assert.ok(hour.posts.length <= 60, `${hour.posts.length} requests in an hour`)
    assert.ok(hour.posts.length >= 59, 'and it does ask once a minute while someone works')
    assert.ok(hour.posts.every(p => p.path === '/llm/thoughts'))
    assert.deepEqual(Object.keys(hour.posts[0].body).sort(), ['id', 'lang', 'roles'], 'the allow-list: ids, roles, language')
    // minute spacing, measured on the clock
    const stamps = []
    posts.length = 0
    resetThoughtsClock()
    initLlm({ rest: async () => { stamps.push(clock); return { ok: true, result: 'refused', reason: 'unchanged' } } })
    useThoughts({ lang: 'en', ...on })
    for (let i = 0; i < 100; i++) { clock += 7_000; if (globalThis.__query.enabled) await globalThis.__query.queryFn() }
    for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] - stamps[i - 1] >= THOUGHT_EVERY_MS, `two requests ${stamps[i] - stamps[i - 1]} ms apart`)
    initLlm({ rest: async (path, opts) => { posts.push({ path, body: opts?.body }); return { ok: true, result: 'refused', reason: 'unchanged' } } })
    assert.equal((await run(on, { ticks: 50, everyMs: 5_000, hidden: true })).posts.length, 0, 'a hidden page asks nothing')
    assert.equal((await run({ ...on, roles: {} }, { ticks: 50, everyMs: 5_000 })).posts.length, 0, 'nobody at work: nothing asked')
    assert.equal((await run({ ...on, ready: false }, { ticks: 50, everyMs: 5_000 })).posts.length, 0, 'function off: nothing asked')
    // the query itself only runs while it may: enabled needs the function ON, the page visible, someone at work
    useThoughts({ lang: 'en', ...on })
    assert.equal(globalThis.__query.enabled, true)
    assert.equal(globalThis.__query.refetchInterval, THOUGHT_EVERY_MS)
    assert.equal(globalThis.__query.refetchIntervalInBackground, false)
    for (const off of [{ ready: false }, { visible: false }, { roles: {} }]) {
      useThoughts({ lang: 'en', ...on, ...off })
      assert.equal(globalThis.__query.enabled, false, JSON.stringify(off))
      assert.equal(globalThis.__query.refetchInterval, false, 'no timer when it may not run')
    }
  } finally {
    Date.now = realNow
    globalThis.document = realDoc
  }
})

/* ---------- 4. one decision, sober mode, scene time, strings ---------- */
test('llmView: functions off draw nothing; on, the real milestones, the hand-offs and the agents at work; sober shows nothing', () => {
  const weights = [['ana', 'bob', 2]]
  const agents = [agent('ana', 'working', { modelRole: 'developer' }), agent('bob', 'idle')]
  const extra = { game: GAME, office: OFFICE, nowMs: NOW, agents, seatChoice: 'relays', weights, visible: true }
  const art = { 'chain:-:alpha': POSTER('trophy') }
  const state = toLlm(served({ fiches: { art, thoughts: [{ name: 'ana', text: 'rereading the diff' }, { name: 'bob', text: 'sleeping' }] } }))
  const v = llmView(state, false, extra)
  assert.deepEqual(v.posters.map(p => p.key), ['chain:-:alpha'])
  assert.equal(v.pending.length, v.milestones.length - 1, 'the milestones without a poster are the ones to ask for')
  assert.equal(v.artReady, true)
  assert.deepEqual(v.seating, { mode: 'relays', weights })
  assert.equal(v.seatingReady, true)
  assert.deepEqual({ ...v.thoughts }, { ana: 'rereading the diff' }, 'bob does not work: no bubble')
  assert.equal(v.thoughtsReady, true)
  // each function has its own switch
  const off = llmView(toLlm(served({ settings: { features: {}, capUsd: 1, callCap: 300 }, fiches: { art, thoughts: [{ name: 'ana', text: 'rereading' }] } })), false, extra)
  assert.deepEqual([off.posters, off.pending, off.milestones, off.seating, { ...off.thoughts }], [[], [], [], null, {}])
  assert.deepEqual([off.artReady, off.seatingReady, off.thoughtsReady], [false, false, false])
  // sober: nothing LLM at all
  const sober = llmView(state, true, extra)
  assert.deepEqual([sober.on, sober.posters, sober.milestones, sober.seating, { ...sober.thoughts }, sober.artReady, sober.seatingReady, sober.thoughtsReady], [false, [], [], null, {}, false, false, false])
  // a hidden page: no bubble drawn
  assert.deepEqual({ ...llmView(state, false, { ...extra, visible: false }).thoughts }, {})
  // the three functions are drawn by this page now
  assert.deepEqual([...LLM_DRAWN].sort(), [...LLM_FEATURES].sort())
  // no agent half answer: nothing
  assert.deepEqual(llmView(null, false, extra).posters, [])
  // cap reached / no model route: the switch stays, the button is not offered
  const noRoute = llmView(toLlm(served({ features: [] })), false, extra)
  assert.equal(noRoute.artReady, false)
  assert.equal(noRoute.seatingReady, false)
  assert.equal(noRoute.thoughtsReady, false)
  const capped = llmView(toLlm(served({ spend: { month: 'm', usd: 5, calls: 1, unpriced: 0, byFeature: {} } })), false, extra)
  assert.equal(capped.thoughtsReady, false, 'cap reached: the bubbles are not even asked')
})

test('drawScene stays under 60 ms with four posters, a seating and bubbles on 30 agents and 8 boards, day and night', () => {
  const off = office(30, 8)
  for (const night of [false, true]) {
    const posters = ['summit', 'rocket', 'trophy', 'bridge'].map((m, i) => P(`k${i}:-:-`, m))
    const weights = relayWeights(off.boards.flatMap((b, i) => [{ tasks: off.agents.filter(a => a.home === b.slug).flatMap((a, j) => [task(a.name, j * 2), task(off.agents[(j + i) % 30].name, j * 2 + 1)]) }]))
    const model = toSceneModel(off, { nowMs: 1e12, night, decor: { sober: false, posters }, seating: { mode: 'relays', weights } })
    const layout = layoutScene(model)
    const base = buildBase(layout, model)
    drawScene(layout, base, model, 1)
    const times = []
    for (let i = 0; i < 9; i++) { const t0 = performance.now(); drawScene(layout, base, model, i); times.push(performance.now() - t0) }
    times.sort((a, b) => a - b)
    assert.ok(times[4] <= 60, `median ${times[4].toFixed(1)} ms (${night ? 'night' : 'day'})`)
  }
})

test('nothing calls a model by itself: the art and the seating are gestures, the bubbles have one rhythm, no setInterval for data', () => {
  const page = src('src/ui/OfficePage.jsx')
  assert.doesNotMatch(page, /callLlm|useLlmActions|\bcall\(/, 'the page never calls a model itself (the bubbles go through their hook)')
  const hook = src('src/data/thoughts.js')
  assert.doesNotMatch(hook, /setInterval|setTimeout/)
  assert.match(hook, /refetchIntervalInBackground: false/)
  assert.match(hook, /refetchInterval: enabled \? THOUGHT_EVERY_MS : false/)
  assert.match(hook, /thoughtGate\(/)
  const dialog = src('src/ui/SeatingDialog.jsx')
  assert.equal((dialog.match(/call\('\/llm\//g) || []).length, 1)
  assert.match(dialog, /const run = async e => \{[^}]*call\('\/llm\/seating'/s)
  for (const m of dialog.matchAll(/useEffect\(\(\) => \{([^]*?)\n  \}, \[/g)) assert.doesNotMatch(m[1], /call\(/, 'an effect never calls a model')
  // sober / page hidden: the scene draws nothing of it
  const scene = src('src/ui/OfficeScene.jsx')
  assert.match(scene, /thoughts\?\.\[a\.name\]/)
  assert.match(scene, /document\.hidden/)
  assert.match(src('src/core/llm.js'), /thoughtsShown\(state, extra\.agents, \{ sober, visible: extra\.visible !== false \}\)/)
})

test('the strings: art, seating and bubbles in en, fr and es', () => {
  for (const lang of ['en', 'fr', 'es']) {
    const l = messages[lang].llm
    assert.match(l.art.run(3), /3/)
    assert.match(l.art.done(2), /2/)
    assert.match(l.art.fact('Chain · alpha', '10 Nov'), /Chain · alpha.*10 Nov/)
    assert.match(l.art.spot('X'), /X/)
    assert.match(l.art.source('12:00'), /12:00/)
    for (const k of ['running', 'none', 'drawn']) assert.ok(l.art[k].length > 5, `${lang} art.${k}`)
    for (const k of ['open', 'title', 'off', 'relays', 'relaysHint', 'none', 'instructions', 'placeholder', 'sent', 'emptyOk', 'call', 'calling', 'proposal', 'proposalNote', 'choice', 'useRelays', 'useModel', 'useDefault', 'revert']) assert.ok(l.seating[k].length > 2, `${lang} seating.${k}`)
    assert.match(l.seating.pair('a ↔ b', 2), /a ↔ b.*2/)
    assert.match(l.seating.kept('x'), /x/)
    assert.match(l.thoughts.say('reading'), /reading/)
    assert.ok(l.thoughts.badge.length >= 2 && l.thoughts.note.length > 10)
  }
  assert.equal(messages.fr.llm.thoughts.badge, 'IA')
  assert.equal(messages.en.llm.thoughts.badge, 'AI', 'the bubble is labelled as written by an AI')
})
}

// ===== llm-scene =====
{
// The model returns neighbour PAIRS, the engine chains them (src/scene/seating.js); a style that came back while the Decorator's
// window was closed is kept, never applied by itself.
// Pairs: complete, partial, empty (= the default order), invalid (= no seating), 1, 13 and 30 agents; deterministic; nobody lost or doubled.
const names = n => Array.from({ length: n }, (_, i) => `agent-${String(i).padStart(2, '0')}`)
const members = n => names(n).map(name => ({ name }))
const seat = (n, pairs) => seatOrder(members(n), normalizeSeating({ mode: 'model', pairs })).map(m => m.name)
const chain = (list, why = 'relay') => list.slice(1).map((b, i) => ({ a: list[i], b, why }))
const sameSet = (a, b) => assert.deepEqual([...a].sort(), [...b].sort())

for (const n of [1, 13, 30]) {
  test(`${n} agent(s): complete, partial and empty pairs place everybody exactly once`, () => {
    const all = names(n)
    const shuffled = [...all.filter((_, i) => i % 2 === 0), ...all.filter((_, i) => i % 2 === 1)]   // not the default order
    const complete = chain(shuffled)   // N-1 pairs: the whole row, reversed
    const partial = complete.slice(0, Math.floor(n / 2))
    for (const pairs of [complete, partial, []]) {
      const placed = seat(n, pairs)
      assert.equal(placed.length, n)
      sameSet(placed, all)   // nobody lost, nobody doubled
      assert.deepEqual(seat(n, pairs), placed, 'same pairs, same seats')
    }
    assert.deepEqual(seat(n, []), all, 'no pair = the default order (by name)')
    // a complete chain is the row it describes (a row has no direction: it starts at the end that comes first in the order given)
    if (n >= 3) assert.deepEqual(seat(n, complete), all.indexOf(shuffled[0]) < all.indexOf(shuffled[n - 1]) ? shuffled : [...shuffled].reverse())
    // a partial list: the chained agents sit side by side, the others follow in the order given
    if (n >= 4) {
      const placed = seat(n, partial)
      const used = new Set(partial.flatMap(p => [p.a, p.b]))
      const run = placed.filter(x => used.has(x))
      assert.equal(run.every((x, i) => i === 0 || Math.abs(shuffled.indexOf(x) - shuffled.indexOf(run[i - 1])) === 1), true, 'the chained agents sit side by side')
      assert.deepEqual(placed.slice(used.size), all.filter(x => !used.has(x)), 'agents without a pair come last, in the order given')
      assert.equal(placed.slice(0, used.size).every(x => used.has(x)), true)
    }
  })
}

test('the strongest pair (the first) wins when the pairs cannot all be neighbours', () => {
  // a star: b is asked next to a, c and d; a table is a row, so b keeps its first two pairs
  const placed = seat(4, [{ a: 'agent-01', b: 'agent-00' }, { a: 'agent-01', b: 'agent-02' }, { a: 'agent-01', b: 'agent-03' }])
  sameSet(placed, names(4))
  const at = placed.indexOf('agent-01')
  const next = [placed[at - 1], placed[at + 1]].filter(Boolean)
  assert.deepEqual(next.sort(), ['agent-00', 'agent-02'])
  // a ring is never closed
  const row = seat(3, [{ a: 'agent-00', b: 'agent-01' }, { a: 'agent-01', b: 'agent-02' }, { a: 'agent-02', b: 'agent-00' }])
  sameSet(row, names(3))
})

test('pairs for agents of other pods or unknown to the pod are ignored by the engine', () => {
  assert.deepEqual(seat(3, [{ a: 'ghost', b: 'agent-02' }]), names(3))
  sameSet(seat(5, [{ a: 'agent-04', b: 'agent-00' }, { a: 'x', b: 'y' }]), names(5))
})

test('the page refuses an invalid fiche as a whole; a partial or empty one is a fiche', () => {
  const good = [{ a: 'x', b: 'y', why: 'relay' }, { a: 'y', b: 'z', why: 'instruction' }]
  assert.equal(pairsAreSound(good), true)
  assert.equal(pairsAreSound([]), true, 'empty = the default order, not an error')
  assert.equal(pairsAreSound([{ a: 'x', b: 'x', why: 'relay' }]), false, 'self pair')
  assert.equal(pairsAreSound([...good, { a: 'z', b: 'y', why: 'relay' }]), false, 'a pair twice, either way round')
  assert.equal(pairsAreSound([{ a: 'x', b: 'y', why: 'because' }]), false, 'a reason out of the list')
  assert.equal(pairsAreSound([{ a: 'x', b: 7, why: 'relay' }]), false)
  const served = f => toLlm({ ok: true, settings: { features: {}, capUsd: 1, callCap: 300 }, fiches: { seating: f } })
  assert.deepEqual(served({ pairs: good, at: 3, instructions: 'i' }).fiches.seating.pairs, good)
  assert.deepEqual(served({ pairs: [], at: 3 }).fiches.seating.pairs, [])
  assert.equal(served({ pairs: [{ a: 'x', b: 'x', why: 'relay' }] }).fiches.seating, null)
  assert.equal(served({ order: ['x', 'y', 'z'] }).fiches.seating, null)
  // the engine gets nothing from an empty fiche but the default order, and the pairs of a kept fiche otherwise
  assert.equal(seatingFor({ on: true, choice: 'model', fiche: { pairs: [] }, weights: [['x', 'y', 2]] }), null)
  assert.deepEqual(seatingFor({ on: true, choice: 'model', fiche: { pairs: good }, weights: [] }), { mode: 'model', pairs: good })
})

test('a style is applied by itself only if the window stayed open; the pending style is read from the agent half', () => {
  const done = { kind: 'done', fiche: { floor: 'planks' }, reset: false }
  assert.equal(decorAppliesNow(done, false), true, 'window open from the call to the answer: the office shows it at once')
  assert.equal(decorAppliesNow(done, true), false, 'window closed meanwhile: kept, not applied')
  assert.equal(decorAppliesNow({ kind: 'failed', reason: 'invalid_output', fiche: null }, false), false)
  assert.equal(decorAppliesNow({ ...done, reset: true }, false), false)
  assert.deepEqual(decorResolveBody('i', 'apply'), { id: 'i', choice: 'apply' })
  assert.deepEqual(decorResolveBody('i', 'anything'), { id: 'i', choice: 'ignore' }, 'only an explicit « apply » applies')
  const served = p => toLlm({ ok: true, settings: { features: { decor: true }, capUsd: 1, callCap: 300 }, fiches: { decor: null, decorPending: p } })
  assert.equal(served({ fiche: { floor: 'planks' }, style: 'x', at: 1 }).fiches.decorPending.style, 'x')
  assert.equal(served(null).fiches.decorPending, null)
  assert.equal(served({ style: 'x' }).fiches.decorPending, null)
})

test('the dialog applies only on a click: the pending style is not part of what the office draws', () => {
  const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
  const core = src('src/core/llm.js')
  const decorStyle = core.slice(core.indexOf('export function decorStyle'), core.indexOf('/* ---------- outfits'))
  assert.doesNotMatch(decorStyle, /decorPending/, 'the office draws `fiches.decor` only')
  const dlg = src('src/ui/DecorDialog.jsx')
  assert.match(dlg, /data-decor-ready/)
  assert.match(dlg, /data-decor-apply[^>]*onClick=\{\(\) => resolve\('apply'\)\}/)
  assert.match(dlg, /data-decor-ignore[^>]*onClick=\{\(\) => resolve\('ignore'\)\}/)
  assert.match(dlg, /decorAppliesNow\(a, closedRef\.current\)/)
})
}

// ===== llm-scene =====
{
// The seating chain keeps every agent exactly once, whatever the hand-offs.
// chainOrder (src/scene/seating.js) keeps the strongest hand-offs as long as nobody gets more than two neighbours and no ring closes.
// Both rules guard the pod against losing or doubling an agent: a ring leaves no end to start the walk from (its agents vanish), a
// third neighbour makes two walks cross the same agent (it is seated twice).
const members = names => names.split('').map(name => ({ name }))
const order = (names, weights) => seatOrder(members(names), { mode: 'relays', weights }).map(m => m.name).join('')

test('a triangle of hand-offs is a row, not a ring: the weakest side is dropped, nobody is lost', () => {
  assert.equal(order('abcd', [['a', 'b', 3], ['b', 'c', 2], ['a', 'c', 1]]), 'abcd')
  // a full ring of four: still four agents, each once, the weakest link left open
  assert.equal(order('abcd', [['a', 'b', 4], ['b', 'c', 3], ['c', 'd', 2], ['a', 'd', 1]]), 'abcd')
})

test('a star of hand-offs: the centre keeps its two strongest neighbours, nobody is seated twice', () => {
  assert.equal(order('abcde', [['a', 'b', 3], ['a', 'c', 2], ['a', 'd', 1]]), 'bacde')
})

test('any hand-offs give a permutation of the pod: every agent once, in a dense random graph too', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const names = 'abcdefghij'
  for (let round = 0; round < 50; round++) {
    const weights = []
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (rnd() < 0.5) weights.push([names[i], names[j], 1 + Math.floor(rnd() * 9)])
    const got = order(names, weights)
    assert.equal([...got].sort().join(''), names, `round ${round}: ${got}`)
  }
  // and in the layout: a pod seated by a ring of hand-offs still seats all its members
  const boards = [{ slug: 'b', counts: { todo: 1 }, total: 1, blocked: [], tasks: [] }]
  const agents = [...'abcdef'].map(n => ({ name: n, state: 'idle', home: 'b', description: '', lastActivityMs: 1, officeMeta: {} }))
  const ring = [...'abcdef'].map((n, i, a) => [n, a[(i + 1) % a.length], 6 - (i % 3)])
  const pod = layoutScene(toSceneModel({ agents, boards, ops: null }, { nowMs: 1e12, seating: { mode: 'relays', weights: ring } })).pods[0]
  assert.deepEqual(pod.seats.map(s => s.agent?.name).filter(Boolean).sort(), [...'abcdef'])
})
}

// ===== llm-scene =====
{
// What of the model reaches the page: a bubble carries no link, with or without « :// » (the agent half refuses
// the same texts: tests/python/test_security_llm_bubbles.py), and none of the invisible characters the agent half refuses (U+2028, U+2060).
const LINKS = ['javascript:alert(1)', 'MEDIA:/etc/passwd', 'data:text/html,x', 'mailto:a@evil.example', 'file:/etc/shadow', 'Pay now at evil.example/pay', 'see EVIL.EXAMPLE/x']
const INVISIBLE = ['line\u2028two', 'para\u2029two', 'zero\u2060width', 'inv\u2063sep']
const FINE = ['Rereading llm.py and the tests', 'Note : the review moves on', 'I run the tests again', 'Step 2: fixing the build', 'I’m looking into the LLM functions', '12:30, one more test']

test('a bubble with a link or an invisible separator is refused by the page', () => {
  for (const t of [...LINKS, ...INVISIBLE]) assert.equal(isThought(t), false, JSON.stringify(t))
  for (const t of FINE) assert.equal(isThought(t), true, t)
})

test('a hostile GET /llm answer draws no link bubble, only the ordinary one', () => {
  const body = {
    ok: true, available: true, features: ['thoughts'],
    settings: { features: { thoughts: true }, capUsd: 1, callCap: 300 },
    spend: {}, fiches: { thoughts: [...LINKS, ...INVISIBLE].map(text => ({ name: 'w', text })).concat([{ name: 'v', text: 'Rereading llm.py' }]) }
  }
  const view = llmView(toLlm(body), false, { agents: [{ name: 'w', state: 'working' }, { name: 'v', state: 'working' }], visible: true })
  assert.deepEqual({ ...view.thoughts }, { v: 'Rereading llm.py' })
})

test('caps read from the agent half stay in their bounds whatever it says', () => {
  const s = toLlm({ ok: true, settings: { features: {}, capUsd: 1e9, callCap: -5 }, spend: { usd: 'NaN' } })
  assert.equal(s.settings.capUsd, 100)
  assert.equal(s.settings.callCap, 0)
  assert.equal(s.spend.usd, 0)
})
}
