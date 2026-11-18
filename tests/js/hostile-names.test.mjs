// A bot may be called `constructor`: Hermes accepts the name, and so does the Recruit window. Tables indexed by a bot's
// name must not read Object.prototype for it: the whole page would throw for as long as that profile exists.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { computeGame } from '../../src/core/game.js'
import { sceneProfiles, toHistory } from '../../src/core/history.js'
import { buildOffice } from '../../src/core/office.js'
import { buildRoster } from '../../src/core/roster.js'
import { thoughtsShown } from '../../src/core/thoughts.js'
import { buildBase, drawScene, layoutScene, toSceneModel } from '../../src/scene/index.js'

const example = JSON.parse(readFileSync(new URL('./fixtures/example-office.json', import.meta.url), 'utf8'))
const NOW = example.generatedAt * 1000
const NAME = 'constructor'

// the example office, one of its bots renamed everywhere it is named
const renamed = JSON.parse(JSON.stringify(example).replaceAll(`"${example.profiles[1].name}"`, `"${NAME}"`))

test('an office with a bot called `constructor` is read, scored and drawn like any other', () => {
  const rows = renamed.profiles.map(p => ({ name: p.name, description: p.description, last_session: null, worker_session: null }))
  const office = buildOffice(buildRoster({ profiles: rows }, NOW), { ok: true, boards: renamed.boards, ops: renamed.ops }, NOW)
  assert.ok(office.agents.some(a => a.name === NAME))

  const history = toHistory({ ok: true, at: example.generatedAt, profiles: renamed.profiles, boards: renamed.boards || [] })
  assert.equal(history.ok, true)
  assert.ok(Object.hasOwn(history.profiles, NAME), 'the profile is kept under its own name')
  assert.equal(typeof history.profiles[NAME], 'object')

  const profiles = sceneProfiles(history, office.agents, NOW)
  assert.ok(Array.isArray(profiles[NAME].skills))

  const game = computeGame(history, office, NOW, {})
  assert.equal(typeof game.grades[NAME], 'object', 'its grade is a grade, not a function inherited from Object')

  const model = toSceneModel(office, { nowMs: NOW, profiles })
  const layout = layoutScene(model)
  assert.ok(drawScene(layout, buildBase(layout, model), model, 0).d.length > 0)
})

test('a history without that bot does not invent one from Object.prototype', () => {
  const history = toHistory({ ok: true, profiles: [], boards: [] })
  assert.deepEqual({ ...sceneProfiles(history, [{ name: NAME }], NOW) }, {})
  assert.equal(history.profiles[NAME], undefined)
})

test('thought bubbles: only the agents at work, whatever their name', () => {
  const state = { settings: { features: { thoughts: true } }, fiches: { thoughts: [{ name: NAME, text: 'Reading the brief.' }] } }
  const shown = thoughtsShown(state, [{ name: NAME, state: 'working' }])
  assert.deepEqual(Object.keys(shown), [NAME])
  assert.deepEqual(Object.keys(thoughtsShown(state, [{ name: 'other', state: 'working' }])), [])
})

// A session title is read straight from Hermes (`session.active_list`), not through the agent half: bidi overrides and
// zero-width characters must not reorder or hide the text of an approval's confirmation.
test('a session title reaches the approval card without control, bidi or zero-width characters', async () => {
  const { approvalsReducer, emptyApprovals } = await import('../../src/core/approvals.js')
  const hostile = 'deploy\u202e gnp.exe\u2066\u200b\u2028 now\u0007'
  const state = approvalsReducer(emptyApprovals(), { type: 'titles', titles: { s1: hostile } })
  assert.equal(state.titles.s1, 'deploy gnp.exe now')
})
