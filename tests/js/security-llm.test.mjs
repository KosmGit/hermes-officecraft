/* Security of the LLM functions, on the page's side.

   A model or provider NAME the agent half reports (the route of a lane or a function in `GET /llm`, the last route of the spend, the model
   a call used in its answer) could be any string, any length, a bidirectional or invisible character, a
   value shaped like a key. The rule of `looksSecret` (src/core/modelOptions.js) covers `model.options` and the stored picks only. A
   reported name is kept for display only when it reads like a name; else it is null (nothing shown, nothing kept). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { reportedName, toLlm } from '../../src/core/llm.js'
import { readDraftAnswer } from '../../src/core/llmDraft.js'
import { readLintAnswer } from '../../src/core/llmReview.js'

// shapes of a key, built at run time (no literal key in the repository)
const KEYS = ['sk-' + 'A1'.repeat(12), 'Bearer ' + 'x'.repeat(16), 'ghp_' + 'Z'.repeat(20), 'eyJ' + 'a'.repeat(12) + '.' + 'b'.repeat(8), 'f'.repeat(40)]
const BAD = [...KEYS, 'a\u202Eb', 'a\u200bb', 'a\u2066b', 'a\nb', '\ufeffm', 'm'.repeat(201), '', 12, null, {}]
const GOOD = ['example/model-fast-v4.1-1017', 'model-large-5-5[1m]', 'acme-cloud', 'example/model-xl-4', 'model-5.1 mini']

test('reportedName keeps a name and drops a key shape, an invisible character, a line, an overlong or non-string value', () => {
  for (const v of GOOD) assert.equal(reportedName(v), v, JSON.stringify(v))
  for (const v of BAD) assert.equal(reportedName(v), null, JSON.stringify(v))
})

const llmBody = model => ({
  ok: true, available: true, features: ['lint'], override: 'granted',
  settings: { features: { lint: true }, capUsd: 1, callCap: 300, models: { strong: null, light: null } },
  lanes: { strong: { via: 'model', task: null, provider: model, model, priced: false }, light: { via: 'task', task: 'officecraft', provider: model, model } },
  routes: { campaign: { lane: 'strong', via: 'model', provider: model, model }, lint: { lane: 'light', via: 'task', provider: model, model } },
  route: { provider: model, model, priced: false },
  fiches: { decor: { fiche: { wall: '#112233' }, style: 's', at: 1, model } }
})

test('GET /llm: a reported model or provider shaped like a key, or with an invisible character, never enters the state', () => {
  for (const v of BAD.filter(x => typeof x === 'string' && x)) {
    const s = toLlm(llmBody(v))
    const seen = JSON.stringify([s.lanes, s.routes, s.route, s.fiches.decor?.model])
    assert.equal(seen.includes(v), false, JSON.stringify(v))
    assert.equal(s.routes.campaign.model, null)
    assert.equal(s.lanes.strong.provider, null)
    assert.equal(s.route.model, '')
    assert.equal(s.fiches.decor.model, '')
  }
  for (const v of GOOD) {
    const s = toLlm(llmBody(v))
    assert.deepEqual([s.routes.campaign.model, s.lanes.strong.provider, s.route.model, s.fiches.decor.model], [v, v, v, v])
  }
})

test('the answer of a draft call (and of the review): the model it used is shown only when it reads like a name', () => {
  for (const v of BAD) {
    const a = readDraftAnswer({ result: 'done', fiche: {}, model: v, provider: v })
    assert.deepEqual([a.model, a.provider], [null, null], JSON.stringify(v))
    const l = readLintAnswer({ result: 'done', fiche: { findings: [] }, model: v, provider: v })
    assert.deepEqual([l.model, l.provider], [null, null], JSON.stringify(v))
  }
  for (const v of GOOD) assert.equal(readDraftAnswer({ result: 'done', fiche: {}, model: v }).model, v)
})
