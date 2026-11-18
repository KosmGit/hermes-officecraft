/* The page's side of the two models, the assisted recruitment and the revision of a bot, as data (src/core/llmSettings.js,
   src/core/llmAssist.js, the order of « Apply » in src/core/orders.js). Pure functions and stand-ins for the host: no model, no Hermes, no DOM. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { test } from 'node:test'

import { LLM_ALL, LLM_FEATURES, LLM_WORK, REASONS, llmView, toLlm, workReady } from '../../src/core/llm.js'
import { mergeRecruit, mergeRevise, readDescriptionOf, runRevise } from '../../src/core/llmDraft.js'
import {
  MARK_FIELDS, MERGE_ERRORS, REFUSAL_CODES, canRevise, formatWait, liftMarks, marksOf, pendingOffer, readMark, refusalOf, reviseApplicable, shownDescription, soulChoice, unreadCount
} from '../../src/core/llmAssist.js'
import { toDesk } from '../../src/core/roster.js'
import { formatRelative } from '../../src/core/time.js'
import { GRANT_COMMAND, LIST_FALLBACKS, modelChoices, pickFromValue, settingsView, shortModel } from '../../src/core/llmSettings.js'
import { ORDERS, orderReducer, reviseTarget, initialOrderState, toJournal } from '../../src/core/orders.js'
import { routeOf, rereadOf, focusTarget } from '../../src/core/orderflow.js'
import { hireDraft, hirePayload } from '../../src/core/recruit.js'
import { llmTabBadge } from '../../src/core/settings.js'
import { messages } from '../../src/i18n/index.js'
import { leaves } from '../../src/core/translate.js'

// data/recruit.js imports the host SDK (through rpc.js), absent under node: a stand-in (as recruit.test.mjs); the tests pass their own `request`
const STUB = 'export const host = { request: () => { throw new Error(\'no host\') } }'
const dataUrl = s => `data:text/javascript,${encodeURIComponent(s)}`
register(dataUrl(`const M = { '@hermes/plugin-sdk': ${JSON.stringify(dataUrl(STUB))} }\nexport async function resolve(s, c, next) { return M[s] ? { url: M[s], shortCircuit: true } : next(s, c) }`))
const { sendRevise, verifyRevise } = await import('../../src/data/recruit.js')

const FIX = JSON.parse(readFileSync(new URL('./fixtures/llm-recruit-answers.json', import.meta.url), 'utf8'))
const roster = FIX.roster
const src = p => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')

const body = over => ({
  ok: true, available: true, features: [...LLM_ALL], override: 'granted',
  settings: { features: { recruit: true, revise: true, decor: true }, capUsd: 1, callCap: 300, models: { strong: null, light: null } },
  spend: {}, fiches: {}, costs: {}, pending: {}, ...over
})
const PAIR_A = { provider: 'acme-cloud', model: 'example/model-large' }
const PAIR_B = { provider: 'acme-cloud', model: 'example/model-fast-1017' }
const READY = { state: 'ready', providers: [{ slug: 'acme-cloud', name: 'Acme Cloud', ready: true, models: [{ id: PAIR_A.model, name: 'Model Large' }, { id: PAIR_B.model, name: PAIR_B.model }] }, { slug: 'x', name: 'X', ready: false, models: [{ id: 'm', name: 'm' }] }] }

/* ---------- the settings: the grant, the two lists, the ten functions ---------- */
test('the ten switches: five of work then five of decor; the badge counts them all', () => {
  assert.deepEqual(LLM_WORK, ['recruit', 'revise', 'campaign', 'cardbody', 'lint'])
  assert.equal(LLM_ALL.length, 10)
  assert.deepEqual(LLM_ALL, [...LLM_WORK, ...LLM_FEATURES])
  const v = settingsView(toLlm(body()), modelChoices(READY))
  assert.deepEqual(v.groups.work.map(r => r.key), LLM_WORK)
  assert.deepEqual(v.groups.decor.map(r => r.key), LLM_FEATURES)
  assert.equal(v.of, 10)
  assert.equal(v.on, 3)
  assert.deepEqual(llmTabBadge({ data: toLlm(body()) }), { on: 3, of: 10 })
})

test('the grant: granted -> two lists that answer; not granted -> greyed + the command + the fallback; unsupported -> lists not drawn (Hermes too old)', () => {
  const granted = settingsView(toLlm(body()), modelChoices(READY))
  assert.equal(granted.granted, true)
  assert.equal(granted.lists, true)
  assert.equal(granted.needsGrant, false)
  assert.equal(granted.selects.strong.disabled, false)
  const none = settingsView(toLlm(body({ override: 'not_granted' })), modelChoices({ state: 'idle' }))
  assert.equal(none.granted, false)
  assert.equal(none.needsGrant, true)
  assert.equal(none.command, GRANT_COMMAND)
  assert.equal(none.selects.light.disabled, true)
  assert.equal(none.lists, true)
  const old = settingsView(toLlm(body({ override: 'unsupported' })), modelChoices({ state: 'idle' }))
  assert.equal(old.tooOld, true)
  assert.equal(old.lists, false)
  assert.equal(old.selects.strong.hidden, true)
  // a Hermes too old to know the grant cannot give it: nothing is choosable, every function takes the auxiliary task
  assert.equal(old.granted, false)
  assert.equal(old.selects.strong.disabled, true)
  for (const row of [...old.groups.work, ...old.groups.decor]) assert.equal(row.route.kind, 'host', `unsupported ${row.key}`)
  // an unknown word is « unsupported »: never a grant by accident
  assert.equal(toLlm(body({ override: 'yes' })).override, 'unsupported')
  // without the grant, every function falls back on the auxiliary task of Hermes: nothing breaks
  for (const row of [...none.groups.work, ...none.groups.decor]) assert.equal(row.route.kind, 'host', row.key)
})

test('0, 1 or 2 models set: the route of each function follows the lane; one alone serves both', () => {
  const list = modelChoices(READY)
  const none = settingsView(toLlm(body()), list)
  assert.equal(none.chosen, 0)
  assert.equal(none.selects.strong.selected, 'hermes')
  for (const r of none.groups.work) assert.equal(r.route.kind, 'host')
  const one = settingsView(toLlm(body({ settings: { features: {}, capUsd: 1, callCap: 300, models: { strong: PAIR_A, light: null } } })), list)
  assert.equal(one.chosen, 1)
  assert.equal(one.selects.strong.selected, '0')
  assert.equal(one.selects.light.selected, 'hermes')
  assert.equal(one.groups.work[0].route.model, PAIR_A.model, 'only one is set: it serves the light lane too')
  const two = settingsView(toLlm(body({ settings: { features: {}, capUsd: 1, callCap: 300, models: { strong: PAIR_A, light: PAIR_B } } })), list)
  assert.equal(two.chosen, 2)
  assert.equal(two.groups.work[0].lane, 'light')
  assert.equal(two.groups.work[0].route.model, PAIR_B.model)
  assert.equal(two.groups.work.find(r => r.key === 'campaign').route.model, PAIR_A.model)
  // the agent half says what it really takes: that is what the row shows
  const said = settingsView(toLlm(body({ settings: { features: {}, capUsd: 1, callCap: 300, models: { strong: PAIR_A, light: PAIR_B } }, routes: { recruit: { via: 'task', task: 'officecraft' } } })), list)
  assert.equal(said.groups.work[0].route.kind, 'host')
})

test('the list of models: the one of the recruitment, never typed; a pick off the list is kept and said; an unreadable list is said with its cause', () => {
  const list = modelChoices(READY)
  assert.deepEqual(list.choices.map(c => c.model), [PAIR_A.model, PAIR_B.model], 'a provider that is not ready offers nothing')
  assert.equal(list.choices[0].name, 'Model Large')
  assert.deepEqual(pickFromValue('1', list.choices), PAIR_B)
  assert.equal(pickFromValue('hermes', list.choices), null)
  assert.equal(pickFromValue('9', list.choices), undefined, 'an index that is not in the list changes nothing')
  assert.equal(pickFromValue('stored', list.choices), undefined)
  const off = { provider: 'gone', model: 'old-model' }
  const kept = settingsView(toLlm(body({ settings: { features: {}, capUsd: 1, callCap: 300, models: { strong: off, light: null } } })), list)
  assert.equal(kept.selects.strong.selected, 'stored')
  assert.equal(kept.selects.strong.stored, true)
  for (const state of LIST_FALLBACKS) {
    const v = settingsView(toLlm(body({ settings: { features: {}, capUsd: 1, callCap: 300, models: { strong: off, light: null } } })), modelChoices({ state }))
    assert.equal(v.list.fallback, state)
    assert.equal(v.selects.strong.selected, 'stored', `${state}: what is stored is not emptied`)
    assert.ok(messages.en.llm.models.fallback[state], `${state} is said`)
  }
  assert.equal(shortModel('example/model-fast-1017'), 'model-fast-1017')
})

test('a function the agent half does not serve is « outdated » (no switch), not a silent off', () => {
  const v = settingsView(toLlm(body({ features: ['decor', 'recruit'] })), modelChoices(READY))
  const campaign = v.groups.work.find(r => r.key === 'campaign')
  assert.equal(campaign.state, 'outdated')
  assert.equal(campaign.switchable, false)
  assert.equal(v.groups.work[0].switchable, true)
})

/* ---------- sober mode: the work stays ---------- */
test('the sober mode hides the decor, not the functions of work (LLM_DRAWN / llmView)', () => {
  const state = toLlm(body())
  const sober = llmView(state, true)
  assert.equal(sober.on, false)
  assert.equal(sober.decorReady, false)
  assert.equal(sober.recruitReady, true)
  assert.equal(sober.reviseReady, true)
  assert.equal(llmView(state, false).recruitReady, true)
  // switched off, no agent half, no model: no button, in sober or not
  assert.equal(workReady(toLlm(body({ settings: { features: { recruit: false }, capUsd: 1, callCap: 300, models: {} } })), 'recruit'), false)
  assert.equal(workReady(toLlm(body({ available: false })), 'recruit'), false)
  assert.equal(workReady(toLlm(body({ features: ['decor'] })), 'recruit'), false)
  assert.equal(workReady(null, 'recruit'), false)
  assert.equal(workReady(state, 'decor'), false, 'only the functions of work')
})

/* ---------- recruitment: the marks « to review » ---------- */
const GOOD = FIX.answers['R1.main']
test('the marks: the fields the model wrote wear one; an edit lifts its field; a click reads it; none blocks', () => {
  const m = mergeRecruit(hireDraft(roster), GOOD, roster)
  assert.equal(m.ok, true)
  const marks = marksOf(m.filled)
  for (const f of ['name', 'title', 'description', 'role', 'start', 'soul']) assert.ok(marks.has(f), f)
  assert.ok([...marks].every(f => MARK_FIELDS.includes(f)))
  assert.equal(unreadCount(marks), marks.size)
  // an edit of the name lifts the name only
  const edited = liftMarks(marks, { name: 'other' })
  assert.equal(edited.has('name'), false)
  assert.equal(edited.has('title'), true)
  assert.equal(marks.has('name'), true, 'the set it came from is not mutated')
  // the source and the skills kept are one mark, `start`; the SOUL (and the choice about it) another
  assert.equal(liftMarks(marks, { off: [] }).has('start'), false)
  assert.equal(liftMarks(marks, { from: 'x' }).has('start'), false)
  assert.equal(liftMarks(marks, { soulKeep: true }).has('soul'), false)
  // a field the user touches that is not marked changes nothing (same set back)
  assert.equal(liftMarks(edited, { name: 'again' }), edited)
  // a click on the mark: read
  const read = readMark(marks, 'title')
  assert.equal(read.has('title'), false)
  assert.equal(readMark(read, 'title'), read)
  // a refused draft marks nothing
  assert.equal(marksOf(mergeRecruit(hireDraft(roster), { ...GOOD, name: '' }, roster).filled).size, 0)
  // « Recruit » is never gated by a mark: the draft sends whatever the marks are
  assert.equal(hirePayload(m.draft)[0][0], 'profiles.create')
})

test('refusals: every code is said in the three languages; a guard that refused before any call counts nothing', () => {
  for (const lang of ['en', 'fr', 'es']) {
    const say = new Map(leaves(messages[lang]))
    for (const code of REFUSAL_CODES) assert.ok(say.get(`llm.ref.${code}`), `${lang}: llm.ref.${code}`)
  }
  for (const r of REASONS) assert.ok(REFUSAL_CODES.includes(r), r)
  for (const e of MERGE_ERRORS) assert.ok(REFUSAL_CODES.includes(e), e)
  assert.deepEqual(refusalOf({ answer: { reason: 'cap_reached', cap: 'usd' } }), { code: 'cap_reached', calls: 0, action: 'settings', cap: 'usd', all: ['cap_reached'] })
  assert.equal(refusalOf({ answer: { reason: 'invalid_output', retried: true } }).calls, 2, 'the relaunch on a length is paid twice')
  assert.equal(refusalOf({ answer: { reason: 'model_error' } }).calls, 1)
  assert.equal(refusalOf({ answer: { reason: 'disabled' } }).calls, 0)
  assert.equal(refusalOf({ answer: { reason: 'nonsense' } }).code, 'model_error', 'an unknown reason is never shown raw')
  const merged = refusalOf({ answer: { retried: false }, errors: ['description_long', 'name_taken'] })
  assert.equal(merged.code, 'description_long')
  assert.deepEqual(merged.all, ['description_long', 'name_taken'])
  assert.equal(refusalOf({ answer: { reason: 'expired' } }).calls, 0)
})

test('the SOUL choice of a copy: the written one by default, « keep the source\'s » sends none; a new bot has no choice', () => {
  const copy = mergeRecruit(hireDraft(roster), { ...GOOD, start: 'clone', from: roster[0].name, keep_skills: [] }, roster)
  assert.equal(copy.ok, true, copy.errors.join())
  assert.equal(soulChoice(copy.draft), 'new')
  assert.equal(soulChoice({ ...copy.draft, soulKeep: true }), 'keep')
  assert.equal(soulChoice({ ...copy.draft, soul: '  ' }), null)
  assert.equal(soulChoice({ ...copy.draft, start: 'fresh' }), null)
  assert.equal(soulChoice(hireDraft(roster)), null, 'no draft from the model: no choice, behaviour of before')
  assert.equal(hirePayload(copy.draft)[0][1].soul.length > 0, true)
  assert.equal('soul' in hirePayload({ ...copy.draft, soulKeep: true })[0][1], false)
})

test('a draft kept for a closed window is offered; the wait is said in units that read the same everywhere', () => {
  const s = toLlm(body({ pending: { recruit: { id: 'abc', at: 1000, target: null }, revise: { id: 'def', at: 2000, target: 'backend' } } }))
  assert.deepEqual(pendingOffer(s, 'recruit', 1_000_000 + 60_000), { id: 'abc', at: 1000, target: null, atMs: 1_000_000, ageMs: 60_000 })
  assert.equal(pendingOffer(s, 'revise', 0).ageMs, null)
  assert.equal(pendingOffer(s, 'campaign', 0), null)
  assert.equal(pendingOffer(toLlm(body()), 'recruit', 0), null)
  assert.equal(formatWait(7), '7 s')
  assert.equal(formatWait(72), '1 min 12 s')
  assert.equal(formatWait(-3), '0 s')
  assert.equal(formatWait(NaN), '0 s')
})

/* ---------- revision of a bot ---------- */
test('« Revise » is offered when the function works and there is something to rewrite; « Apply » only for a real change', () => {
  const s = toLlm(body())
  assert.equal(canRevise(s, { name: 'backend', description: 'Writes code' }), true)
  assert.equal(canRevise(s, { name: 'default', isDefault: true, description: '  ' }), false, 'the main bot with no description is not revised')
  assert.equal(canRevise(s, { name: 'default', isDefault: true, description: 'Main' }), true)
  assert.equal(canRevise(s, null), false)
  assert.equal(canRevise(toLlm(body({ settings: { features: { revise: false }, capUsd: 1, callCap: 300, models: {} } })), { name: 'backend', description: 'x' }), false, 'off: no button')
  assert.equal(reviseApplicable('Writes code', 'Writes code and tests'), true)
  assert.equal(reviseApplicable('Writes code', ' Writes code '), false, 'the same text is not a change')
  assert.equal(reviseApplicable('a', '   '), false)
  assert.equal(reviseApplicable('a', 'x'.repeat(5000)), false)
  const m = mergeRevise('Writes code', { description: 'Takes backend tasks, delivers tested code, not UI.', changes: ['says what it delivers'] })
  assert.equal(m.ok, true)
  assert.equal(m.before, 'Writes code')
  assert.equal(mergeRevise('x', { description: '' }).ok, false)
})

test('« Apply » is profiles.configure { name, description } and nothing else; Hermes\' word is checked, a lost call claims nothing', async () => {
  const sent = []
  const ok = async (method, params) => { sent.push([method, params]); return { ok: true, data: { ok: true, applied: { description: true } } } }
  assert.deepEqual(await runRevise('backend', '  New text  ', ok), { ok: true, reason: null })
  assert.deepEqual(sent, [['profiles.configure', { name: 'backend', description: 'New text' }]])
  assert.deepEqual(Object.keys(sent[0][1]).sort(), ['description', 'name'], 'that field only: no soul, no model, no skills')
  const refused = async () => ({ ok: true, data: { ok: false } })
  assert.deepEqual(await runRevise('b', 'x', refused), { ok: false, reason: 'hermes_error' })
  const notWritten = async () => ({ ok: true, data: { applied: { description: false } } })
  assert.equal((await runRevise('b', 'x', notWritten)).ok, false)
  const lost = async () => ({ ok: false, error: { message: 'request timed out' } })
  assert.deepEqual(await runRevise('b', 'x', lost), { ok: false, reason: 'unknown_outcome' })
  const hermes = async () => ({ ok: false, error: { message: 'profile not found' } })
  assert.deepEqual(await runRevise('b', 'x', hermes), { ok: false, reason: 'hermes_error' })
  // the read after: the description of that row only
  const list = async () => ({ ok: true, data: { profiles: [{ name: 'Backend', description: ' New text ', soul: 'never read' }] } })
  assert.deepEqual(await readDescriptionOf('backend', list), { listed: true, description: 'New text' })
  assert.deepEqual(await readDescriptionOf('other', list), { listed: false, description: '' })
  assert.deepEqual(await readDescriptionOf('x', async () => ({ ok: false })), { listed: null, description: '' })
})

test('the order of « Apply »: reversible, no extra confirmation (the before / after is it), straight to the 6 s window, then the roster is read back', () => {
  assert.deepEqual(ORDERS.revise, { risk: 'rev', writes: true, confirm: false, via: 'rpc' })
  const target = reviseTarget('backend', ' New text ', 'id-1')
  assert.deepEqual(target, { id: 'id-1', verb: 'revise', code: 'backend', board: '', task: '', description: ' New text ', preconfirmed: true })
  assert.equal(routeOf(target), 'revise')
  assert.equal(rereadOf(target), 'roster')
  assert.deepEqual(focusTarget(target), { kind: 'revise' })
  const s = orderReducer(initialOrderState(), { type: 'request', order: target, now: 1000 })
  assert.equal(s.phase, 'counting', 'no second question: the user already read before and after')
  assert.equal(s.sendAt, 1000 + 6000, 'the 6 s to cancel')
  // the shortcut is for a description the user read: without the flag the order stops at its confirmation
  assert.equal(orderReducer(initialOrderState(), { type: 'request', order: { ...target, preconfirmed: false }, now: 0 }).phase, 'confirm')
})

test('« Apply » is « done » only when profiles.list shows the very description that was sent; another one is not_applied, an unread list claims nothing', async () => {
  const order = reviseTarget('backend', 'Takes backend tasks, delivers tested code.', 'id-2')
  const answer = { ok: true }
  const listing = desc => async () => ({ ok: true, data: { profiles: [{ name: 'backend', description: desc }] } })
  const noWait = async () => {}
  const ctx = { rest: async () => ({ ok: true }) }   // the journal line, written elsewhere (below)
  assert.equal((await verifyRevise(ctx, order, answer, false, listing(' Takes backend tasks, delivers tested code. '), noWait)).present, true)
  assert.equal((await verifyRevise(ctx, order, answer, false, listing('Writes code'), noWait)).present, false, 'the old description still listed: not applied')
  assert.equal((await verifyRevise(ctx, order, answer, false, async () => ({ ok: false }), noWait)).present, null)
  let reads = 0
  const late = async () => ({ ok: true, data: { profiles: [{ name: 'backend', description: ++reads < 2 ? 'Writes code' : order.description }] } })
  assert.equal((await verifyRevise(ctx, order, answer, false, late, noWait)).present, true, 'a write that shows on the second read')
  const done = orderReducer({ ...orderReducer(initialOrderState(), { type: 'request', order, now: 0 }), phase: 'verifying', answer: { ok: true, result: 'done', reason: null } }, { type: 'read', liveOk: true, present: false })
  assert.equal(done.outcome.ok, false)
  assert.equal(done.outcome.reason, 'not_applied')
  assert.equal(done.order.description, undefined, 'the text is dropped once the order has left')
  // the departure sends that field only
  const sent = []
  const res = await sendRevise(order, async (m, p) => { sent.push([m, p]); return { ok: true, data: { applied: { description: true } } } })
  assert.equal(res.type, 'answered')
  assert.deepEqual(sent, [['profiles.configure', { name: 'backend', description: order.description }]])
})

test('the re-read writes the journal line of the revision (bot, `rev`, length) — never the text; a line that cannot be written is said', async () => {
  const text = 'Takes backend tasks, delivers tested code.'
  const order = reviseTarget('backend', text, 'id-3')
  const posts = []
  const ctx = { rest: async (path, opts) => { posts.push([path, opts.body]); return { ok: true, id: opts.body.id } } }
  const shown = async () => ({ ok: true, data: { profiles: [{ name: 'backend', description: text }] } })
  const other = async () => ({ ok: true, data: { profiles: [{ name: 'backend', description: 'Writes code' }] } })
  const unread = async () => ({ ok: false })
  const noWait = async () => {}
  const line = over => ({ id: 'id-3', verb: 'revise', risk: 'rev', profile: 'backend', len: text.length, ...over })
  assert.deepEqual(await verifyRevise(ctx, order, { ok: true }, true, shown, noWait), { present: true, audited: true })
  assert.deepEqual(posts, [['/audit', line({ result: 'done' })]], 'one line per revision applied')
  assert.doesNotMatch(JSON.stringify(posts), /Takes backend tasks/, 'the description text never travels to the journal')
  posts.length = 0
  assert.equal((await verifyRevise(ctx, order, { ok: true }, true, other, noWait)).present, false)
  assert.deepEqual(posts[0][1], line({ result: 'failed', reason: 'not_applied' }), 'another description listed')
  posts.length = 0
  assert.equal((await verifyRevise(ctx, order, { ok: false, reason: 'hermes_error' }, true, shown, noWait)).present, null)
  assert.deepEqual(posts[0][1], line({ result: 'failed', reason: 'hermes_error' }), 'the call itself failed: its reason is kept')
  posts.length = 0
  assert.deepEqual(await verifyRevise(ctx, order, { ok: true }, true, unread, noWait), { present: null, audited: true })
  assert.deepEqual(posts[0][1], line({ result: 'failed', reason: 'unknown_outcome' }), 'tried, list unreadable: the line says the outcome is unknown')
  posts.length = 0
  assert.equal((await verifyRevise(ctx, order, { ok: true }, false, shown, noWait)).present, true)
  assert.equal(posts.length, 0, 'the journal switched off: nothing is written')
  // an older agent half refuses the verb (422): the page says the line was not written and claims nothing else
  const old = { rest: async () => { const e = new Error('422 Unprocessable Entity'); e.status = 422; throw e } }
  const res = await verifyRevise(old, order, { ok: true }, true, shown, noWait)
  assert.deepEqual(res, { present: true, audited: false })
  const done = orderReducer(
    { ...orderReducer(initialOrderState(), { type: 'request', order, now: 0 }), phase: 'verifying', answer: { ok: true, result: 'done', reason: null } },
    { type: 'read', liveOk: true, present: res.present, audited: res.audited })
  assert.equal(done.outcome.ok, true, 'the revision itself is done')
  assert.equal(done.outcome.audited, false, 'and the page says the journal missed it')
  // the journal panel keeps the line GET /orders serves (an unknown verb would be dropped in silence)
  const panel = toJournal({ ok: true, entries: [{ ts: 1000, ...line({ result: 'done' }), source: 'page' }] })
  assert.equal(panel.entries.length, 1, 'a revise line is shown in the panel')
  assert.deepEqual([panel.entries[0].verb, panel.entries[0].risk, panel.entries[0].profile, panel.entries[0].len], ['revise', 'rev', 'backend', text.length])
})

test('a kept draft says when it was asked (« 1 min ago »), never its age read as a date (« 57 years ago », measured in the real window)', () => {
  const nowMs = 1_794_922_000_000
  const s = toLlm(body({ pending: { recruit: { id: 'abc', at: nowMs / 1000 - 60, target: null } } }))
  const offer = pendingOffer(s, 'recruit', nowMs)
  assert.equal(offer.atMs, nowMs - 60_000)
  assert.equal(formatRelative(offer.atMs, nowMs, 'fr'), formatRelative(nowMs - 60_000, nowMs, 'fr'))
  assert.doesNotMatch(formatRelative(offer.atMs, nowMs, 'fr'), /an|year|año/)
  assert.equal(pendingOffer(toLlm(body({ pending: { recruit: { id: 'x', at: 0, target: null } } })), 'recruit', nowMs).atMs, null)
  assert.match(src('ui/HireAssist.jsx'), /t\.ago\(assist\.offer\.atMs\)/, 'the window gives t.ago the time it was asked')
})

test('every field that can wear the mark has one on screen (the counter never counts a mark the user cannot see or click)', () => {
  const screens = src('ui/HireDialog.jsx') + src('ui/HireAssist.jsx')
  for (const f of MARK_FIELDS) assert.match(screens, new RegExp(`field="${f}"`), f)
})

test('a description the office keeps cut (over 280 characters) is shown with « … », never as if it ended there', () => {
  const long = 'Takes the invoices and the refund requests, '.repeat(8)
  const desk = toDesk({ name: 'billing', description: long })
  assert.equal(desk.description.length, 280)
  assert.equal(desk.descriptionCut, true)
  assert.equal(toDesk({ name: 'b', description: 'Short.' }).descriptionCut, false)
  assert.equal(shownDescription(desk.description, desk.descriptionCut), `${desk.description.trim()}…`)
  assert.equal(shownDescription('Short.', false), 'Short.')
  assert.equal(shownDescription('  ', true), '—')
  assert.match(src('ui/ReviseBox.jsx'), /shownDescription\(description, cut\)/)
  assert.match(src('ui/ReviseBox.jsx'), /shownDescription\(rev\.before, cut\)/)
})

/* ---------- the three languages, the screen ---------- */
test('every string of the new screens exists in en, fr and es', () => {
  const en = new Map(leaves(messages.en))
  assert.ok(en.size > 1000)
  for (const lang of ['fr', 'es']) {
    const other = new Map(leaves(messages[lang]))
    const asked = [...en.keys()].filter(k => /^llm\.(groups|models|grant|recruit|mark|soul|ref|revise)\./.test(k))
    assert.ok(asked.length > 100, 'the new strings are really looked at')
    const missing = [...en.keys()].filter(k => /^(llm\.(groups|models|lane|chip|grant|recruit|mark|soul|ref|revise)|orders\.reason\.not_applied|orders\.verb\.revise|ux\.agent\.description)/.test(k) && !other.has(k))
    assert.deepEqual(missing, [], lang)
  }
})

test('the screens carry their hooks: the two lists, the grant, the marks, the SOUL choice, the revision', () => {
  const form = src('ui/SettingsFormLlm.jsx')
  for (const hook of ['data-llm-model', 'data-llm-grant', 'data-llm-command', 'data-llm-too-old', 'data-llm-list-fallback', 'data-llm-route', 'data-llm-group']) assert.ok(form.includes(hook), hook)
  assert.ok(!/placeholder|type="text"/.test(form.slice(form.indexOf('function ModelSelect'), form.indexOf('export function SettingsFormLlm'))), 'a model is never typed')
  const hire = src('ui/HireAssist.jsx')
  for (const hook of ['data-lm-mark', 'data-lm-ask', 'data-lm-stop', 'data-lm-refusal', 'data-lm-dup', 'data-lm-offer', 'data-lm-soul-choice', 'aria-live']) assert.ok(hire.includes(hook), hook)
  const rev = src('ui/ReviseBox.jsx')
  for (const hook of ['data-revise-open', 'data-revise-apply', 'data-revise-ignore', 'data-revise-before', 'data-revise-after']) assert.ok(rev.includes(hook), hook)
  // the function off: the window and the tab draw nothing of the model (no panel, no button, no call)
  assert.match(hire, /if \(!assist\?\.ready\) return null/)
  assert.match(rev, /offered && !reviewing \?/)
  // the unchanged parts of the recruitment keep their hooks
  for (const hook of ['data-hire-dialog', 'data-hire-ok', 'data-hire-requests']) assert.ok(src('ui/HireDialog.jsx').includes(hook), hook)
})

/* The « ? » of the LLM tab (HelpTip) opens a note in `position:absolute` against its row. The LLM tab's boxes were not positioned, so the
   note's box was the settings window itself: every « ? » of the tab opened its note at the window's bottom-left, far from its button
   (seen on the note of the grant). Each box that holds a HelpTip must be position:relative, as .oc-sx-row is. */
test('every « ? » of the LLM tab opens next to its button, never at the foot of the window', async () => {
  const { SETTINGS_CSS } = await import('../../src/ui/settingsStyles.js')
  const rules = [...SETTINGS_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sels: m[1].split(',').map(s => s.trim()), body: m[2] }))
  const anchored = new Set(rules.filter(r => /position:\s*relative/.test(r.body)).flatMap(r => r.sels))
  const jsx = readFileSync(new URL('../../src/ui/SettingsFormLlm.jsx', import.meta.url), 'utf8')
  // the box each HelpTip of the tab sits in: budget text, model header, grant strip, feature row
  const boxes = ['.oc-lm-budt', '.oc-lm-mod', '.oc-lm-grant', '.oc-lm-row']
  assert.equal(jsx.match(/<HelpTip\b/g).length, boxes.length, 'a new « ? » in the LLM tab: add the box it sits in to this list')
  for (const b of boxes) {
    assert.ok(jsx.includes(`"${b.slice(1)}`) || jsx.includes(`\`${b.slice(1)}`), `${b} is used by SettingsFormLlm.jsx`)
    assert.ok(anchored.has(b), `${b} must be position:relative (its « ? » note is placed against it)`)
  }
})
