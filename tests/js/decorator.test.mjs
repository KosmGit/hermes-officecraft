import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { test } from 'node:test'
import { LLM_FEATURES, REASONS, answerOfError, capReached, cleanStyle, costKind, decorBody, decorStyle, featureState, formatUsd, llmView, manualProfiles, modelRoles, outfitSource, outfitsBody, parseCap, readAnswer, settingsBody, spendView, toLlm, withModelRoles, decorAppliesNow } from '../../src/core/llm.js'
import { messages } from '../../src/i18n/index.js'
import { ROLES, STYLE_BASE, STYLE_COLORS, VIEWS, buildBase, drawScene, layoutScene, normalizeStyle, outfitOf, roleOf, toSceneModel, drawnColors, hexOf } from '../../src/scene/index.js'
import { floorColor, floorOf, setStyle, viewColor, viewOf } from '../../src/scene/style.js'
import { PAL } from '../../src/scene/palette.js'
import { fileURLToPath } from 'node:url'

// ===== decorator =====
{
// LLM settings, the Decorator and the custom outfits, in the page.
//  1. a fiche is drawn by the engine: every colour key, both floors, the three views (day and night); an unknown value is ignored; nothing leaks;
//  2. the outfit priority: manual > model > rules;
//  3. the settings states: off, no model, cap reached (dollars, calls), last call failed, ready; the spend and the caps;
//  4. a call's answer and the data layer; nothing LLM in sober mode; nothing is called by itself.
// No real model is called here (a fake `rest`).
const STUB = 'export const useQuery = () => ({}); export const useQueryClient = () => null; export const randomUuid = () => "00000000-0000-4000-8000-000000000000"'
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) { return s === '@hermes/plugin-sdk' ? { url: 'data:text/javascript,${encodeURIComponent(STUB)}', shortCircuit: true } : next(s, c) }`)}`)
const { LLM_KEY, LLM_POLL_MS, callLlm, initLlm, saveLlm } = await import('../../src/data/llm.js')

const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const sha = d => createHash('sha256').update(d).digest('hex')

/* ---------- a small office, any size ---------- */
const NAMES = ['studio', 'léa', 'bot-7', 'designer', 'ops', 'scout', 'writer', 'x7']
function office(nAgents, nBoards) {
  const boards = Array.from({ length: nBoards }, (_, i) => ({ slug: `b${i}`, counts: { todo: i + 1, running: 1, blocked: 0, done: 5 * i }, total: 10 * i + 3, blocked: [] }))
  const agents = Array.from({ length: nAgents }, (_, i) => ({
    name: NAMES[i % NAMES.length] + (i >= NAMES.length ? `-${i}` : ''), state: ['working', 'idle', 'waiting'][i % 3], home: nBoards && i % 5 !== 4 ? boards[i % nBoards].slug : null,
    description: '', lastActivityMs: 1, officeMeta: {}
  }))
  return { agents, boards, ops: null }
}
/** One drawn frame (base + dynamic layer) for a style (a raw fiche or null), day or night. */
function frame(style, { night = false, agents = 0, boards = 2 } = {}) {
  const model = toSceneModel(office(agents, boards), { nowMs: 1e12, night, decor: style === undefined ? {} : { style } })
  const layout = layoutScene(model)
  const base = buildBase(layout, model)
  return drawScene(layout, base, model, 3).d
}
const differing = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n }

/* ---------- 1. a fiche is drawn ---------- */
test('normalizeStyle: only what is valid is taken, key by key; the rest keeps its default; not an object = no style', () => {
  assert.equal(normalizeStyle(null), null)
  assert.equal(normalizeStyle('city'), null)
  assert.equal(normalizeStyle([1, 2]), null)
  assert.deepEqual(normalizeStyle({}), STYLE_BASE, 'an empty fiche is the default fiche')
  const odd = normalizeStyle({ left: 'red', back: '#ABCDEF', wainscot: '#12345', seam: 7, sofa: '#112233', floor: 'marble', view: 'moon', planks: ['#ffffff'], extra: '<script>', cushion: '#abcdeg' })
  assert.equal(odd.left, STYLE_BASE.left, 'a colour name is not a colour')
  assert.equal(odd.back, STYLE_BASE.back, 'uppercase hexadecimal is refused, like the agent half does')
  assert.equal(odd.wainscot, STYLE_BASE.wainscot, '5 digits')
  assert.equal(odd.seam, STYLE_BASE.seam, 'a number')
  assert.equal(odd.sofa, '#112233', 'the valid one is taken')
  assert.equal(odd.floor, 'planks', 'an unknown floor')
  assert.equal(odd.view, 'city', 'an unknown view')
  assert.deepEqual(odd.planks, STYLE_BASE.planks, 'planks are exactly four colours or nothing')
  assert.equal(odd.cushion, STYLE_BASE.cushion)
  assert.ok(!('extra' in odd), 'no key of the model gets through')
  assert.ok(Object.isFrozen(odd))
  assert.deepEqual(normalizeStyle({ planks: ['#000000', '#111111', '#222222', '#333333'] }).planks, ['#000000', '#111111', '#222222', '#333333'])
})

test('each of the 8 colour keys is drawn (office with boards, no agent, day and night)', () => {
  for (const night of [false, true]) {
    const ref = frame({}, { night })
    assert.equal(differing(ref, frame({}, { night })), 0, 'the same fiche draws the same pixels')
    for (const key of STYLE_COLORS) {
      const n = differing(ref, frame({ [key]: '#ff00aa' }, { night }))
      assert.ok(n > 0, `${key} (${night ? 'night' : 'day'}) is not drawn`)
    }
  }
})

test('the colour of a fiche really is the colour drawn (wall, sofa, desk: the pixel moves toward it)', () => {
  const ref = frame({})
  for (const key of ['left', 'sofa', 'desk', 'cabinets']) {
    const hot = frame({ [key]: '#ff0000' })
    let redder = 0
    for (let i = 0; i < ref.length; i += 4) if (hot[i] !== ref[i] && hot[i] > ref[i] && hot[i + 1] < ref[i + 1]) redder++
    assert.ok(redder > 20, `${key}: ${redder} pixels turned red`)
  }
})

test('both floors are drawn: planks (the four plank colours) and concrete (slabs); each enumeration value draws something else', () => {
  const planks = frame({ floor: 'planks' })
  const concrete = frame({ floor: 'concrete' })
  assert.ok(differing(planks, concrete) > 2000, `concrete differs from planks on ${differing(planks, concrete)} pixels`)
  assert.ok(differing(frame({ floor: 'concrete' }), frame({ floor: 'concrete', planks: ['#101010', '#202020', '#303030', '#404040'] })) > 1000, 'concrete takes its tones from the fiche')
  assert.equal(floorOf({ floor: 'concrete' }), 'concrete')
  assert.equal(floorOf({ floor: 'planks' }), 'planks')
  assert.equal(floorOf(null), 'planks')
  setStyle(normalizeStyle({ floor: 'concrete' }))
  assert.deepEqual(floorColor(0, 0.5), PAL.seam, 'the seam between two slabs')
  assert.notDeepEqual(floorColor(0.7, 0.7), PAL.seam)
  setStyle(null)
})

test('the three views are drawn, day and night, and only in the windows', () => {
  for (const night of [false, true]) {
    const city = frame({ view: 'city' }, { night })
    const sea = frame({ view: 'sea' }, { night })
    const forest = frame({ view: 'forest' }, { night })
    const total = city.length / 4
    for (const [a, b, name] of [[city, sea, 'city/sea'], [city, forest, 'city/forest'], [sea, forest, 'sea/forest']]) {
      const n = differing(a, b)
      assert.ok(n > 200, `${name} (${night ? 'night' : 'day'}): ${n} pixels`)
      assert.ok(n < total * 0.2, `${name}: the view stays in the glazing (${n} of ${total})`)
    }
  }
  assert.deepEqual(VIEWS, ['city', 'sea', 'forest'])
  // every view looks out on the park drawn around the building; the view only changes the far distance. So the city is now
  // drawn by viewColor like the others, and no fiche means the park alone.
  assert.ok(viewColor('city', 10, 20, 40, false), 'the city is a view like the others')
  assert.ok(viewColor('park', 10, 20, 40, false), 'the park alone (no fiche)')
  assert.equal(viewColor('moon', 10, 20, 40, false), null, 'an unknown view draws nothing of its own')
  assert.ok(viewColor('sea', 10, 5, 40, false) && viewColor('forest', 10, 5, 40, true))
  assert.equal(viewOf({ view: 'moon' }), 'city', 'a fiche without a valid view keeps the fiche default')
  assert.equal(viewOf(null), 'park', 'no fiche: the park alone')
  // the foot of every pane is the same lawn, whatever the view (one outdoor world)
  for (const night of [false, true]) {
    const lawn = ['park', 'city', 'sea', 'forest'].map(v => String(viewColor(v, 10, 1, 40, night)))
    assert.equal(new Set(lawn).size, 1, `${night ? 'night' : 'day'}: ${lawn.join(' | ')}`)
  }
})

test('an unknown value is ignored: the drawing is the one of the fiche without it', () => {
  for (const night of [false, true]) {
    const withJunk = frame({ floor: 'marble', view: 'moon', left: 'blue', sofa: '#zzzzzz', planks: 'oak', cabinets: 12 }, { night })
    const clean = frame({}, { night })
    assert.equal(differing(withJunk, clean), 0, 'junk values draw nothing')
    // a good value next to a bad one: the good one is drawn
    const half = frame({ floor: 'marble', view: 'sea' }, { night })
    assert.equal(differing(half, frame({ view: 'sea' }, { night })), 0)
    assert.ok(differing(half, clean) > 0)
  }
})

test('no style leaks: drawing a style then none gives the default office again, byte for byte; a postcard of a styled office does not restyle the next', () => {
  const first = frame(undefined, { agents: 6 })
  const styled = frame({ view: 'sea', floor: 'concrete', sofa: '#00ff00', desk: '#ff00ff' }, { agents: 6 })
  assert.ok(differing(first, styled) > 3000)
  const again = frame(undefined, { agents: 6 })
  assert.equal(sha(first), sha(again))
  assert.equal(sha(frame(null, { agents: 6 })), sha(first), 'a null style is no style')
  assert.equal(PAL.sofa[0], 0x5d, 'PAL is back to the default after the default draw')
})

test('drawScene stays under 60 ms with a decor applied (30 agents, 8 boards, sea + concrete, day and night)', () => {
  for (const night of [false, true]) {
    const model = toSceneModel(office(30, 8), { nowMs: 1e12, night, decor: { style: { view: 'sea', floor: 'concrete', left: '#aabbcc', sofa: '#336699' } } })
    const layout = layoutScene(model)
    const base = buildBase(layout, model)
    drawScene(layout, base, model, 0)   // warm-up
    const times = []
    for (let i = 0; i < 7; i++) { const t0 = performance.now(); drawScene(layout, base, model, i); times.push(performance.now() - t0) }
    times.sort((a, b) => a - b)
    assert.ok(times[3] <= 60, `median ${times[3].toFixed(1)} ms (${night ? 'night' : 'day'})`)
  }
})

/* ---------- 2. outfit priority: manual > model > rules ---------- */
test('roleOf: a hand-picked role beats the model, the model beats the rules', () => {
  const a = { name: 'designer', description: '', skills: [] }   // the rules say « designer »
  assert.equal(roleOf(a).role, 'designer')
  assert.equal(roleOf(a).why.kind, 'name')
  // model > rules
  const m = roleOf({ ...a, modelRole: 'finance', modelRoleAt: 1000 })
  assert.equal(m.role, 'finance')
  assert.deepEqual(m.why, { kind: 'model', at: 1000 })
  // manual > model
  assert.equal(roleOf({ ...a, roleOverride: 'developer', modelRole: 'finance' }).role, 'developer')
  assert.equal(roleOf({ ...a, roleOverride: 'developer', modelRole: 'finance' }).why.kind, 'manual')
  // « no role » chosen by hand is a choice too
  assert.equal(roleOf({ ...a, roleOverride: 'none', modelRole: 'finance' }).role, null)
  // `auto` (what a recruitment writes) is not a choice: the model's role applies
  assert.equal(roleOf({ ...a, roleOverride: 'auto', modelRole: 'finance' }).role, 'finance')
  // a role that is not in the catalogue is ignored (never an outfit invented by the model)
  for (const bad of ['wizard', 'constructor', '__proto__', 'toString', '', null, 7]) assert.equal(roleOf({ ...a, modelRole: bad }).role, 'designer', String(bad))
})

test('the scene model carries the model role only when it is in the catalogue, and the outfit follows it', () => {
  const o = office(3, 1)
  const [first, second] = o.agents.map(a => a.name)
  const model = toSceneModel(o, { nowMs: 1e12, profiles: { [first]: { modelRole: 'finance', modelRoleAt: 5 }, [second]: { modelRole: 'wizard' } } })
  const by = Object.fromEntries(model.agents.map(a => [a.name, a]))
  assert.equal(by[first].modelRole, 'finance')
  assert.equal(by[first].modelRoleAt, 5)
  assert.equal(by[second].modelRole, null)
  assert.equal(outfitOf(by[first]).role, 'finance')
  assert.ok(ROLES.finance.looks.some(l => l.g === outfitOf(by[first]).garment))
  // a hand-picked role in ui_meta (officeMeta.role) still wins
  const hand = office(1, 1)
  hand.agents[0].officeMeta = { role: 'legal' }
  const m2 = toSceneModel(hand, { nowMs: 1e12, profiles: { [hand.agents[0].name]: { modelRole: 'finance' } } })
  assert.equal(outfitOf(m2.agents[0]).role, 'legal')
})

test('a model outfit changes what is drawn, and a hand-picked role cancels it', () => {
  const o = office(4, 1)
  const names = o.agents.map(a => a.name)
  const draw = (profiles, offc = o) => {
    const model = toSceneModel(offc, { nowMs: 1e12, profiles })
    const layout = layoutScene(model)
    return drawScene(layout, buildBase(layout, model), model, 0).d
  }
  const rules = draw({})
  const dressed = draw({ [names[0]]: { modelRole: 'executive' } })
  assert.ok(differing(rules, dressed) > 30, 'the agent is drawn in another outfit')
  const hand = JSON.parse(JSON.stringify(o))
  hand.agents[0].officeMeta = { role: 'none' }
  assert.equal(differing(draw({}, hand), draw({ [names[0]]: { modelRole: 'executive' } }, hand)), 0, 'manual « none » keeps the priority over the model')
})

test('modelRoles: only while the function is ON, only roles of the catalogue, seconds -> ms; withModelRoles copies', () => {
  const state = toLlm({ ok: true, available: true, features: ['outfits'], settings: { features: { outfits: true } }, fiches: { outfits: { designer: { role: 'finance', at: 1700000000 }, x: { role: 'wizard', at: 1 }, y: { role: 'constructor', at: 1 } } } })
  assert.deepEqual({ ...modelRoles(state) }, { designer: { modelRole: 'finance', modelRoleAt: 1700000000000 } })
  const off = toLlm({ ok: true, settings: { features: { outfits: false } }, fiches: { outfits: { designer: { role: 'finance', at: 1 } } } })
  assert.deepEqual({ ...modelRoles(off) }, {}, 'switched off: the rules dress again, the fiches stay on the server')
  assert.deepEqual({ ...modelRoles(null) }, {})
  const base = { designer: { description: 'd', skills: [1] } }
  const merged = withModelRoles(base, { designer: { modelRole: 'finance', modelRoleAt: 1 }, ghost: { modelRole: 'legal', modelRoleAt: null } })
  assert.deepEqual(base, { designer: { description: 'd', skills: [1] } }, 'the facts of /history are not touched')
  assert.equal(merged.designer.description, 'd')
  assert.equal(merged.designer.modelRole, 'finance')
  assert.equal(merged.ghost.modelRole, 'legal')
  assert.deepEqual({ ...withModelRoles(undefined, {}) }, {})
})

test('manualProfiles: the profiles whose role was picked by hand (a valid role or « none ») are never sent', () => {
  const agents = [{ name: 'a', officeMeta: { role: 'legal' } }, { name: 'b', officeMeta: { role: 'none' } }, { name: 'c', officeMeta: { role: 'auto' } }, { name: 'd', officeMeta: {} }, { name: 'e' }, { name: 'f', officeMeta: { role: 'wizard' } }]
  assert.deepEqual(manualProfiles(agents), ['a', 'b'])
  assert.deepEqual(manualProfiles(undefined), [])
})

test('outfitSource says where an outfit comes from (and when, for the model)', () => {
  assert.deepEqual(outfitSource({ kind: 'model', at: 9 }), { kind: 'model', at: 9 })
  assert.deepEqual(outfitSource({ kind: 'manual' }), { kind: 'manual', at: null })
  assert.deepEqual(outfitSource({ kind: 'name', hit: 'x' }), { kind: 'name', at: null })
  assert.deepEqual(outfitSource(null), { kind: 'none', at: null })
})

/* ---------- 3. the settings: states ---------- */
const served = (over = {}) => ({
  ok: true, available: true, features: [...LLM_FEATURES],
  settings: { features: { decor: true, outfits: true, art: false, seating: false, thoughts: false }, capUsd: 1, callCap: 300 },
  spend: { month: '2026-11', usd: 0, calls: 0, unpriced: 0, byFeature: {} },
  route: null, fiches: { decor: null, outfits: {}, art: {}, seating: null, thoughts: [] },
  sends: {}, costs: Object.fromEntries(LLM_FEATURES.map(f => [f, { lastUsd: null, status: null }])), ...over
})

test('toLlm: everything is OFF unless the server said true; a bad answer is no answer', () => {
  assert.equal(toLlm(null), null)
  assert.equal(toLlm({ ok: false }), null)
  assert.equal(toLlm({ ok: true }), null, 'no settings')
  const bare = toLlm({ ok: true, settings: {} })
  for (const f of LLM_FEATURES) assert.equal(bare.settings.features[f], false, `${f} is off by default`)
  assert.equal(bare.available, false)
  assert.deepEqual(bare.features, [])
  assert.equal(bare.settings.capUsd, 1)
  assert.equal(bare.settings.callCap, 300)
  const truthy = toLlm({ ok: true, settings: { features: { decor: 'yes', outfits: 1, art: true } } })
  assert.deepEqual(Object.entries(truthy.settings.features).filter(([, v]) => v).map(([k]) => k), ['art'], 'only a real true switches a function on')
  const weird = toLlm({ ok: true, settings: { capUsd: 'x', callCap: -5 }, spend: { usd: NaN, calls: 'a' }, features: ['decor', 'nope'] })
  assert.equal(weird.settings.capUsd, 1)
  assert.equal(weird.settings.callCap, 0)
  assert.equal(weird.spend.usd, 0)
  assert.deepEqual(weird.features, ['decor'])
  const s = toLlm(served({ fiches: { decor: { fiche: { view: 'sea' }, style: 'sea view', at: 5, model: 'm' }, outfits: { a: { role: 'legal', at: 2 }, b: null } } }))
  assert.equal(s.fiches.decor.style, 'sea view')
  assert.deepEqual({ ...s.fiches.outfits }, { a: { role: 'legal', at: 2 } })
})

test('settings states: off, no model, cap reached (dollars, calls), last call failed, ready — in the agent half’s order of guards', () => {
  const on = over => toLlm(served(over))
  assert.equal(featureState(on(), 'decor'), 'ready')
  assert.equal(featureState(on(), 'art'), 'off', 'a switch that is off says off')
  assert.equal(featureState(null, 'decor'), 'off')
  // no model route: the function is on but nothing can be called
  assert.equal(featureState(on({ available: false, features: [] }), 'decor'), 'unavailable')
  // dollars: spent >= cap, or the next call (at the last cost) would pass it
  assert.equal(featureState(on({ spend: { month: 'm', usd: 1, unpriced: 0 } }), 'decor'), 'cap')
  assert.equal(capReached(on({ spend: { month: 'm', usd: 1, unpriced: 0 } }), 'decor'), 'usd')
  assert.equal(capReached(on({ spend: { month: 'm', usd: 0.99995, unpriced: 0 } }), 'decor'), null, 'just under: allowed')
  assert.equal(capReached(on({ spend: { month: 'm', usd: 0.9996, unpriced: 0 }, costs: { ...served().costs, decor: { lastUsd: 0.0005, status: 'estimated' } } }), 'decor'), 'usd', 'the next call would pass the cap')
  assert.equal(capReached(on({ spend: { month: 'm', usd: 0.9996, unpriced: 0 }, costs: { ...served().costs, outfits: { lastUsd: 0.0005, status: 'estimated' } } }), 'decor'), null, 'the last cost is the function’s own')
  assert.equal(capReached(on({ settings: { features: { decor: true }, capUsd: 0, callCap: 300 } }), 'decor'), 'usd', 'a cap of 0 refuses everything')
  // calls without a known price
  assert.equal(capReached(on({ spend: { month: 'm', usd: 0, unpriced: 300 } }), 'decor'), 'calls')
  assert.equal(capReached(on({ spend: { month: 'm', usd: 0, unpriced: 299 } }), 'decor'), null)
  assert.equal(featureState(on({ spend: { month: 'm', usd: 0, unpriced: 300 } }), 'outfits'), 'cap')
  // the last call failed (the server’s cost status, or the answer the page just saw)
  assert.equal(featureState(on({ costs: { ...served().costs, decor: { lastUsd: null, status: 'error' } } }), 'decor'), 'error')
  assert.equal(featureState(on(), 'decor', { kind: 'failed' }), 'error')
  assert.equal(featureState(on(), 'decor', null), 'ready')
  // order: off, then no model, then the cap, then the error
  assert.equal(featureState(on({ available: false, features: [], spend: { month: 'm', usd: 5, unpriced: 0 } }), 'decor'), 'unavailable')
  assert.equal(featureState(on({ spend: { month: 'm', usd: 5, unpriced: 0 }, costs: { ...served().costs, decor: { lastUsd: null, status: 'error' } } }), 'decor'), 'cap')
  assert.equal(featureState(on({ settings: { features: {}, capUsd: 1, callCap: 300 }, spend: { month: 'm', usd: 5, unpriced: 0 } }), 'decor'), 'off')
  // every state has its word in the three languages
  for (const lang of ['en', 'fr', 'es']) for (const st of ['off', 'ready', 'unavailable', 'cap', 'error']) assert.ok(messages[lang].llm.state[st], `${lang} state ${st}`)
})

test('spendView: a known price counts dollars; an unknown one (or none seen yet) counts calls, with the way to a priced model', () => {
  const priced = spendView(toLlm(served({ route: { provider: 'example', model: 'm', priced: true }, spend: { month: 'm', usd: 0.25, calls: 3, unpriced: 0 } })))
  assert.equal(priced.mode, 'usd')
  assert.equal(priced.unknownPrice, false)
  assert.equal(priced.usdPct, 0.25)
  const unpriced = spendView(toLlm(served({ route: { provider: 'acme-cloud', model: 'm', priced: false }, spend: { month: 'm', usd: 0, calls: 90, unpriced: 90 } })))
  assert.equal(unpriced.mode, 'calls')
  assert.equal(unpriced.unknownPrice, true)
  assert.equal(unpriced.callsPct, 0.3)
  assert.equal(spendView(toLlm(served())).mode, 'calls', 'no route seen yet: calls, said so')
  assert.equal(spendView(toLlm(served({ spend: { month: 'm', usd: 9, unpriced: 999 }, route: { provider: 'p', model: 'm', priced: true } }))).usdPct, 1, 'the bar never passes full')
  assert.equal(spendView(null), null)
  assert.equal(spendView(toLlm(served({ settings: { features: {}, capUsd: 0, callCap: 0 } }))).usdPct, 1, 'a cap of 0 is full')
  // the unknown-price line says the way and the counts, in the three languages
  for (const lang of ['en', 'fr', 'es']) {
    const text = messages[lang].llm.unknownPrice(90, 300)
    assert.match(text, /90\/300/)
    assert.match(text, /Officecraft/)
  }
})

test('settingsBody: the whole board, flags strictly boolean, caps clamped like the server (0 to 100 $, 0 to 10 000 calls)', () => {
  const state = toLlm(served())
  assert.deepEqual(settingsBody(state, { features: { art: true } }), { features: { decor: true, outfits: true, art: true, seating: false, thoughts: false }, capUsd: 1, callCap: 300, models: { strong: null, light: null } })
  assert.equal(settingsBody(state, { capUsd: 2.5 }).capUsd, 2.5)
  assert.equal(settingsBody(state, { capUsd: 0.126 }).capUsd, 0.13, 'whole cents (the server’s step is 0.01)')
  assert.equal(settingsBody(state, { capUsd: 500 }).capUsd, 100)
  assert.equal(settingsBody(state, { capUsd: -3 }).capUsd, 0)
  assert.equal(settingsBody(state, { capUsd: 'abc' }).capUsd, 1, 'not a number: unchanged')
  assert.equal(settingsBody(state, { callCap: 99999 }).callCap, 10000)
  assert.equal(settingsBody(state, { callCap: 12.9 }).callCap, 12)
  assert.deepEqual(Object.keys(settingsBody(state, {})), ['features', 'capUsd', 'callCap', 'models'], 'exactly the closed body of POST /llm/settings')
  assert.deepEqual(Object.keys(settingsBody(state, {}).features), LLM_FEATURES)
  assert.equal(settingsBody(state, { features: { decor: 'yes' } }).features.decor, false, 'a switch is true or false, nothing in between')
})

test('parseCap: a typed cap is a number in range or nothing (the field keeps its last good value)', () => {
  assert.equal(parseCap('2.5', 'usd'), 2.5)
  assert.equal(parseCap('2,5', 'usd'), 2.5, 'decimal comma')
  assert.equal(parseCap(' 3 ', 'usd'), 3)
  assert.equal(parseCap('0', 'usd'), 0)
  assert.equal(parseCap('1000', 'usd'), 100)
  assert.equal(parseCap('1.239', 'usd'), 1.24)
  for (const bad of ['', 'abc', '-1', '1e3', '1.2.3', 'Infinity', 'NaN', '$5', null, undefined]) assert.equal(parseCap(bad, 'usd'), null, String(bad))
  assert.equal(parseCap('250', 'calls'), 250)
  assert.equal(parseCap('250.5', 'calls'), null, 'calls are whole')
  assert.equal(parseCap('999999', 'calls'), 10000)
})

/* ---------- 4. answers, data layer, sober mode ---------- */
test('readAnswer: done, refused and failed by their code; a reason the page does not know is a model error; text from the model is never shown', () => {
  const done = readAnswer({ ok: true, result: 'done', feature: 'decor', fiche: { view: 'sea' }, costUsd: 0.0003, costStatus: 'estimated' })
  assert.equal(done.kind, 'done')
  assert.equal(done.reason, null)
  assert.deepEqual(done.fiche, { view: 'sea' })
  assert.equal(costKind(done), 'known')
  assert.equal(costKind(readAnswer({ ok: true, result: 'done', costUsd: null, costStatus: 'unknown' })), 'unknown')
  assert.equal(costKind(readAnswer({ ok: true, result: 'done', costUsd: 0, costStatus: 'included' })), 'unknown', 'a subscription is not a price')
  assert.equal(costKind(readAnswer({ ok: false, result: 'failed', reason: 'model_error', costStatus: 'error' })), 'error')
  assert.equal(costKind(readAnswer({ ok: true, result: 'refused', reason: 'cap_reached', cap: 'usd', costStatus: null })), null, 'refused: nothing was called, nothing to say about cost')
  const cap = readAnswer({ ok: true, result: 'refused', reason: 'cap_reached', cap: 'calls' })
  assert.deepEqual([cap.kind, cap.reason, cap.cap], ['refused', 'cap_reached', 'calls'])
  assert.equal(readAnswer({ ok: false, result: 'failed', reason: 'Traceback (most recent call last): …' }).reason, 'model_error', 'an exception text is never a reason')
  assert.equal(readAnswer({ ok: false, result: 'failed', reason: 'invalid_output' }).reason, 'invalid_output')
  assert.equal(readAnswer({ result: 'weird' }), null)
  assert.equal(readAnswer(null), null)
  assert.equal(readAnswer({ ok: true, result: 'done', reset: true }).reset, true)
  assert.equal(answerOfError({ body: { ok: false, reason: 'busy' } }).reason, 'busy', 'HTTP 409')
  assert.equal(answerOfError(new Error('network')).reason, 'unreachable')
  assert.equal(answerOfError({ body: { reason: '<img onerror=x>' } }).reason, 'unreachable')
  for (const lang of ['en', 'fr', 'es']) for (const r of REASONS) assert.ok(messages[lang].llm.reason[r], `${lang}.llm.reason.${r}`)
})

test('what is sent: the style cleaned and bounded, the id and the language; outfits skip the hand-picked profiles', () => {
  assert.equal(cleanStyle('  scandinavian   office\n sea view '), 'scandinavian office sea view')
  assert.equal(cleanStyle('   '), null)
  assert.equal(cleanStyle('x'.repeat(500)).length, 280)
  assert.deepEqual(decorBody('id-1', 'scandinavian office, sea view', 'fr'), { id: 'id-1', style: 'scandinavian office, sea view', lang: 'fr' })
  assert.equal(decorBody('id', 'x', 'de').lang, 'en')
  assert.deepEqual(Object.keys(decorBody('id', 'x', 'en')), ['id', 'style', 'lang'], 'the closed body of POST /llm/decor')
  assert.deepEqual(outfitsBody('id', ['a', 'a', 'b'], 'es'), { id: 'id', skip: ['a', 'b'], lang: 'es' })
  assert.equal(outfitsBody('id', Array.from({ length: 100 }, (_, i) => `p${i}`), 'en').skip.length, 64)
  assert.equal(formatUsd(0.000322, 'en'), '0.0003')
  assert.equal(formatUsd(0.5, 'en'), '0.50')
  assert.equal(formatUsd(0, 'en'), '0.00')
  assert.equal(formatUsd(NaN), '')
})

test('sober mode shows nothing of the LLM: no decor, no model outfit, no button; the same state outside sober shows them', () => {
  const state = toLlm(served({ fiches: { decor: { fiche: { view: 'sea', floor: 'concrete' }, style: 's', at: 1, model: 'm' }, outfits: { a: { role: 'legal', at: 2 } } } }))
  const shown = llmView(state, false)
  assert.equal(shown.on, true)
  assert.equal(shown.style.view, 'sea')
  assert.deepEqual(Object.keys(shown.roles), ['a'])
  assert.equal(shown.decorReady, true)
  const sober = llmView(state, true)
  // the wall art, the seating and the bubbles are in the view too: nothing of them either
  const NOTHING = { on: false, style: null, roles: {}, decorReady: false, milestones: [], pending: [], posters: [], artReady: false, seating: null, seatingReady: false, thoughts: {}, thoughtsReady: false, recruitReady: false, reviseReady: false, work: { recruit: false, revise: false, campaign: false, cardbody: false, lint: false } }
  assert.deepEqual(sober, NOTHING)
  assert.deepEqual(llmView(null, false), NOTHING, 'no agent half answer: nothing')
  // switched off: the office keeps its default look, whatever the server remembers
  const off = llmView(toLlm(served({ settings: { features: {}, capUsd: 1, callCap: 300 }, fiches: { decor: { fiche: { view: 'sea' }, style: 's', at: 1, model: 'm' }, outfits: { a: { role: 'legal', at: 2 } } } })), false)
  assert.equal(off.style, null)
  assert.deepEqual({ ...off.roles }, {})
  assert.equal(off.decorReady, false)
  // no model route: no button either
  assert.equal(llmView(toLlm(served({ available: false, features: [] })), false).decorReady, false)
  assert.equal(decorStyle(state).floor, 'concrete')
  // and a sober scene is the plain one: no style in the model it draws
  assert.equal(toSceneModel(office(1, 1), { nowMs: 1, decor: { sober: true } }).decor.style, null)
})

test('data layer: a saved board goes into the shared cache; a call never throws and the state is read again; no route = no request', async () => {
  const sent = []
  const cache = { writes: [], invalidated: [], setQueryData(k, v) { this.writes.push([k, v]) }, invalidateQueries(q) { this.invalidated.push(q.queryKey) } }
  initLlm({ rest: async (path, opts) => { sent.push([path, opts?.method, opts?.body]); if (path === '/llm/settings') return served({ settings: { features: { decor: true }, capUsd: 2, callCap: 300 } }); return { ok: true, result: 'done', feature: 'decor', fiche: { view: 'sea' }, costUsd: 0.0003, costStatus: 'estimated' } } })
  const saved = await saveLlm({ features: { decor: true }, capUsd: 2, callCap: 300 }, cache)
  assert.equal(saved.ok, true)
  assert.deepEqual(cache.writes[0][0], LLM_KEY)
  assert.equal(cache.writes[0][1].settings.capUsd, 2)
  const answer = await callLlm('/llm/decor', { id: 'i', style: 's', lang: 'en' }, cache)
  assert.equal(answer.kind, 'done')
  assert.deepEqual(cache.invalidated, [LLM_KEY], 'the spend and the fiche come from the server again')
  assert.deepEqual(sent.map(s => s.slice(0, 2)), [['/llm/settings', 'POST'], ['/llm/decor', 'POST']])
  // 409 busy and a lost request are answers, not exceptions
  initLlm({ rest: async () => { const e = new Error('409'); e.body = { ok: false, reason: 'busy' }; throw e } })
  assert.equal((await callLlm('/llm/outfits', { id: 'i' }, cache)).reason, 'busy')
  initLlm({ rest: async () => { throw new Error('down') } })
  assert.equal((await callLlm('/llm/outfits', { id: 'i' }, cache)).reason, 'unreachable')
  assert.deepEqual(await saveLlm({}, null), { ok: false, reason: 'failed' })
  // no REST door (an older host): nothing is sent, and it says so
  initLlm({})
  assert.equal((await callLlm('/llm/decor', { id: 'i' }, cache)).reason, 'unreachable')
  assert.deepEqual(await saveLlm({}, cache), { ok: false, reason: 'unreachable' })
  // a body that is not an answer of the agent half is not trusted
  initLlm({ rest: async () => ({ hello: 'world' }) })
  assert.equal((await callLlm('/llm/decor', { id: 'i' }, cache)).kind, 'failed')
})

test('nothing calls a model by itself: the routes are posted from gestures only, the state is read (never a model call) at most once a minute', () => {
  const data = src('src/data/llm.js')
  assert.ok(LLM_POLL_MS >= 5000 && LLM_POLL_MS <= 60_000, 'the fiches are re-read at most once a minute (>= 5 s)')
  const block = data.slice(data.indexOf('useQuery({'), data.indexOf('\n  })', data.indexOf('useQuery({')))
  assert.match(block, /refetchIntervalInBackground: false/)
  assert.match(block, /refetchOnReconnect: false/)
  assert.match(block, /refetchInterval: poll \? LLM_POLL_MS : false/)
  assert.doesNotMatch(block, /method: 'POST'/, 'the query only reads')
  // the page reads `/llm` only when the agent half says it serves it, and starts no call
  const page = src('src/ui/OfficePage.jsx')
  assert.match(page, /useLlm\(\{ enabled: reads\.includes\('llm'\), poll: (?:true|!replayOn) \}\)/)
  assert.doesNotMatch(page, /callLlm|useLlmActions|\bcall\(/, 'the page never calls a model itself')
  // the only places that start a call are the buttons of the two components (a handler each), never an effect
  const form = src('src/ui/SettingsFormLlm.jsx')
  const dialog = src('src/ui/DecorDialog.jsx')
  assert.equal((form.match(/call\('\/llm\//g) || []).length, 2, 'the outfits and the wall art: one handler each')
  assert.match(form, /const paint = async \(\) => \{[^}]*call\('\/llm\/art'/s)
  assert.equal((dialog.match(/call\('\/llm\//g) || []).length, 4, 'the decor call, its automatic apply (window kept open), and the two clicks Apply / Ignore')
  assert.match(dialog, /const resolve = async choice => \{[^}]*call\('\/llm\/decor\/resolve'/s)
  assert.match(form, /const dress = async \(\) => \{[^}]*call\('\/llm\/outfits'/s)
  assert.match(dialog, /const run = async e => \{[^}]*call\('\/llm\/decor'/s)
  assert.match(dialog, /const revert = async \(\) => \{[^}]*call\('\/llm\/decor\/reset'/s)
  for (const text of [form, dialog]) for (const m of text.matchAll(/useEffect\(\(\) => \{([^]*?)\n  \}, \[/g)) assert.doesNotMatch(m[1], /call\(/, 'an effect never calls a model')
  // a switch is a save, not a call
  assert.match(form, /onChange=\{checked => apply\(\{ features: \{ \[f\]: checked \} \}\)\}/)   // the Switch of SettingsKit hands over event.target.checked
})

test('the strings: every function has its name, what it does, what is sent and what it costs, in en, fr and es', () => {
  for (const lang of ['en', 'fr', 'es']) {
    for (const f of LLM_FEATURES) for (const k of ['name', 'what', 'sends', 'cost']) assert.ok(messages[lang].llm.f[f][k]?.length > 3, `${lang} ${f}.${k}`)
    for (const k of ['usd', 'calls']) assert.ok(messages[lang].llm.capReached[k])
    assert.match(messages[lang].llm.sends('X'), /X/)
    assert.match(messages[lang].llm.cost('Y'), /Y/)
    assert.ok(messages[lang].llm.outfits.tip)
    assert.ok(messages[lang].llm.outfits.source(''))
    assert.match(messages[lang].llm.outfits.source('2 h'), /2 h/)
  }
  assert.match(messages.fr.llm.outfits.tip, /choisie par le modèle/)
})
}

// ===== decorator =====
{
// The decorator's art-direction guard.
// A fiche is any closed JSON the model returns; whatever its colours, the engine draws a lit human office in the house palette's
// ranges: walls, floor and desks keep their light, no surface goes neon, a black or white fiche keeps depth. Fiches already inside
// those ranges are drawn exactly.
const light = c => (Math.max(...c) + Math.min(...c)) / 510
const T = 1 / 255   // drawn colours are rounded to whole channel values
const chroma = c => (Math.max(...c) - Math.min(...c)) / 255
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const Y = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
const ratio = (a, b) => (Math.max(Y(a), Y(b)) + 0.05) / (Math.min(Y(a), Y(b)) + 0.05)
const hx = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))

const EXTREME = {
  neon: { left: '#1a0b2e', back: '#12061f', wainscot: '#ff00ff', floor: 'concrete', planks: ['#00ffe1', '#00e5ff', '#14fff0', '#00d0ff'], seam: '#ff00aa', view: 'city', sofa: '#ff00ff', cushion: '#ffff00', cabinets: '#00ff66', desk: '#00ffff' },
  black: { left: '#0b0b0b', back: '#060606', wainscot: '#000000', floor: 'planks', planks: ['#111111', '#0e0e0e', '#141414', '#0c0c0c'], seam: '#000000', view: 'forest', sofa: '#1a1a1a', cushion: '#2a0000', cabinets: '#0d0d0d', desk: '#151515' },
  white: { left: '#ffffff', back: '#ffffff', wainscot: '#ffffff', floor: 'concrete', planks: ['#ffffff', '#ffffff', '#fefefe', '#ffffff'], seam: '#ffffff', view: 'sea', sofa: '#ffffff', cushion: '#ffffff', cabinets: '#ffffff', desk: '#ffffff' },
  candy: { left: '#ff9ecf', back: '#ff8cc6', wainscot: '#ff4fa8', floor: 'planks', planks: ['#ffb3d9', '#ffa6d2', '#ffc0e0', '#ff99cc'], seam: '#e0559a', view: 'sea', sofa: '#ff3399', cushion: '#ffe14d', cabinets: '#c266ff', desk: '#ffe6f2' }
}

test('the default style is drawn exactly (inside the art direction already)', () => {
  for (const f of [STYLE_BASE]) {
    const s = normalizeStyle(f)
    const d = drawnColors(s)
    for (const k of ['left', 'back', 'wainscot', 'seam', 'sofa', 'cushion', 'cabinets', 'desk']) assert.equal(hexOf(d[k]), s[k], `${k} of ${JSON.stringify(f).slice(0, 40)}`)
    assert.deepEqual(d.planks.map(hexOf), [...s.planks])
  }
})

test('an extreme fiche stays a lit office: no neon surface, walls / floor / desks keep their light and their depth', () => {
  for (const [name, f] of Object.entries(EXTREME)) {
    const d = drawnColors(normalizeStyle(f))
    for (const k of ['left', 'back']) assert.ok(light(d[k]) >= 0.34 - T && light(d[k]) <= 0.96 + T && chroma(d[k]) <= 0.38 + T, `${name} ${k} ${hexOf(d[k])}`)
    for (const p of d.planks) assert.ok(light(p) >= 0.26 - T && light(p) <= 0.82 + T && chroma(p) <= 0.42 + T, `${name} plank ${hexOf(p)}`)
    assert.ok(light(d.desk) >= 0.62 - T && chroma(d.desk) <= 0.28 + T, `${name} desk ${hexOf(d.desk)}`)
    for (const k of ['sofa', 'cushion', 'cabinets', 'wainscot']) assert.ok(chroma(d[k]) <= 0.62 + T, `${name} ${k} ${hexOf(d[k])}`)
    assert.ok(light(d.back) < light(d.left), `${name}: the back wall stays darker than the lit left wall`)
    assert.ok(ratio(d.desk, d.planks[0]) >= 1.3, `${name}: desks stand out of the floor (${ratio(d.desk, d.planks[0]).toFixed(2)})`)
  }
  // measured before the guard: a neon desk on a neon floor was 1.02:1, a black or white room 1.00-1.03:1
  assert.ok(ratio(hx(EXTREME.neon.desk), hx(EXTREME.neon.planks[0])) < 1.1)
})

test('the guard only ever moves a colour from the house colour toward the fiche’s (the fiche is still what is drawn)', () => {
  for (const f of Object.values(EXTREME)) {
    const s = normalizeStyle(f)
    const d = drawnColors(s)
    for (const k of ['left', 'wainscot', 'sofa', 'cushion', 'cabinets', 'desk', 'seam']) {
      const from = hx(STYLE_BASE[k]), want = hx(s[k]), got = d[k]
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
      assert.ok(dist(got, want) <= dist(from, want) + 1, `${k}: ${hexOf(got)} is not nearer ${s[k]} than the house ${STYLE_BASE[k]}`)
    }
  }
})

test('PAL says the drawn colours, and setStyle(null) gives the default office back', () => {
  const s = normalizeStyle(EXTREME.neon)
  setStyle(s)
  const d = drawnColors(s)
  assert.deepEqual([...PAL.wallL], [...d.left])
  assert.deepEqual([...PAL.deskT], [...d.desk])
  assert.deepEqual(PAL.plank.map(c => [...c]), d.planks.map(c => [...c]))
  setStyle(null)
  assert.equal(PAL.sofa[0], 0x5d)
})

/* ---------- thought bubbles ---------- */
test('a list row with a thought keeps the bubble inside its frame (the border is on the whole row, not on the chip above it)', async () => {
  const { SCENE_CSS } = await import('../../src/ui/sceneStyles.js')
  assert.match(SCENE_CSS, /\.oc-lrow:has\(\.oc-lthought\)\{border:1px solid/)
  assert.match(SCENE_CSS, /\.oc-lrow:has\(\.oc-lthought\) \.oc-chip\{border-color:transparent/)
  assert.match(SCENE_CSS, /\.oc-lrow\[aria-pressed="true"\]:has\(\.oc-lthought\)\{border-color:var\(--sel\)\}/, 'the selected row still says it (in its state hue, --sel)')
  assert.match(SCENE_CSS, /\.oc-s-waiting\{--sel:/, 'the selection hue follows the state')
})

test('no text of the scene overlay under 11 px (bubbles and their AI tag included)', async () => {
  const { SCENE_CSS } = await import('../../src/ui/sceneStyles.js')
  const sizes = [...SCENE_CSS.matchAll(/font-size:([\d.]+)px/g)].map(m => Number(m[1]))
  assert.ok(sizes.length > 10)
  assert.deepEqual(sizes.filter(s => s < 11), [])
})
}

// ===== decorator =====
{
// drawScene() must draw the decorator's style of ITS model whatever buildBase() ran last (src/scene/style.js promises « the same
// model always gives the same pixels whatever was drawn before »). A test that rebuilds the base right before drawing
// would not see setStyle() removed from drawScene, so the base and the frame are built apart here.
const sha = d => createHash('sha256').update(d).digest('hex')
function office(nAgents, nBoards) {
  const boards = Array.from({ length: nBoards }, (_, i) => ({ slug: `b${i}`, counts: { todo: i + 1, running: 1, blocked: 0, done: 5 * i }, total: 10 * i + 3, blocked: [] }))
  const agents = Array.from({ length: nAgents }, (_, i) => ({ name: `agent-${i}`, state: ['working', 'idle', 'waiting'][i % 3], home: boards[i % nBoards].slug, description: '', lastActivityMs: 1, officeMeta: {} }))
  return { agents, boards, ops: null }
}

test('drawScene draws its own model’s style even when another base (another style, or none) was built in between', () => {
  const style = { sofa: '#00ff00', desk: '#ff00ff', cabinets: '#0000ff', cushion: '#ff0000', view: 'sea', floor: 'concrete' }
  for (const night of [false, true]) {
    const styled = toSceneModel(office(6, 2), { nowMs: 1e12, night, decor: { style } })
    const layout = layoutScene(styled)
    const base = buildBase(layout, styled)
    const ref = sha(drawScene(layout, base, styled, 3).d)
    // something else is built between two frames of the page (a postcard or a preview of another office): the default style
    const plain = toSceneModel(office(6, 2), { nowMs: 1e12, night })
    buildBase(layoutScene(plain), plain)
    assert.equal(sha(drawScene(layout, base, styled, 3).d), ref, `the styled frame is drawn with the default furniture (${night ? 'night' : 'day'})`)
    // and the other way round: a default frame after a styled base
    const plainLayout = layoutScene(plain)
    const plainBase = buildBase(plainLayout, plain)
    const plainRef = sha(drawScene(plainLayout, plainBase, plain, 3).d)
    buildBase(layout, styled)
    assert.equal(sha(drawScene(plainLayout, plainBase, plain, 3).d), plainRef, 'the default frame keeps the styled furniture')
  }
})

}

// ===== decorator =====
{
// Leaving the page (the Decorator window unmounts, it is never « closed ») while a call is in flight must not apply the
// style by itself: the dialog never sends POST /llm/decor/resolve { choice: "apply" } on its own, without a click on « Apply ».
// The window cannot be rendered under node (no React, no DOM in this repo's tests): the guard is checked where it lives, with the pure rule.
const dlg = readFileSync(new URL('../../src/ui/DecorDialog.jsx', import.meta.url), 'utf8')

test('the Decorator marks a call in flight as « closed » when the window unmounts (page left), not only when it closes', () => {
  // an effect whose cleanup (unmount) marks the flying call closed: its answer then stays pending
  assert.match(dlg, /useEffect\(\(\) => \(\) => \{\s*if \(pendingRef\.current\) closedRef\.current = true\s*\}, \[\]\)/)
  // and the answer is applied by itself only through the pure rule that reads that mark
  assert.match(dlg, /decorAppliesNow\(a, closedRef\.current\)/)
  const done = { kind: 'done', fiche: { floor: 'planks' }, reset: false }
  assert.equal(decorAppliesNow(done, true), false, 'marked closed (closed or unmounted): kept, never applied by itself')
})
}
