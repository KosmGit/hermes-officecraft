import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { register } from 'node:module'
import { test } from 'node:test'
import { COMMAND_IDS, commandDefs } from '../../src/core/achievements.js'
import { computeGame } from '../../src/core/game.js'
import { JOURNAL_FETCH, ORDERS, UNDO_SECONDS, initialOrderState, orderReducer, recruitTarget, riskOf, toJournal } from '../../src/core/orders.js'
import { DESCRIPTION_MAX, NAME_RE, RESERVED, TITLE_MAX, composeSoul, createFailure, hireAgent, hireDraft, hireErrors, hirePayload, normalizeName, readListed, readModel, recruitAuditBody, requestsPreview, runModel, runRecruit, AUTO_ROLE, roleChoice, roleChoices } from '../../src/core/recruit.js'
import { messages } from '../../src/i18n/index.js'
import { toDesk } from '../../src/core/roster.js'
import { roleOf, ALL_ROLE_IDS, ROLES, ROLE_IDS, detectRole, outfitOf, wireRole } from '../../src/scene/wardrobe.js'
import { MODELS_SHOWN, MODEL_OPTIONS_TIMEOUT_MS, failureOf, filterModels, looksSecret, parseModelOptions, priceLabel, sortProviders } from '../../src/core/modelOptions.js'
import { thoughtRoles } from '../../src/core/thoughts.js'
import { agentSprite } from '../../src/scene/agent.js'
import { copiedSkillsOf, toSceneModel } from '../../src/scene/model.js'
import { portrait } from '../../src/scene/portrait.js'

// ===== recruit =====
{
/* Recruiting a bot from the office (validation, exact payload, the flow against a stand-in for Hermes, the order machine, the journal
   line) and the three « Command » achievements read from the audit journal. The RPC is a stand-in: nothing here talks to Hermes. */
const STUB = 'export const host = { request: () => { throw new Error(\'no host\') } }'
const url = src => `data:text/javascript,${encodeURIComponent(src)}`
register(url(`const M = { '@hermes/plugin-sdk': ${JSON.stringify(url(STUB))} }\nexport async function resolve(s, c, next) { return M[s] ? { url: M[s], shortCircuit: true } : next(s, c) }`))
const { sendRecruit, verifyRecruit } = await import('../../src/data/recruit.js')

const known = [
  { name: 'default', isDefault: true, skills: { enabled: 30, own: [{ name: 'a', category: 'x' }, { name: 'b' }] } },
  { name: 'research', isDefault: false, skills: { enabled: 12, own: [] } }
]
const draft = over => ({ ...hireDraft(known), ...over })

/* ---------- validation ---------- */
test('identifier: refused ones are refused, accepted ones accepted (the rule of Hermes, before anything is sent)', () => {
  const refused = ['', 'Bad Name', 'UPPER', '-x', '_x', 'a b', 'a.b', 'é', 'x'.repeat(65), 'a/b', '../x']
  for (const name of refused) assert.ok(hireErrors(draft({ name }), known).length, `refused: "${name}"`)
  const accepted = ['a', '0abc', 'designer', 'oc-test-ab12', 'a_b-c', 'x'.repeat(64)]
  for (const name of accepted) assert.deepEqual(hireErrors(draft({ name }), known), [], `accepted: "${name}"`)
  assert.ok(NAME_RE.test('x'.repeat(64)) && !NAME_RE.test('x'.repeat(65)))
})
test('identifier: neither « default » nor a reserved name; a duplicate is refused whatever its case; the codes say which rule', () => {
  for (const name of RESERVED) assert.deepEqual(hireErrors(draft({ name }), known), ['name_reserved'], name)
  assert.deepEqual(hireErrors(draft({ name: 'research' }), known), ['name_taken'])
  assert.deepEqual(hireErrors(draft({ name: 'research' }), [{ name: 'RESEARCH' }, ...known.slice(0, 1)]), ['name_taken'], 'a profile listed in capitals still collides')
  assert.deepEqual(hireErrors(draft({ name: '' }), known), ['name_empty'])
  assert.deepEqual(hireErrors(draft({ name: 'Bad_Name' }), known), ['name_format'], 'uppercase is refused, not lowercased in silence')
  assert.equal(normalizeName('  Bad_Name '), 'bad_name', 'what the field shows while typing')
})
test('model and provider go together; a copied bot must exist in the list', () => {
  assert.deepEqual(hireErrors(draft({ name: 'x', model: 'm' }), known), ['model_pair'])
  assert.deepEqual(hireErrors(draft({ name: 'x', provider: 'p' }), known), ['model_pair'])
  assert.deepEqual(hireErrors(draft({ name: 'x', model: 'm', provider: 'p' }), known), [])
  assert.deepEqual(hireErrors(draft({ name: 'x', model: '  ', provider: ' ' }), known), [])
  assert.deepEqual(hireErrors(draft({ name: 'x', from: 'ghost' }), known), ['from_missing'])
  assert.deepEqual(hireErrors(draft({ name: 'x', from: 'ghost', start: 'empty' }), known), [])
})
test('every error code has its text in EN, FR and ES', () => {
  for (const lang of ['en', 'fr', 'es']) for (const code of ['name_empty', 'name_format', 'name_reserved', 'name_taken', 'model_pair', 'from_missing']) {
    assert.ok(messages[lang].recruit.err[code]?.length > 10, `${lang} ${code}`)
  }
})

/* ---------- payload: the exact shape Hermes expects ---------- */
test('payload of a copy: create (clone_from, description), skills off, then the tags — and no soul, no model in create', () => {
  const reqs = hirePayload(draft({ name: 'designer', title: 'UI designer', description: 'Draws screens', from: 'default', off: ['a'] }))
  assert.deepEqual(reqs, [
    ['profiles.create', { name: 'designer', description: 'Draws screens', clone_from: 'default' }],
    ['profiles.configure', { name: 'designer', disabled_skills: ['a'] }],
    // a copy also records where it was copied from (`copiedFrom`), so the guess of a bot left on `auto` ignores the copied skills
    ['profiles.configure', { name: 'designer', ui_meta: { 'hermes-officecraft': { role: 'auto', hiredFrom: 'office', copiedFrom: 'default' }, 'hermes-bots': { title: 'UI designer' } } }]
  ])
})
test('payload of a fresh and of an empty start: the identity sheet is composed, no_skills only for empty, nothing copied', () => {
  const fresh = hirePayload(draft({ name: 'scribe', title: 'Scribe', description: 'Writes notes', start: 'fresh' }))
  assert.deepEqual(Object.keys(fresh[0][1]).sort(), ['description', 'name', 'soul'])
  assert.equal(fresh[0][1].soul, composeSoul({ name: 'scribe', title: 'Scribe', description: 'Writes notes' }))
  assert.match(fresh[0][1].soul, /^# Scribe\n\n\*\*Role:\*\* Scribe\n\*\*Mission:\*\* Writes notes\n/)
  assert.equal(fresh.length, 2)
  const empty = hirePayload(draft({ name: 'x', start: 'empty', off: ['a'] }))
  assert.deepEqual(empty[0][1], { name: 'x', no_skills: true, soul: composeSoul({ name: 'x', title: '', description: '' }) })
  assert.equal(empty.length, 2, 'skills to switch off only exist for a copy')
  assert.deepEqual(empty[1][1].ui_meta, { 'hermes-officecraft': { role: 'auto', hiredFrom: 'office' } }, 'no title: no hermes-bots entry')
})
test('payload with a model: it is a separate configure (Hermes guards a costly model there), never part of create', () => {
  const reqs = hirePayload(draft({ name: 'x', model: ' model-x ', provider: ' zenith ' }))
  assert.equal(reqs.at(-1)[0], 'profiles.configure')
  assert.deepEqual(reqs.at(-1)[1], { name: 'x', model: 'model-x', provider: 'zenith' })
  assert.equal('model' in reqs[0][1] || 'provider' in reqs[0][1], false)
  assert.equal(reqs.some(([, p]) => 'confirm_expensive_model' in p), false, 'the confirmation is never sent in advance')
  assert.equal(hirePayload(draft({ name: 'x', model: 'm' })).some(([, p]) => 'model' in p), false, 'a lone model is not sent')
})
test('payload: text is trimmed and bounded; the preview never shows a soul', () => {
  const reqs = hirePayload(draft({ name: 'x', start: 'fresh', title: 'T'.repeat(200), description: `  ${'d'.repeat(500)}  ` }))
  assert.equal(reqs[0][1].description.length, DESCRIPTION_MAX)
  assert.equal(reqs.at(-1)[1].ui_meta['hermes-bots'].title.length, TITLE_MAX)
  const view = requestsPreview(draft({ name: 'x', start: 'fresh', title: 'Secret title', description: 'Secret mission' }))
  assert.equal(view[0][1].soul, '…')
  assert.doesNotMatch(JSON.stringify(view).replace(/"description":"Secret mission"|"title":"Secret title"/g, ''), /Secret|You are|persistent/)
  assert.ok(hirePayload(draft({ name: 'x', start: 'fresh' }))[0][1].soul.includes('persistent'), 'but the real call carries it')
})
test('preview agent: the office would dress it from its description and the skills kept (the title lives in ui_meta, which the roster does not read)', () => {
  const a = hireAgent(draft({ name: 'x', title: 'Designer', description: 'UI', off: ['a'] }), known)
  assert.equal(a.description, 'UI')
  assert.equal(a.label, 'Designer')
  assert.deepEqual(a.skills.own.map(s => s.name), ['b'])
  assert.equal(a.state, 'new')
  assert.equal(hireAgent(draft({ name: 'x', start: 'empty' }), known).skills.own.length, 0)
})

test('the preview role is the role the office gives the bot once profiles.list lists it (same description, title not mixed in)', () => {
  // measured live: title « Relecteur R24 » + a release-notes description -> the preview said « review », the desk came « writing »
  const d = draft({ name: 'oc-test-x', title: 'Relecteur R24', description: 'Writes release notes and checks documentation drafts', start: 'fresh' })
  const create = hirePayload(d)[0][1]
  const desk = toDesk({ name: create.name, description: create.description })
  assert.equal(roleOf(hireAgent(d, known)).role, roleOf({ ...desk, skills: { enabled: 0, own: [] } }).role)
})

/* ---------- the flow, against a stand-in for Hermes ---------- */
const stub = (script = {}) => {
  const calls = []
  const request = async (method, params) => {
    calls.push([method, params])
    const r = script[method]
    const out = typeof r === 'function' ? r(params, calls) : r
    return out ?? { ok: true, data: { ok: true, applied: {} } }
  }
  return { calls, request }
}
test('runRecruit: create then configure in order; the folder path Hermes answers with is not carried', async () => {
  const s = stub({ 'profiles.create': { ok: true, data: { ok: true, name: 'designer', path: '/home/x/.hermes/profiles/designer', soul_written: true } } })
  const res = await runRecruit(draft({ name: 'designer', title: 'D', off: ['a'], model: 'm', provider: 'p' }), s.request)
  assert.deepEqual(res, { ok: true, created: true, reason: null, failed: [], modelHeld: null })
  assert.deepEqual(s.calls.map(([m, p]) => m + ':' + Object.keys(p).filter(k => k !== 'name').join(',')), [
    'profiles.create:clone_from', 'profiles.configure:disabled_skills', 'profiles.configure:ui_meta', 'profiles.configure:model,provider'
  ])
  assert.doesNotMatch(JSON.stringify(res), /\/home|path/)
})
test('runRecruit: a refused create creates nothing and sends nothing else; the reason is a code', async () => {
  for (const [error, reason] of [[new Error('profile already exists'), 'name_taken'], [new Error('Invalid profile name'), 'name_invalid'], [new Error('boom'), 'hermes_error'], [new Error('request timed out'), 'unknown_outcome'], [undefined, 'unknown_outcome']]) {
    const s = stub({ 'profiles.create': { ok: false, error } })
    const res = await runRecruit(draft({ name: 'x', off: ['a'] }), s.request)
    assert.deepEqual(res, { ok: false, created: false, reason, failed: [], modelHeld: null })
    assert.equal(s.calls.length, 1, 'nothing after a failed create')
  }
  const s = stub({ 'profiles.create': { ok: true, data: { ok: false } } })
  assert.equal((await runRecruit(draft({ name: 'x' }), s.request)).reason, 'hermes_error')
  assert.equal(createFailure(new Error('network socket closed')), 'unknown_outcome')
})
test('runRecruit: a setting Hermes did not apply is listed (the bot exists without it), the others are still applied', async () => {
  const s = stub({
    'profiles.configure': (p) => ('disabled_skills' in p ? { ok: false, error: new Error('x') } : 'ui_meta' in p ? { ok: true, data: { ok: false, applied: { ui_meta: false } } } : { ok: true, data: { ok: true, applied: { model: true } } })
  })
  const res = await runRecruit(draft({ name: 'x', off: ['a'], title: 'T', model: 'm', provider: 'p' }), s.request)
  assert.equal(res.ok, true)
  assert.deepEqual(res.failed, ['skills', 'meta'])
  assert.equal(s.calls.length, 4)
})
test('runRecruit: a costly model is HELD by Hermes: not failed, not applied, the message is kept for the user to decide', async () => {
  const s = stub({ 'profiles.configure': p => ('model' in p ? { ok: true, data: { ok: true, applied: {}, confirm_required: true, confirm_message: 'This model costs a lot.' } } : null) })
  const res = await runRecruit(draft({ name: 'x', model: 'big', provider: 'p' }), s.request)
  assert.deepEqual(res.failed, [])
  assert.deepEqual(res.modelHeld, { message: 'This model costs a lot.', model: 'big', provider: 'p' })
  const long = stub({ 'profiles.configure': p => ('model' in p ? { ok: true, data: { confirm_required: true, confirm_message: 'x'.repeat(5000) } } : null) })
  assert.equal((await runRecruit(draft({ name: 'x', model: 'big', provider: 'p' }), long.request)).modelHeld.message.length, 600)
})
test('runModel: sends the confirmation flag and only then; a second hold or a failure is a failure', async () => {
  const s = stub({ 'profiles.configure': { ok: true, data: { ok: true, applied: { model: true } } } })
  assert.deepEqual(await runModel('x', 'big', 'p', s.request), { ok: true, reason: null })
  assert.deepEqual(s.calls, [['profiles.configure', { name: 'x', model: 'big', provider: 'p', confirm_expensive_model: true }]])
  assert.equal((await runModel('x', 'm', 'p', stub({ 'profiles.configure': { ok: true, data: { confirm_required: true } } }).request)).ok, false)
  assert.equal((await runModel('x', 'm', 'p', stub({ 'profiles.configure': { ok: true, data: { applied: { model: false } } } }).request)).ok, false)
  assert.equal((await runModel('x', 'm', 'p', stub({ 'profiles.configure': { ok: false, error: new Error('timeout') } }).request)).reason, 'unknown_outcome')
})
test('readListed: listed, absent, or unreadable (null) — never the row’s path', async () => {
  const rows = { ok: true, data: { profiles: [{ name: 'Designer', path: '/home/secret', model: 'm', provider: 'p' }] } }
  assert.deepEqual(await readListed('designer', stub({ 'profiles.list': rows }).request), { listed: true, model: 'm', provider: 'p' })
  assert.equal((await readListed('other', stub({ 'profiles.list': rows }).request)).listed, false)
  assert.equal((await readListed('x', stub({ 'profiles.list': { ok: false } }).request)).listed, null)
  assert.equal((await readListed('x', stub({ 'profiles.list': { ok: true, data: {} } }).request)).listed, null)
})

test('readModel: model.default / model.provider only; the soul of the same answer is not carried', async () => {
  const r = await readModel('x', stub({ 'profiles.describe': { ok: true, data: { soul: 'SECRET', model: { default: 'm', provider: 'p' }, skills: [{ name: 'a' }] } } }).request)
  assert.deepEqual(r, { read: true, model: 'm', provider: 'p' })
  assert.doesNotMatch(JSON.stringify(r), /SECRET/)
  assert.equal((await readModel('x', stub({ 'profiles.describe': { ok: true, data: {} } }).request)).read, false)
  assert.equal((await readModel('x', stub({ 'profiles.describe': { ok: false } }).request)).read, false)
})

/* ---------- the order machine ---------- */
const NOW = 1_800_000_000_000
const id = 'a1b2c3d4-0000-4000-8000-000000000001'
const run = (state, ...actions) => actions.reduce((s, a) => orderReducer(s, a), state)
const answer = (over = {}) => ({ ok: true, result: 'done', reason: null, before: null, after: null, comments: null, replayed: false, audited: true, atMs: null, detail: { failed: [], modelHeld: null }, ...over })

test('recruit is a final order: confirmation first (naming the bot), then 6 s, one at a time', () => {
  assert.equal(ORDERS.recruit.risk, 'final')
  assert.equal(riskOf({ verb: 'recruit' }), 'final')
  assert.equal(riskOf({ verb: 'recruitModel' }), 'rev')
  const d = draft({ name: 'designer' })
  let s = orderReducer(initialOrderState(), { type: 'request', order: recruitTarget(d, id), now: NOW })
  assert.equal(s.phase, 'confirm', 'no timer yet: the confirmation comes first')
  assert.equal(s.order.code, 'designer')
  s = orderReducer(s, { type: 'confirm', now: NOW })
  assert.equal(s.phase, 'counting')
  assert.equal(s.left, UNDO_SECONDS)
  const second = orderReducer(s, { type: 'request', order: recruitTarget(draft({ name: 'other' }), 'b'), now: NOW })
  assert.equal(second.notice, 'busy')
  assert.equal(second.order.code, 'designer', 'the first order is untouched')
  assert.equal(orderReducer(s, { type: 'tick', now: NOW + UNDO_SECONDS * 1000 }).phase, 'sending')
  assert.equal(orderReducer(s, { type: 'tick', now: NOW + UNDO_SECONDS * 1000 - 1 }).phase, 'counting')
})
test('cancel in the 6 s window sends nothing; back from the confirmation returns to the form', () => {
  const d = draft({ name: 'designer' })
  const confirm = orderReducer(initialOrderState(), { type: 'request', order: recruitTarget(d, id), now: NOW })
  assert.equal(orderReducer(confirm, { type: 'back' }).phase, 'idle')
  const counting = orderReducer(confirm, { type: 'confirm', now: NOW })
  const cancelled = orderReducer(counting, { type: 'cancel' })
  assert.equal(cancelled.outcome.cancelled, true)
  assert.equal(cancelled.outcome.verb, 'recruit')
  assert.equal(cancelled.phase, 'idle')
})
test('outcome: « done » only when profiles.list lists the bot; unlisted = failed (not_listed); unreadable = created but not read back', () => {
  const to = (present, ans = answer()) => run(initialOrderState(), { type: 'request', order: recruitTarget(draft({ name: 'designer' }), id), now: NOW }, { type: 'confirm', now: NOW },
    { type: 'tick', now: NOW + 6000 }, { type: 'answered', answer: ans }, { type: 'read', liveOk: true, present, audited: true })
  const ok = to(true).outcome
  assert.deepEqual([ok.ok, ok.present, ok.reason], [true, true, null])
  const unlisted = to(false).outcome
  assert.deepEqual([unlisted.ok, unlisted.reason], [false, 'not_listed'])
  const unread = to(null).outcome
  assert.deepEqual([unread.ok, unread.present], [true, null])
  const failed = run(initialOrderState(), { type: 'request', order: recruitTarget(draft({ name: 'designer' }), id), now: NOW }, { type: 'confirm', now: NOW },
    { type: 'tick', now: NOW + 6000 }, { type: 'failed', reason: 'name_taken' }, { type: 'read', liveOk: true, present: null, audited: true }).outcome
  assert.deepEqual([failed.ok, failed.reason], [false, 'name_taken'])
  assert.equal(to(true, answer({ audited: true })).outcome.audited, true)
})
test('the draft (and any text of it) is dropped from the state the moment the order is done; the outcome never holds a title, a description or a soul', () => {
  const d = draft({ name: 'designer', title: 'Secret title', description: 'Secret mission' })
  const s = run(initialOrderState(), { type: 'request', order: recruitTarget(d, id), now: NOW }, { type: 'confirm', now: NOW }, { type: 'tick', now: NOW + 6000 },
    { type: 'answered', answer: answer() }, { type: 'read', liveOk: true, present: true })
  assert.equal(s.order.draft, undefined)
  assert.doesNotMatch(JSON.stringify(s), /Secret|persistent|soul/)
})
test('the model follow-up is its own reversible order that names the bot and carries what Hermes said', () => {
  const held = { message: 'Costly!', model: 'big', provider: 'p' }
  const s = orderReducer(initialOrderState(), { type: 'request', order: recruitTarget({ name: 'designer' }, id, held), now: NOW })
  assert.equal(s.phase, 'confirm')
  assert.deepEqual([s.order.verb, s.order.code, s.order.model, s.order.message], ['recruitModel', 'designer', 'big', 'Costly!'])
  const done = run(s, { type: 'confirm', now: NOW }, { type: 'tick', now: NOW + 6000 }, { type: 'answered', answer: answer() }, { type: 'read', liveOk: true, present: false }).outcome
  assert.deepEqual([done.ok, done.reason], [false, 'model_not_read'])
})

/* ---------- departure + re-read + journal line (host and agent half stood in) ---------- */
const wire = (script, { audit = true } = {}) => {
  const s = stub(script)
  const posts = []
  const ctx = { rest: async (path, opts) => { posts.push([path, opts.body]); if (audit === false) throw new Error('503'); return { ok: true, id: opts.body.id } } }
  return { ...s, ctx, posts }
}
const orderOf = d => recruitTarget(d, id)
test('verify: listed -> journal « done » (profile name only); not listed -> « failed / not_listed »; unreadable -> no line at all', async () => {
  const d = draft({ name: 'designer', title: 'Secret title', description: 'Secret mission' })
  const listed = wire({ 'profiles.list': { ok: true, data: { profiles: [{ name: 'designer' }] } } })
  const res = await verifyRecruit(listed.ctx, orderOf(d), answer(), true, listed.request)
  assert.deepEqual(res, { present: true, audited: true })
  assert.deepEqual(listed.posts, [['/audit', { id, verb: 'recruit', risk: 'final', result: 'done', profile: 'designer' }]])
  assert.doesNotMatch(JSON.stringify(listed.posts), /Secret|soul/)

  const absent = wire({ 'profiles.list': { ok: true, data: { profiles: [{ name: 'other' }] } } })
  assert.equal((await verifyRecruit(absent.ctx, orderOf(d), answer(), true, absent.request)).present, false)
  assert.deepEqual(absent.posts[0][1], { id, verb: 'recruit', risk: 'final', result: 'failed', profile: 'designer', reason: 'not_listed' })

  const unreadable = wire({ 'profiles.list': { ok: false } })
  assert.deepEqual(await verifyRecruit(unreadable.ctx, orderOf(d), answer(), true, unreadable.request), { present: null, audited: true })
  assert.equal(unreadable.posts.length, 0, 'nothing is claimed when the list could not be read')

  const refused = wire({ 'profiles.list': { ok: true, data: { profiles: [{ name: 'designer' }] } } })
  const failed = await verifyRecruit(refused.ctx, orderOf(d), { ok: false, reason: 'name_taken', audited: true }, true, refused.request)
  assert.equal(failed.present, null)
  assert.deepEqual(refused.posts[0][1], { id, verb: 'recruit', risk: 'final', result: 'failed', profile: 'designer', reason: 'name_taken' })
})
test('verify: no journal (audit off) writes nothing; a journal that cannot be written is said (audited false)', async () => {
  const d = draft({ name: 'designer' })
  const rows = { 'profiles.list': { ok: true, data: { profiles: [{ name: 'designer' }] } } }
  const off = wire(rows)
  assert.equal((await verifyRecruit(off.ctx, orderOf(d), answer(), false, off.request)).present, true)
  assert.equal(off.posts.length, 0)
  const down = wire(rows, { audit: false })
  assert.equal((await verifyRecruit(down.ctx, orderOf(d), answer(), true, down.request)).audited, false)
})
test('verify of the model follow-up: read from profiles.describe (the list carries no model); only model.* is read, never the soul; its journal line is « model_applied », not a second recruitment', async () => {
  const held = recruitTarget({ name: 'designer' }, id, { message: '', model: 'big', provider: 'p' })
  const yes = wire({ 'profiles.describe': { ok: true, data: { name: 'designer', soul: 'SECRET SOUL', model: { default: 'big', provider: 'p' }, skills: [] } } })
  const res = await verifyRecruit(yes.ctx, held, answer(), true, yes.request)
  assert.equal(res.present, true)
  assert.deepEqual(yes.calls, [['profiles.describe', { name: 'designer' }]], 'one call, to describe, never to the list')
  assert.deepEqual(yes.posts[0][1], { id, verb: 'recruit', risk: 'final', result: 'done', profile: 'designer', reason: 'model_applied' })
  assert.doesNotMatch(JSON.stringify([res, yes.posts]), /SECRET/)
  const no = wire({ 'profiles.describe': { ok: true, data: { model: { default: 'other', provider: 'p' } } } })
  assert.equal((await verifyRecruit(no.ctx, held, answer(), true, no.request, () => Promise.resolve())).present, false)
  assert.equal(no.posts[0][1].reason, 'model_not_read')
  const unreadable = wire({ 'profiles.describe': { ok: false } })
  assert.deepEqual(await verifyRecruit(unreadable.ctx, held, answer(), true, unreadable.request, () => Promise.resolve()), { present: null, audited: true })
  assert.equal(unreadable.posts.length, 0)
})
test('verify of the model follow-up: a write may need a moment to show: bounded re-reads before « not read »; a recruitment itself is read once', async () => {
  const held = recruitTarget({ name: 'designer' }, id, { message: '', model: 'big', provider: 'p' })
  const rows = ['old', 'old', 'big']
  let n = 0
  const ctx = { rest: async () => ({ ok: true }) }
  const request = async () => ({ ok: true, data: { model: { default: rows[Math.min(n++, rows.length - 1)], provider: 'p' } } })
  const waits = []
  const res = await verifyRecruit(ctx, held, answer(), true, request, ms => { waits.push(ms); return Promise.resolve() })
  assert.equal(res.present, true)
  assert.equal(n, 3, 'third read shows the model')
  assert.equal(waits.length, 2)
  let reads = 0
  const never = async () => { reads++; return { ok: true, data: { model: { default: 'old', provider: 'p' } } } }
  assert.equal((await verifyRecruit(ctx, held, answer(), true, never, () => Promise.resolve())).present, false)
  assert.equal(reads, 3, 'a bounded number of reads, then it says so')
  reads = 0
  const create = recruitTarget(draft({ name: 'designer' }), id)
  assert.equal((await verifyRecruit(ctx, create, answer(), true, async () => { reads++; return { ok: true, data: { profiles: [] } } }, () => Promise.resolve())).present, false)
  assert.equal(reads, 1, 'a recruitment itself is read once: the folder exists or it does not')
})
test('sendRecruit: the answer for the machine; a lost create is unknown, never « failed »; the held model rides along', async () => {
  const ok = await sendRecruit(orderOf(draft({ name: 'x', model: 'big', provider: 'p' })), stub({ 'profiles.configure': p => ('model' in p ? { ok: true, data: { confirm_required: true, confirm_message: 'm' } } : null) }).request)
  assert.equal(ok.type, 'answered')
  assert.deepEqual(ok.answer.detail.modelHeld, { message: 'm', model: 'big', provider: 'p' })
  assert.deepEqual(await sendRecruit(orderOf(draft({ name: 'x' })), stub({ 'profiles.create': { ok: false, error: new Error('timeout') } }).request), { type: 'failed', reason: 'unknown_outcome' })
  assert.equal((await sendRecruit(recruitTarget({ name: 'x' }, id, { message: '', model: 'm', provider: 'p' }), stub().request)).type, 'answered')
})
test('recruitAuditBody: the closed fields of POST /audit, nothing else', () => {
  assert.deepEqual(recruitAuditBody({ id, code: 'designer' }, { result: 'done' }), { id, verb: 'recruit', risk: 'final', result: 'done', profile: 'designer' })
  assert.equal(recruitAuditBody({ id, code: 'x' }, { result: 'failed', reason: 'Bad Reason!' }).reason, undefined)
})
test('journal reader keeps the profile name of a recruitment (and still no text, path or command)', () => {
  const j = toJournal({ ok: true, entries: [{ ts: 5, id: 'a', verb: 'recruit', risk: 'final', result: 'done', profile: 'designer', source: 'page', path: '/home/x', soul: 'S' }] })
  assert.equal(j.entries[0].profile, 'designer')
  assert.doesNotMatch(JSON.stringify(j), /\/home|"S"/)
})

/* ---------- « Command » achievements ---------- */
const D = 86_400_000
const T0 = new Date(2026, 10, 10, 12).getTime()
const line = (over, k = 0) => ({ ms: T0 + k * D, id: `i${k}`, verb: 'unblock', risk: 'final', board: 'b', task: 't', result: 'done', before: null, after: null, len: null, choice: null, profile: null, source: 'agent', reason: null, ...over })
const play = (entries, window = JOURNAL_FETCH) => computeGame({ ok: true, profiles: {}, boards: [] }, { boards: [], agents: [] }, T0 + 30 * D, {}, commandDefs({ ok: true, entries }, window))
const ach = (g, id) => g.achievements.find(a => a.id === id)

test('Command: no journal read = no definition (the family is not shown, nothing is invented)', () => {
  assert.deepEqual(commandDefs(null), [])
  assert.deepEqual(commandDefs({ ok: false, entries: [] }), [])
  const g = computeGame({ ok: true, profiles: {}, boards: [] }, { boards: [], agents: [] }, T0, {}, commandDefs(null))
  assert.equal(g.achievements.some(a => a.family === 'command'), false)
})
test('Command: an empty journal shows the family, all locked; guardian stays hidden', () => {
  const g = play([])
  assert.deepEqual(COMMAND_IDS.map(i => ach(g, i).unlocked), [false, false, false])
  assert.deepEqual(COMMAND_IDS.map(i => ach(g, i).hidden), [false, false, true])
  assert.deepEqual(COMMAND_IDS.map(i => ach(g, i).family), ['command', 'command', 'command'])
  assert.equal(ach(g, 'pilot').source, 'audit')
})
test('pilot: just under the threshold (a refused / failed / non-order line) does not unlock; one executed order does, dated on that line', () => {
  const under = play([line({ result: 'refused', reason: 'not_blocked' }, 0), line({ result: 'failed' }, 1), line({ verb: 'approval', choice: 'deny', source: 'page' }, 2), line({ verb: 'recruit', source: 'page', profile: 'x' }, 3), line({ source: 'page' }, 4)])
  assert.equal(ach(under, 'pilot').unlocked, false)
  assert.deepEqual(ach(under, 'pilot').progress, [0, 1])
  const at = play([line({ verb: 'comment' }, 5), line({ verb: 'unblock' }, 2), line({ result: 'failed' }, 1)])
  assert.equal(ach(at, 'pilot').unlocked, true)
  assert.equal(ach(at, 'pilot').unlockedMs, T0 + 2 * D, 'the OLDEST executed order')
  assert.deepEqual(ach(at, 'pilot').fact, ['game.fact.pilot', 'unblock', 'b'])
})
test('recruiter: needs a recruitment written by the page and done; the model follow-up is not one; the name is the evidence', () => {
  const under = play([line({ verb: 'recruit', source: 'page', result: 'failed', profile: 'x', reason: 'not_listed' }), line({ verb: 'recruit', source: 'page', profile: 'x', reason: 'model_applied' }, 1), line({ verb: 'recruit', source: 'agent', profile: 'x' }, 2)])
  assert.equal(ach(under, 'recruiter').unlocked, false)
  const at = play([line({ verb: 'recruit', source: 'page', profile: 'designer' }, 3), line({ verb: 'recruit', source: 'page', profile: 'later' }, 9)])
  assert.equal(ach(at, 'recruiter').unlocked, true)
  assert.equal(ach(at, 'recruiter').unlockedMs, T0 + 3 * D)
  assert.deepEqual(ach(at, 'recruiter').fact, ['game.fact.recruiter', 'designer'])
})
test('guardian (hidden): only a REFUSAL answered and done counts; the others do not; locked it stays secret', () => {
  const under = play([line({ verb: 'approval', choice: 'once', source: 'page', request: 'req00000001' }), line({ verb: 'approval', choice: 'deny', source: 'page', result: 'failed', request: 'req00000001' }, 1), line({ verb: 'approval', choice: 'always', source: 'page' }, 2)])
  assert.equal(ach(under, 'guardian').unlocked, false)
  assert.equal(ach(under, 'guardian').hidden, true)
  const at = play([line({ verb: 'approval', choice: 'deny', source: 'page', request: 'req00000001' }, 4)])
  assert.equal(ach(at, 'guardian').unlocked, true)
  assert.equal(ach(at, 'guardian').unlockedMs, T0 + 4 * D)
  assert.equal(ach(at, 'guardian').hidden, true)
})
test('Command: a journal read in full (window reached) unlocks WITHOUT a date: the first line may be older than the window', () => {
  const entries = Array.from({ length: 5 }, (_, i) => line({ verb: 'recruit', source: 'page', profile: `p${i}` }, i))
  assert.equal(ach(play(entries, 5), 'recruiter').unlocked, true)
  assert.equal(ach(play(entries, 5), 'recruiter').dated, false)
  assert.equal(ach(play(entries, 6), 'recruiter').dated, true, 'one line fewer than the window: the journal is whole, the date is real')
})
test('Command: names, conditions and facts exist in EN, FR and ES; the source line too', () => {
  for (const lang of ['en', 'fr', 'es']) {
    const g = messages[lang].game
    for (const i of COMMAND_IDS) assert.ok(g.ach[i].name && g.ach[i].cond.length > 15, `${lang} ${i}`)
    assert.ok(typeof g.fact.pilot('unblock', 'b') === 'string' && typeof g.fact.recruiter('x') === 'string' && typeof g.fact.guardian() === 'string')
    assert.ok(g.src.audit('10:00').includes('10:00'))
  }
})
test('Command: the 32 achievements stay 32 without the journal; three more with it; the 35 medal glyphs are all different', () => {
  assert.equal(computeGame({ ok: true, profiles: {}, boards: [] }, { boards: [], agents: [] }, T0, {}).achievements.length, 32)
  assert.equal(play([]).achievements.length, 35)
  const src = readFileSync(new URL('../../src/scene/decor.js', import.meta.url), 'utf8')
  const glyphs = [...src.slice(src.indexOf('const GLYPH'), src.indexOf('const glyphOf')).matchAll(/(\w+): '([01]{9})'/g)]
  assert.equal(glyphs.length, 35)
  assert.equal(new Set(glyphs.map(m => m[2])).size, 35, 'every medal has its own glyph')
  for (const id of COMMAND_IDS) assert.ok(glyphs.some(m => m[1] === id), `${id} has a glyph`)
  const icons = readFileSync(new URL('../../src/scene/icons.js', import.meta.url), 'utf8')
  for (const id of COMMAND_IDS) assert.match(icons, new RegExp(`\\n  ${id}: l =>`), `${id} has its icon`)
})
}

// ===== recruit =====
{
/* The recruitment window offers a type of bot (every role of the wardrobe, written to ui_meta), the guess does not count the
   skills a copy brings along, six trades join the wardrobe, and the model + provider are picked from Hermes' `model.options`
   (allow-listed, bounded by a deadline, no key ever held). The RPC is a stand-in: nothing here talks to Hermes. */
const STUB = 'export const host = { request: () => { throw new Error(\'no host\') } }'
const url = s => `data:text/javascript,${encodeURIComponent(s)}`
register(url(`const M = { '@hermes/plugin-sdk': ${JSON.stringify(url(STUB))} }\nexport async function resolve(s, c, next) { return M[s] ? { url: M[s], shortCircuit: true } : next(s, c) }`))
const { loadModelOptions } = await import('../../src/data/modelOptions.js')

const src = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')

/* ---------- 1. the guess ignores what a copy brings along ---------- */
// ~80 skills of `default`, the ones that used to push every copy to « Relecture » (testing, audit, review…)
const DEFAULT_SKILLS = ['testing', 'audit', 'code-review', 'security-review', 'qa', 'verification', 'review-checklist', 'tests-runner',
  ...Array.from({ length: 72 }, (_, i) => `skill-${i}`)].map(name => ({ name, category: name.includes('review') || name === 'audit' ? 'quality' : '' }))
const profiles = [
  { name: 'default', isDefault: true, skills: { enabled: DEFAULT_SKILLS.length, own: DEFAULT_SKILLS } },
  { name: 'frontend', isDefault: false, skills: { enabled: 5, own: [] } }
]
const hire = over => ({ ...hireDraft(profiles), ...over })
const guessOf = d => roleOf(hireAgent(d, profiles)).role

test('the cause: the skills of `default` alone read « reviewer » (this is what the copy used to bring)', () => {
  assert.equal(detectRole({ name: 'manager', description: '', skills: { own: DEFAULT_SKILLS } })?.id, 'reviewer')
})

test('manager, project-lead, accountant, designer, writer, research, support copied from default get their own role', () => {
  const cases = [['manager', '', 'manager'], ['project-lead', 'Coordinates the projects', 'manager'], ['accountant', '', 'finance'],
    ['designer', '', 'designer'], ['writer', '', 'writer'], ['research', '', 'researcher'], ['support', '', 'support']]
  for (const [name, description, want] of cases) {
    assert.equal(guessOf(hire({ name, description, start: 'clone', from: 'default' })), want, `${name} copied from default`)
    // not copied (fresh / another bot with no skills of its own): the same answer
    assert.equal(guessOf(hire({ name, description, start: 'fresh' })), want, `${name} fresh`)
    assert.equal(guessOf(hire({ name, description, start: 'clone', from: 'frontend' })), want, `${name} copied from frontend`)
  }
})

test('a name and a description that say nothing: no role is invented from the copied skills', () => {
  assert.equal(guessOf(hire({ name: 'x7', start: 'clone', from: 'default' })), null)
})

test('the preview lists the copied skills as copied', () => {
  const a = hireAgent(hire({ name: 'manager', start: 'clone', from: 'default', off: ['qa'] }), profiles)
  assert.equal(a.copiedSkills.length, DEFAULT_SKILLS.length - 1)
  assert.equal(a.copiedSkills.includes('qa'), false)
  assert.deepEqual(hireAgent(hire({ name: 'm', start: 'fresh' }), profiles).copiedSkills, [])
})

test('in the scene: a bot hired by copy (ui_meta copiedFrom) is guessed without the skills it copied, with those it gained since', () => {
  const office = { agents: [{ name: 'manager', state: 'idle', officeMeta: { role: 'auto', hiredFrom: 'office', copiedFrom: 'default' } }, { name: 'manager2', state: 'idle', officeMeta: { role: 'auto' } }], boards: [] }
  const prof = { default: { description: '', skills: DEFAULT_SKILLS }, manager: { description: '', skills: DEFAULT_SKILLS }, manager2: { description: '', skills: DEFAULT_SKILLS } }
  const m = toSceneModel(office, { profiles: prof }).agents
  assert.equal(roleOf(m[0]).role, 'manager', 'copied skills ignored: the name decides')
  assert.equal(roleOf(m[1]).role, 'reviewer', 'no copiedFrom (a bot the office did not copy): nothing changes')
  // a skill gained after the copy counts
  const gained = toSceneModel({ agents: [{ name: 'zed', state: 'idle', officeMeta: { copiedFrom: 'default' } }], boards: [] },
    { profiles: { default: { skills: DEFAULT_SKILLS }, zed: { skills: [...DEFAULT_SKILLS, { name: 'crm-follow-up' }] } } }).agents[0]
  assert.equal(roleOf(gained).role, 'sales')
  // the skills stay on the agent (the desk objects still read them)
  assert.equal(m[0].skills.length, DEFAULT_SKILLS.length)
  assert.deepEqual(copiedSkillsOf('ghost', 'a', { default: { skills: DEFAULT_SKILLS } }), [], 'a source that is gone: nothing ignored')
  assert.deepEqual(copiedSkillsOf('a', 'a', { a: { skills: DEFAULT_SKILLS } }), [], 'a bot is never its own source')
})

/* ---------- 2. the choice is written ---------- */
test('the chosen type is written to ui_meta[hermes-officecraft].role; Automatic stays `auto`', () => {
  const metaOf = d => hirePayload(d).find(([, p]) => p.ui_meta)[1].ui_meta['hermes-officecraft']
  assert.equal(metaOf(hire({ name: 'manager' })).role, 'auto')
  assert.equal(AUTO_ROLE, 'auto')
  for (const id of ALL_ROLE_IDS) assert.equal(metaOf(hire({ name: 'x', role: id })).role, id)
  assert.equal(metaOf(hire({ name: 'x', role: 'none' })).role, 'none')
  assert.equal(metaOf(hire({ name: 'x', role: 'wizard' })).role, 'auto', 'a role that is not in the catalogue is never written')
  assert.equal(metaOf(hire({ name: 'x', role: undefined })).role, 'auto')
  assert.equal(roleChoice('Manager'), 'auto')
  assert.equal(metaOf(hire({ name: 'x', start: 'clone', from: 'default' })).copiedFrom, 'default')
  assert.equal('copiedFrom' in metaOf(hire({ name: 'x', start: 'fresh' })), false)
  assert.equal('copiedFrom' in metaOf(hire({ name: 'x', start: 'empty' })), false)
  assert.equal(hireDraft(profiles).role, 'auto', 'the default is Automatic')
})

test('the preview follows the chosen type; the roster reads the same key back (officeMeta.role -> roleOverride)', () => {
  const chosen = hireAgent(hire({ name: 'manager', start: 'clone', from: 'default', role: 'legal' }), profiles)
  assert.equal(roleOf(chosen).role, 'legal')
  assert.equal(roleOf(chosen).why.kind, 'manual')
  assert.equal(roleOf(hireAgent(hire({ name: 'manager', role: 'none' }), profiles)).role, null, 'Generalist = no role')
  // what is written is what the scene reads
  const written = hirePayload(hire({ name: 'zed', role: 'translator' })).find(([, p]) => p.ui_meta)[1].ui_meta
  const scene = toSceneModel({ agents: [{ name: 'zed', state: 'idle', officeMeta: { ...written['hermes-officecraft'] } }], boards: [] }, {}).agents[0]
  assert.equal(roleOf(scene).role, 'translator')
  assert.equal(JSON.stringify(requestsPreview(hire({ name: 'x', role: 'hr' }))).includes('"role":"hr"'), true, 'the requests the page shows carry it')
})

test('the picker lists « Automatic », every role of the catalogue exactly once, then the generalist', () => {
  const list = roleChoices()
  assert.equal(list[0], 'auto')
  assert.equal(list.at(-1), 'none')
  assert.deepEqual([...list.slice(1, -1)].sort(), [...ALL_ROLE_IDS].sort())
  assert.equal(new Set(list).size, list.length)
  assert.ok(ALL_ROLE_IDS.length >= 22, 'the 16 and the six added')
})

/* ---------- 3. the wider catalogue ---------- */
const EXTRA = ['assistant', 'product', 'hr', 'translator', 'comms', 'logistics']
const role = (name, description = '') => detectRole({ name, description })?.id ?? null

test('the six added roles exist; the first 16 stay the agent half\'s closed list', () => {
  assert.deepEqual(ROLE_IDS, ['executive', 'manager', 'designer', 'developer', 'devops', 'data', 'researcher', 'writer', 'reviewer', 'marketer', 'sales', 'support', 'legal', 'finance', 'teacher', 'media'])
  for (const id of EXTRA) assert.ok(ALL_ROLE_IDS.includes(id) && !ROLE_IDS.includes(id), id)
  // hermes_officecraft/llm.py keeps the 16: its pytest parity test reads the ROLES block of wardrobe.js
  const block = src('scene/wardrobe.js')
  const head = block.slice(block.indexOf('export const ROLES = {'), block.indexOf('export const ROLE_IDS'))
  assert.deepEqual([...head.matchAll(/^ {2}(\w+): \{ label:/gm)].map(m => m[1]), ROLE_IDS)
})

test('every added role is reachable from its first keyword and from its name / description in en, fr, es', () => {
  for (const id of EXTRA) assert.equal(role('n', ROLES[id].keys[0].replace(/^=/, '')), id, id)
  const cases = [
    ['assistant', ['secretaire', ''], ['assistante-personnelle', ''], ['n', 'Personal assistant for the founder'], ['secretaria', 'Gestiona llamadas']],
    ['product', ['product-manager', ''], ['n', 'Keeps the roadmap and the backlog'], ['chef-de-produit', ''], ['producto', '']],
    ['hr', ['recruiter', ''], ['rh', ''], ['n', 'Human resources: hiring and candidates'], ['recursos-humanos', '']],
    ['translator', ['traducteur', ''], ['translator', ''], ['n', 'Traduce los artículos al español'], ['n', 'Localisation des textes']],
    ['comms', ['relations-presse', ''], ['n', 'Press release and media relations'], ['comunicacion', ''], ['n', 'Communication interne']],
    ['logistics', ['achats', ''], ['procurement', ''], ['n', 'Suivi des fournisseurs et des livraisons'], ['compras', 'Gestión de proveedores']]
  ]
  for (const [want, ...rows] of cases) for (const [n, d] of rows) assert.equal(role(n, d), want, `${want}: ${n} / ${d}`)
})

test('the new keywords do not steal the old roles', () => {
  assert.equal(role('redactrice', 'Rédige les billets du blog dans deux langues'), 'writer')
  assert.equal(role('writer', 'Writes blog posts and newsletters'), 'writer')
  assert.equal(role('marketing', 'Production planning for the campaign'), 'marketer')   // « production » is not « product »
  assert.equal(role('support', 'Customer support: answers tickets, writes help-center articles.'), 'support')
  assert.equal(role('chef-orchestre', "Chef d'orchestre : découpe un but en étapes et confie chacune au bon profil"), 'manager')
  assert.equal(role('x', 'He communicates every day'), null, '« communicate » is not « communication »')
})

test('every added role has a drawn outfit: its own garment, front and back, distinct from the others', () => {
  const seen = new Map()
  const CORE = ['shirt', 'shirtTie', 'suit', 'blazer', 'hoodie', 'tee', 'vest', 'cardigan', 'polo', 'bomber', 'jacketOpen', 'fieldVest', 'flannel', 'sweater', 'waistcoat']
  for (const id of EXTRA) {
    const look = ROLES[id].looks[0]
    const O = outfitOf({ name: 'zed', roleOverride: id })
    assert.equal(O.garment, look.g, id)
    assert.ok(O.label, id)
    assert.ok(!CORE.includes(look.g), `${id} wears a garment drawn for it`)
    for (const facing of ['front', 'back']) assert.ok(agentSprite({ name: 'zed', state: 'idle', roleOverride: id, skills: [] }, facing, 1), `${id} ${facing}`)
    const p = portrait({ name: 'zed', roleOverride: id, state: 'idle' })
    assert.ok(p.d.some(v => v !== 0), `${id} draws pixels`)
    const key = Array.from(p.d).join(',')
    assert.equal(seen.has(key), false, `${id} looks like ${seen.get(key)}`)
    seen.set(key, id)
  }
  assert.equal(seen.has(Array.from(portrait({ name: 'zed', state: 'idle' }).d).join(',')), false)
})

test('each role has its label in en, fr and es, and a closest role the agent half knows (bubbles only receive the closed 16)', () => {
  for (const lang of ['en', 'fr', 'es']) for (const id of ALL_ROLE_IDS) assert.ok(messages[lang].role[id]?.length > 1, `${lang}.role.${id}`)
  for (const id of ALL_ROLE_IDS) assert.ok(ROLE_IDS.includes(wireRole(id)), `${id} -> ${wireRole(id)}`)
  assert.equal(wireRole('legal'), 'legal')
  assert.equal(wireRole(null), null)
  const agents = EXTRA.map(id => ({ name: id, state: 'working', roleOverride: id }))
  for (const r of Object.values(thoughtRoles(agents))) assert.ok(ROLE_IDS.includes(r), r)
  assert.equal(Object.keys(thoughtRoles(agents)).length, EXTRA.length)
})

/* ---------- 4. model.options ---------- */
const CATALOG = Array.from({ length: 300 }, (_, i) => `vendor-${i % 7}/model-${i}${i % 50 === 0 ? '-large' : ''}`)
const pricingOf = ids => Object.fromEntries(ids.slice(0, 5).map((id, i) => [id, { input: `$${(i + 1) / 10}`, output: `$${i + 1}`, cache: null, free: false }]))
const PAYLOAD = {
  model: 'example/model-fast-1017', provider: 'zenith',
  providers: [
    { slug: 'northwind', name: 'Northwind Portal', authenticated: false, is_current: false, auth_type: 'oauth_device_code', key_env: '', models: [], total_models: 0, warning: 'run `hermes model` to configure (oauth_device_code)' },
    { slug: 'contoso', name: 'Contoso AI', authenticated: false, is_current: false, auth_type: 'api_key', key_env: 'CONTOSO_API_KEY', models: [], total_models: 0 },
    { slug: 'example', name: 'Example AI', authenticated: true, is_current: false, models: ['model-large', 'model-medium'], total_models: 2 },
    { slug: 'zenith', name: 'Zenith', authenticated: true, is_current: true, models: CATALOG, total_models: 300, pricing: pricingOf(CATALOG), capabilities: { x: { fast: true } }, featured_models: ['a'] }
  ]
}
const ok = data => async () => ({ ok: true, data })

test('model.options: ready providers first (the current one at the head), the others after; the inherited model is the real one', () => {
  const p = parseModelOptions(PAYLOAD)
  assert.deepEqual(p.inherited, { model: 'example/model-fast-1017', provider: 'zenith' })
  const sorted = sortProviders(p.providers)
  assert.deepEqual(sorted.map(x => x.slug), ['zenith', 'example', 'contoso', 'northwind'])
  assert.deepEqual(sorted.map(x => x.ready), [true, true, false, false])
  assert.equal(p.providers.find(x => x.slug === 'zenith').models.length, 300)
})

test('model.options: a row with no `authenticated` flag (an older Hermes lists configured providers only) is ready; models as objects or bare slugs', () => {
  const p = parseModelOptions({ providers: [{ slug: 'old', models: [{ id: 'm1', name: 'Model One' }, 'm2', { name: 'no id' }, 7, null, 'm1'] }] })
  assert.equal(p.providers[0].ready, true)
  assert.deepEqual(p.providers[0].models.map(m => [m.id, m.name]), [['m1', 'Model One'], ['m2', '']], 'no id, no model; no duplicate')
  assert.deepEqual(p.inherited, { model: '', provider: '' })
})

test('the search filters on the name and the id, every word, accents and case ignored; 300 models are narrowed, not all drawn', () => {
  const models = parseModelOptions(PAYLOAD).providers.find(x => x.slug === 'zenith').models
  assert.equal(filterModels(models, '').length, 300)
  assert.equal(filterModels(models, 'LARGE').length, 6, 'ids 0, 50 … 250 carry « -large »')
  assert.deepEqual(filterModels(models, 'vendor-3 model-38').map(m => m.id), ['vendor-3/model-38'])
  assert.deepEqual(filterModels([{ id: 'x/y', name: 'Élan Pro', price: null }], 'elan').length, 1, 'by display name, accents ignored')
  assert.equal(filterModels(models, 'zzz-nothing').length, 0)
  assert.ok(MODELS_SHOWN < 300 && MODELS_SHOWN >= 50, 'the list draws a bounded number and says how many more')
})

test('the price is the one Hermes gave, or nothing (no figure is invented)', () => {
  const t = (k, p) => `${k}:${p ?? ''}`
  const models = parseModelOptions(PAYLOAD).providers.find(x => x.slug === 'zenith').models
  assert.equal(priceLabel(models[0].price, t), 'recruit.model.priceIn:$0.1 · recruit.model.priceOut:$1')
  assert.equal(models[10].price, null)
  assert.equal(priceLabel(null, t), null)
  assert.equal(priceLabel({ input: 'free', output: 'free', free: true }, t), 'recruit.model.free:')
  assert.equal(parseModelOptions({ providers: [{ slug: 'p', models: ['m'], pricing: { m: { input: '<script>', output: '' } } }] }).providers[0].models[0].price, null, 'a price that is not a price is dropped')
})

test('a model.options answer is read with the call Hermes\' own picker makes', async () => {
  const calls = []
  const res = await loadModelOptions(async (m, p) => { calls.push([m, p]); return { ok: true, data: PAYLOAD } })
  assert.equal(res.state, 'ready')
  assert.deepEqual(calls, [['model.options', { include_unconfigured: true }]])
  assert.equal(MODEL_OPTIONS_TIMEOUT_MS, 20_000)
})

test('past the deadline, an error, an old Hermes and an empty answer all bring back the free fields, each with its reason', async () => {
  const never = () => new Promise(() => {})
  assert.equal((await loadModelOptions(never, { schedule: fn => { fn(); return 1 }, cancel: () => {}, timeoutMs: 1 })).state, 'timeout')
  let cleared = 0
  const quick = await loadModelOptions(ok(PAYLOAD), { schedule: () => 7, cancel: id => { cleared = id }, timeoutMs: 20_000 })
  assert.equal(quick.state, 'ready')
  assert.equal(cleared, 7, 'the deadline is cancelled once the answer is in')
  assert.equal((await loadModelOptions(async () => ({ ok: false, reason: 'failed', error: new Error('socket closed') }))).state, 'failed')
  assert.equal((await loadModelOptions(async () => ({ ok: false, reason: 'failed', error: new Error('unknown method: model.options') }))).state, 'unsupported')
  assert.equal((await loadModelOptions(async () => ({ ok: false, reason: 'unavailable' }))).state, 'unsupported')
  assert.equal((await loadModelOptions(async () => { throw new Error('boom') })).state, 'failed')
  for (const empty of [{}, { providers: [] }, null, { providers: [{ slug: 'a', authenticated: false, models: ['m'] }] }, { providers: [{ slug: 'a', authenticated: true, models: [] }] }])
    assert.equal((await loadModelOptions(ok(empty))).state, 'empty', JSON.stringify(empty))
  assert.equal(failureOf({ reason: 'failed', error: 'Method not found' }), 'unsupported')
  for (const lang of ['en', 'fr', 'es']) for (const s of ['timeout', 'unsupported', 'failed', 'empty']) assert.ok(messages[lang].recruit.model.fallback[s].length > 20, `${lang} ${s}`)
})

/* the answer carries secrets in places it should not: none of them gets into the state of the page, the draft, the requests or the journal */
const SECRETS = ['sk-or-v1-0123456789abcdef0123456789abcdef', 'ghp_AbCdEfGhIjKlMnOpQrStUv', 'Bearer abcdefgh12345678', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', '0123456789abcdef0123456789abcdef0123']
const LEAKY = {
  model: 'm', provider: 'p', api_key: SECRETS[0], token: SECRETS[1],
  providers: [
    { slug: 'zenith', name: 'Zenith', authenticated: true, is_current: true, api_key: SECRETS[0], key: SECRETS[1], key_env: 'ZENITH_API_KEY', api_url: `https://x.example/?k=${SECRETS[4]}`, warning: SECRETS[2], auth_header: SECRETS[3],
      models: ['safe/model', SECRETS[0], { id: SECRETS[1], name: 'leaky' }, { id: 'named/model', name: SECRETS[3] }, 'has space'], pricing: { 'safe/model': { input: SECRETS[2], output: '$1' } }, limit: { token: SECRETS[1] } },
    { slug: SECRETS[0], name: 'bad slug', authenticated: true, models: ['x'] },
    { slug: 'named', name: SECRETS[2], authenticated: true, models: ['y'] }
  ]
}
test('no secret of the answer enters the page state, the draft, the requests or the journal', async () => {
  const state = await loadModelOptions(ok(LEAKY))
  const everything = JSON.stringify(state)
  for (const s of SECRETS) assert.equal(everything.includes(s), false, `state keeps ${s.slice(0, 8)}…`)
  for (const k of ['api_key', 'token', 'key_env', 'api_url', 'auth_header', 'warning', 'limit', 'ZENITH_API_KEY', 'x.example']) assert.equal(everything.includes(k), false, `state keeps ${k}`)
  assert.deepEqual(state.providers.map(p => p.slug), ['zenith', 'named'])
  assert.deepEqual(state.providers[0].models.map(m => m.id), ['safe/model', 'named/model'])
  assert.equal(state.providers[0].models[0].price.input, '', 'a secret-looking price is dropped, the clean one kept')
  assert.equal(state.providers[0].models[0].price.output, '$1')
  assert.equal(state.providers[1].name, 'named', 'a secret-looking name falls back on the slug')
  // pick the first model: the draft holds ids only
  const draft = { ...hireDraft(profiles), name: 'zed', model: state.providers[0].models[0].id, provider: state.providers[0].slug }
  const wire = JSON.stringify([hirePayload(draft), requestsPreview(draft), hireAgent(draft, profiles), recruitAuditBody({ id: 'i', code: 'zed' }, { result: 'done' })])
  for (const s of SECRETS) assert.equal(wire.includes(s), false)
  assert.deepEqual(hirePayload(draft).at(-1), ['profiles.configure', { name: 'zed', model: 'safe/model', provider: 'zenith' }], 'the model still goes through profiles.configure alone (the cost guard of Hermes)')
  for (const s of SECRETS) assert.ok(looksSecret(s), s)
  for (const fine of ['anthropic/claude-3-5-sonnet-20241022', 'claude-sonnet-5[1m]', 'meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-v4.1-flash-1017', 'gpt-5.5-mini', 'moonshotai/kimi-k2-thinking-0905']) assert.equal(looksSecret(fine), false, fine)
})

test('the office never calls model.save_key nor model.disconnect, and has no field to type a key', () => {
  const walk = d => readdirSync(new URL(`../../src/${d}`, import.meta.url), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]))
  const files = ['ui', 'core', 'data', 'scene'].flatMap(walk).filter(f => /\.jsx?$/.test(f))
  for (const f of files) assert.doesNotMatch(src(f), /['"]model\.(save_key|disconnect)['"]/, f)
  assert.doesNotMatch(src('ui/ModelPicker.jsx'), /type=["']password["']|api_?key/i)
  assert.doesNotMatch(src('data/modelOptions.js') + src('core/modelOptions.js'), /localStorage|sessionStorage|console\./)
  assert.match(src('data/modelOptions.js'), /request\('model\.options', \{ include_unconfigured: true \}\)/)
})

/* The 28 radios of the window (types of bot, providers) are visually hidden with `position:absolute`. With no positioned
   chip around them their box is the <dialog> itself: they overflowed it (scrollHeight 1201 > 758, measured in the webapp) and Tab onto
   one scrolled the whole window, header out of sight, blank under the footer (-372 px). Each hidden input must sit in its own chip. */
test('a hidden radio is positioned against its own chip, never against the dialog (Tab must not scroll the window)', async () => {
  const { DIALOG_CSS } = await import('../../src/ui/dialogStyles.js')
  const rules = [...DIALOG_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sels: m[1].split(',').map(s => s.trim()), body: m[2] }))
  const anchored = new Set(rules.filter(r => /position:\s*relative/.test(r.body)).flatMap(r => r.sels))
  const hidden = rules.filter(r => /position:\s*absolute/.test(r.body)).flatMap(r => r.sels).filter(s => /\sinput$/.test(s))
  assert.ok(hidden.includes('.oc-dg-pill input'), 'the chips hide their radio')
  for (const s of hidden) {
    const box = s.replace(/\s+input$/, '')
    assert.ok(anchored.has(box) || anchored.has(`${box} label`), `${s}: ${box} (or its label) must be position:relative`)
  }
})

test('chef-projet copied from default, with no description, is guessed « Coordination » from its name alone', () => {
  assert.equal(guessOf(hire({ name: 'chef-projet', start: 'clone', from: 'default' })), 'manager')
  assert.equal(role('chef-projet'), 'manager')
})

/* The « not configured » providers scroll in a box of 96 px; rows are 24 px with a 4 px gap, so the box cut the 4th
   row through the middle of its text, right above « To add one, configure it… » (webapp, 1440 and 380 px: half a provider name read as
   broken text). The cut must fall between two rows, or the last visible row must fade out (the list goes on). */
test('the unconfigured providers list never cuts a row of text in half above the note', async () => {
  const { DIALOG_CSS } = await import('../../src/ui/dialogStyles.js')
  const css = DIALOG_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const body = sel => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].split(',').map(s => s.trim()).includes(sel)).map(m => m[2]).join(';')
  const list = body('.oc-mp-offl')
  const px = (b, prop) => Number((b.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*(\\d+)px`)) || [])[1])
  const maxH = px(list, 'max-height'), rowH = px(body('.oc-mp-offl li'), 'min-height')
  const gap = Number((list.match(/gap:\s*(\d+)px/) || [])[1])
  assert.ok(maxH && rowH && gap >= 0, `max-height ${maxH}, row ${rowH}, gap ${gap}`)
  const wholeRows = (maxH + gap) % (rowH + gap) === 0
  const fades = /mask-image:\s*linear-gradient\([^;]*transparent/.test(list)
  assert.ok(wholeRows || fades, `a ${maxH} px box over ${rowH}+${gap} px rows cuts a row in half with no fade`)
})

test('the window wires the type of bot and the picker; the free fields only come back from the picker\'s fallback', () => {
  const dlg = src('ui/HireDialog.jsx')
  assert.match(dlg, /<RolePicker value=\{draft\.role\}/)
  assert.match(dlg, /<ModelPicker opts=\{modelOpts\}/)
  assert.match(dlg, /useModelOptions\(open && !confirming\)/, 'read when the window opens, never polled')
  assert.doesNotMatch(dlg, /data-h="provider"/)
  assert.match(src('ui/ModelPicker.jsx'), /data-h="provider"/)
  assert.doesNotMatch(src('ui/ModelPicker.jsx') + dlg, /setInterval|refetchInterval/)
  for (const lang of ['en', 'fr', 'es']) {
    const r = messages[lang].recruit
    for (const k of ['roleField', 'roleHint', 'roleAuto', 'roleGuessedTag']) assert.ok(r[k]?.length > 2, `${lang} ${k}`)
    for (const k of ['inherited', 'connected', 'unconfigured', 'configureIn', 'openSettings', 'search', 'loading']) assert.ok(r.model[k], `${lang} model.${k}`)
  }
})
}

// ===== recruit =====
{
// Typing « Research » while « research » exists said « already taken » (the field lowercased before the check):
// the message must say first that capitals are refused.
const known = [{ name: 'default', isDefault: true }, { name: 'research' }]
const draft = name => ({ ...hireDraft(known), name })

test('a capital is refused before a duplicate is mentioned', () => {
  assert.deepEqual(hireErrors(draft('Research'), known), ['name_format'])
  assert.deepEqual(hireErrors(draft('RESEARCH'), known), ['name_format'])
  assert.deepEqual(hireErrors(draft('research'), known), ['name_taken'])
})
test('the field keeps what was typed (no silent lowercase before the check)', () => {
  const dialog = readFileSync(new URL('../../src/ui/HireDialog.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(dialog, /normalizeName/, 'the field must not lowercase the typed name')
})
test('the format message says that capitals are refused (EN, FR, ES)', () => {
  const words = { en: /capital|uppercase/i, fr: /majuscule/i, es: /mayúscula/i }
  for (const lang of ['en', 'fr', 'es']) assert.match(messages[lang].recruit.err.name_format, words[lang], lang)
})
}
