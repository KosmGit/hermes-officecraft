/**
 * The two models (strong, light) as the page reads and posts them: pure functions of src/core/llm.js.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { LLM_FEATURES, LLM_LANES, LLM_LANE_OF, OVERRIDE_STATES, cleanModelPick, laneModel, settingsBody, toLlm } from '../../src/core/llm.js'

const LIGHT = { provider: 'example', model: 'example/model-fast' }
const STRONG = { provider: 'acme-cloud', model: 'example/model-large' }
const served = (extra = {}) => ({
  ok: true, available: true, features: ['decor'], override: 'granted',
  settings: { features: { decor: true }, capUsd: 1, callCap: 300, models: { strong: STRONG, light: LIGHT } },
  lanes: {
    strong: { via: 'model', task: null, provider: STRONG.provider, model: STRONG.model, priced: false, busy: null },
    light: { via: 'model', task: null, provider: LIGHT.provider, model: LIGHT.model, priced: true, busy: { feature: 'decor', id: 'x', since: 5 } }
  },
  routes: { decor: { lane: 'light', via: 'model', provider: LIGHT.provider, model: LIGHT.model } },
  spend: {}, fiches: {}, costs: {}, ...extra
})
const TASK_ROUTE = { via: 'task', provider: null, model: null, task: null, priced: null, busy: null }

// the same cases as tests/python/test_llm_lanes.py BAD_PICKS (the two sides must agree on what is empty)
const BAD = [
  'model-x', 5, true, [], [LIGHT], {}, { provider: 'example' }, { model: 'm' }, { provider: '', model: 'm' }, { provider: 'p', model: '' },
  { provider: 1, model: 'm' }, { provider: 'p', model: null }, { provider: ['p'], model: 'm' }, { ...LIGHT, extra: 1 },
  { provider: 'p'.repeat(101), model: 'm' }, { provider: 'p', model: 'm'.repeat(201) }, { provider: 'p\u0000', model: 'm' }, { provider: 'p', model: 'm\nx' },
  { provider: 'p q', model: 'm' }, { provider: 'p', model: 'a b' }, { provider: 'p', model: 'm\u202e' }, { provider: 'p', model: 'm\u200b' },
  { provider: 'p', model: 'm\u2028' }, { provider: ' p', model: 'm' }, { provider: 'example', model: 'sk-abcdefghijklmnopqrstuv' },
  { provider: 'example', model: 'Bearer abcdefghijkl' }, { provider: 'example', model: 'a'.repeat(32) }, { provider: 'example', model: `AIza${'x'.repeat(24)}` },
  null, undefined
]

test('cleanModelPick: exactly { provider, model }, anything invalid is « the model of Hermes » (null), never an exception', () => {
  assert.deepEqual(cleanModelPick(LIGHT), LIGHT)
  assert.deepEqual(cleanModelPick({ provider: 'p', model: 'm'.repeat(200) }), { provider: 'p', model: 'm'.repeat(200) }, 'the bound itself is allowed')
  BAD.forEach((bad, i) => assert.equal(cleanModelPick(bad), null, `case ${i}`))
  assert.notEqual(cleanModelPick(LIGHT), LIGHT, 'a copy, never the object the caller holds')
})

test('the lane table is the one of the agent half, and every function is on exactly one lane', () => {
  const src = readFileSync(new URL('../../hermes_officecraft/llm.py', import.meta.url), 'utf8')
  const block = src.slice(src.indexOf('LANE_OF: dict'), src.indexOf('PLAN_TASK'))
  const python = Object.fromEntries([...block.matchAll(/"(\w+)": "(strong|light)"/g)].map(m => [m[1], m[2]]))
  assert.deepEqual(LLM_LANE_OF, python)
  assert.deepEqual([...LLM_LANES], ['strong', 'light'])
  for (const f of LLM_FEATURES) assert.ok(LLM_LANES.includes(LLM_LANE_OF[f]), f)
  assert.equal(Object.isFrozen(LLM_LANE_OF), true)
})

test('laneModel: its own, else the other one when it is the only one filled, else none', () => {
  assert.deepEqual(laneModel({ strong: STRONG, light: LIGHT }, 'light'), LIGHT)
  assert.deepEqual(laneModel({ strong: STRONG, light: LIGHT }, 'strong'), STRONG)
  assert.deepEqual(laneModel({ strong: STRONG, light: null }, 'light'), STRONG)
  assert.deepEqual(laneModel({ strong: null, light: LIGHT }, 'strong'), LIGHT)
  assert.equal(laneModel({ strong: null, light: null }, 'light'), null)
  assert.equal(laneModel({ strong: { provider: 'p' }, light: 'x' }, 'light'), null, 'an invalid choice does not count as filled')
  assert.equal(laneModel(undefined, 'strong'), null)
})

test('toLlm reads the override, the two models, the lanes and what each function will take', () => {
  const s = toLlm(served())
  assert.equal(s.override, 'granted')
  assert.deepEqual(s.settings.models, { strong: STRONG, light: LIGHT })
  assert.deepEqual(s.lanes.light, { via: 'model', provider: LIGHT.provider, model: LIGHT.model, task: null, priced: true, busy: { feature: 'decor', since: 5 } })
  assert.equal(s.lanes.strong.priced, false)
  assert.deepEqual(s.routes.decor, { lane: 'light', via: 'model', provider: LIGHT.provider, model: LIGHT.model })
  assert.deepEqual(Object.keys(s.routes), ['decor'], 'only what the server served, for a function this page knows')
})

test('toLlm: an older agent half (no new field) reads as unsupported and « the model of Hermes », nothing breaks', () => {
  const old = toLlm({ ok: true, available: true, settings: { features: { decor: true }, capUsd: 1, callCap: 300 } })
  assert.equal(old.override, 'unsupported')
  assert.deepEqual(old.settings.models, { strong: null, light: null })
  assert.deepEqual(old.lanes.light, TASK_ROUTE)
  assert.deepEqual(old.routes, {})
})

test('toLlm: garbage in the new fields is dropped, never shown as it came', () => {
  const s = toLlm(served({
    override: 'maybe',
    settings: { features: {}, models: { strong: { ...STRONG, extra: 1 }, light: { provider: 'p', model: 'sk-abcdefghijklmnopqrstuv' }, other: LIGHT } },
    lanes: { strong: 'x', light: { via: 'weird', provider: 5, model: ['m'], task: 7, priced: 'yes', busy: { feature: 3 } }, other: {} },
    routes: { decor: 'x', nope: { via: 'model', model: 'm' }, art: { lane: 'strong', via: 'model', provider: 'p', model: 'm' } }
  }))
  assert.ok(OVERRIDE_STATES.includes(s.override) && s.override === 'unsupported')
  assert.deepEqual(s.settings.models, { strong: null, light: null })
  assert.deepEqual(s.lanes.strong, TASK_ROUTE)
  assert.deepEqual(s.lanes.light, TASK_ROUTE)
  assert.deepEqual(Object.keys(s.lanes), ['strong', 'light'])
  assert.deepEqual(s.routes, { art: { lane: 'light', via: 'model', provider: 'p', model: 'm' } }, 'the lane of a function is the table of the code, whatever the server said')
})

test('settingsBody: both lanes are sent, a change replaces one lane, an invalid pick is null', () => {
  const state = toLlm(served())
  assert.deepEqual(settingsBody(state, {}).models, { strong: STRONG, light: LIGHT })
  assert.deepEqual(settingsBody(state, { models: { light: null } }).models, { strong: STRONG, light: null }, 'null = the model of Hermes')
  assert.deepEqual(settingsBody(state, { models: { strong: LIGHT } }).models, { strong: LIGHT, light: LIGHT })
  assert.deepEqual(settingsBody(state, { models: { light: { provider: 'p' } } }).models, { strong: STRONG, light: null })
  assert.deepEqual(Object.keys(settingsBody(state, {})), ['features', 'capUsd', 'callCap', 'models'], 'exactly the closed body of POST /llm/settings')
  assert.deepEqual(Object.keys(settingsBody(state, {}).models), ['strong', 'light'])
  const none = toLlm({ ok: true, settings: { features: {} } })
  assert.deepEqual(settingsBody(none, {}).models, { strong: null, light: null })
})
