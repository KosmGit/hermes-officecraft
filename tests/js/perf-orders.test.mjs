import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { test } from 'node:test'
import { IDLE, initialOrderState, orderReducer, recruitTarget, reviseTarget } from '../../src/core/orders.js'
import { clearLeft, leftBehind, leftOutcome, leftSent, peekLeft, rememberLeft } from '../../src/core/orderflow.js'
import { hireDraft } from '../../src/core/recruit.js'
import { messages } from '../../src/i18n/index.js'

// ===== an order that left while the page was left: the re-read and the journal line are made by the departure's own chain =====
{
const STUB = 'export const host = { request: () => { throw new Error(\'no host\') } }'
const url = s => `data:text/javascript,${encodeURIComponent(s)}`
register(url(`const M = { '@hermes/plugin-sdk': ${JSON.stringify(url(STUB))} }\nexport async function resolve(s, c, next) { return M[s] ? { url: M[s], shortCircuit: true } : next(s, c) }`))
const { depart } = await import('../../src/data/recruit.js')

const known = [{ name: 'default', isDefault: true, skills: { enabled: 3, own: [] } }]
const order = recruitTarget({ ...hireDraft(known), name: 'designer', title: 'Secret title', description: 'Secret mission' }, 'id-1')
const noWait = async () => {}

/** The host and the agent half stood in for: every call is recorded. */
function world({ create = { ok: true, data: { ok: true } }, listed = [{ name: 'designer', description: 'Takes backend tasks, delivers tested code.' }] } = {}) {
  const w = { calls: [], posts: [], dispatched: [] }
  w.request = async (method, params) => {
    w.calls.push(method)
    if (method === 'profiles.create') return create
    if (method === 'profiles.list') return { ok: true, data: { profiles: listed } }
    return { ok: true, data: {} }
  }
  w.ctx = { rest: async (path, opts) => { w.posts.push([path, opts.body]); return { ok: true, id: opts.body.id } } }
  w.dispatch = action => { w.dispatched.push(action) }
  return w
}
const run = (w, o, mounted) => depart(o, { mounted: () => mounted, dispatch: w.dispatch, ctx: w.ctx, auditOn: true, request: w.request, wait: noWait })

test('the page is still there: the answer goes to the machine, whose effect re-reads and journals (nothing is done twice)', async () => {
  const w = world()
  await run(w, order, true)
  assert.equal(w.calls.filter(m => m === 'profiles.create').length, 1)
  assert.deepEqual(w.dispatched.map(a => a.type), ['answered'])
  assert.equal(w.calls.includes('profiles.list'), false)
  assert.equal(w.posts.length, 0)
})

test('the page was left while the recruitment was `sending`: the list is read back and the journal line is written, here', async () => {
  const w = world()
  await run(w, order, false)
  assert.equal(w.calls.filter(m => m === 'profiles.create').length, 1, 'the request left once')
  assert.equal(w.calls.filter(m => m === 'profiles.list').length, 1, 'the list is read back')
  assert.deepEqual(w.dispatched, [], 'nothing is handed to a machine that is gone')
  assert.deepEqual(w.posts, [['/audit', { id: 'id-1', verb: 'recruit', risk: 'final', result: 'done', profile: 'designer' }]], 'one line, the bot name only')
  assert.doesNotMatch(JSON.stringify(w.posts), /Secret/)
})

test('left, and the bot is not in the list: the line says it failed, as the re-read would; a refused create is journaled too', async () => {
  const absent = world({ listed: [{ name: 'other' }] })
  await run(absent, order, false)
  assert.deepEqual(absent.posts.map(p => [p[1].result, p[1].reason]), [['failed', 'not_listed']])
  const refused = world({ create: { ok: true, data: { ok: false } } })
  await run(refused, order, false)
  assert.deepEqual(refused.posts.map(p => [p[1].result, p[1].reason]), [['failed', 'hermes_error']])
})

test('left during the revision of a description: the description is read back and the line (bot, length, never the text) is written', async () => {
  const text = 'Takes backend tasks, delivers tested code.'
  const w = world({ listed: [{ name: 'backend', description: text }] })
  await run(w, reviseTarget('backend', text, 'id-2'), false)
  assert.deepEqual(w.calls, ['profiles.configure', 'profiles.list'])
  assert.equal(w.posts.length, 1)
  assert.equal(w.posts[0][1].result, 'done')
  assert.doesNotMatch(JSON.stringify(w.posts), /Takes backend/)
  // an unreadable list claims nothing and writes nothing (as in the re-read)
  const unread = world()
  unread.request = async m => (m === 'profiles.list' ? { ok: false } : { ok: true, data: { applied: { description: true } } })
  await run(unread, reviseTarget('backend', text, 'id-3'), false)
  assert.equal(unread.posts[0][1].reason, 'unknown_outcome')
})

test('the way back says « sent, outcome not read »: an order that had left is not an order cancelled by leaving', () => {
  const sending = { ...IDLE, phase: 'sending', order }
  const verifying = { ...IDLE, phase: 'verifying', order }
  const counting = { ...IDLE, phase: 'counting', order }
  assert.equal(leftBehind(sending), null, 'a window that is not counting cancelled nothing')
  assert.equal(leftSent(counting), null)
  assert.equal(leftSent(initialOrderState()), null)
  for (const s of [sending, verifying]) {
    const info = leftSent(s)
    assert.deepEqual([info.sent, info.verb, info.code], [true, 'recruit', 'designer'])
    assert.ok(!('draft' in info) && !('description' in info), 'only what names the target')
  }
  rememberLeft(leftSent(sending))
  const out = leftOutcome(peekLeft())
  assert.deepEqual([out.ok, out.cancelled, out.reason, out.leftSent, out.verb, out.code], [false, false, 'unknown_outcome', true, 'recruit', 'designer'])
  const back = initialOrderState(out)
  assert.equal(back.phase, 'idle')
  assert.equal(back.outcome.leftSent, true)
  clearLeft()
  // what a window cancelled by leaving says is unchanged
  rememberLeft(leftBehind(counting))
  assert.deepEqual([leftOutcome(peekLeft()).cancelled, leftOutcome(peekLeft()).reason], [true, 'left'])
  clearLeft()
  assert.equal(orderReducer(sending, { type: 'answered', answer: { ok: true } }).phase, 'verifying')
})

test('the line is in the three languages and names the target', () => {
  for (const lang of ['en', 'fr', 'es']) {
    const line = messages[lang].orders.sentLeft('Recruit designer')
    assert.ok(line.includes('Recruit designer') && line.length > 30, lang)
  }
})

test('the hook hands a recruitment and a revision to `depart`, and remembers an order that left when the page unmounts', () => {
  const hook = readFileSync(new URL('../../src/data/orders.js', import.meta.url), 'utf8')
  assert.match(hook, /mounted\.current = false; rememberLeft\(leftBehind\(latest\.current\.state\) \|\| leftSent\(latest\.current\.state\)\)/)
  assert.equal((hook.match(/return depart\(order, \{ mounted: \(\) => mounted\.current, dispatch, ctx, auditOn \}\)/g) || []).length, 2)
  assert.doesNotMatch(hook, /dispatch\(await send(Recruit|Revise)/)
  const bar = readFileSync(new URL('../../src/ui/Orders.jsx', import.meta.url), 'utf8')
  assert.match(bar, /if \(o\.leftSent\) return \[t\('orders\.sentLeft', what\(o, t\)\)/)
})
}
