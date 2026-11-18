import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { CHOICES, CHOICE_RISK, DESCRIPTION_MAX, REQUESTS_MAX, SESSIONS_MAX, approvalTarget, approvalsReducer, auditBody, choiceConfirms, choiceRisk, choicesOf, emptyApprovals, normalizeRequest, pendingView, readLiveSessions, readRespond, sessionGone, sessionsToRead, withProfile } from '../../src/core/approvals.js'
import { REASONS, UNDO_SECONDS, WRITE_VERBS, initialOrderState, isBusy, offeredWrites, orderReducer, riskOf, toJournal } from '../../src/core/orders.js'
import { messages } from '../../src/i18n/index.js'
import { register } from 'node:module'

// ===== approvals =====
{
// Approvals in the decision box. Pure state (requests, choices, risk classes), the order machine for an approval answer,
// the shapes of the real RPC answers, privacy and the source guards.
const T0 = 1_000_000
const run = (state, ...actions) => actions.reduce(orderReducer, state)
// the forms Hermes really sends: `tools/approval.py:937-947` (the queue entry) as `approval.pending` returns it, with the command
const PENDING_ROW = {
  request_id: 'req-1', command: 'rm -rf /tmp/oc-never-run SECRET_TOKEN=abc123', description: 'recursive delete', pattern_key: 'recursive_delete',
  pattern_keys: ['recursive_delete'], allow_permanent: true, allow_session: true, choices: ['once', 'session', 'always', 'deny']
}
const REQ = normalizeRequest(PENDING_ROW, { sessionId: 'sess-A', profile: 'oc-test-one', nowMs: T0 })

test('choices: the four of Hermes, deny always offered, always/session withdrawn when Hermes says so, nothing outside the four', () => {
  assert.deepEqual([...CHOICES], ['deny', 'once', 'session', 'always'])
  assert.deepEqual(choicesOf(PENDING_ROW), ['deny', 'once', 'session', 'always'])
  assert.deepEqual(choicesOf({ choices: ['once', 'deny'] }), ['deny', 'once'])
  assert.deepEqual(choicesOf({ choices: ['once', 'rm', 'sudo', 'deny'] }), ['deny', 'once'], 'an unknown choice is never offered')
  assert.deepEqual(choicesOf({ choices: ['once'] }), ['deny', 'once'], 'deny is always there')
  // no `choices` list: derived like tui_gateway/server.py::_approval_request_payload
  assert.deepEqual(choicesOf({}), ['deny', 'once', 'session', 'always'], 'Hermes allows session and permanent unless it says otherwise')
  assert.deepEqual(choicesOf({ allow_session: true, allow_permanent: true }), ['deny', 'once', 'session', 'always'])
  assert.deepEqual(choicesOf({ allow_permanent: false, allow_session: true }), ['deny', 'once', 'session'])
  assert.deepEqual(choicesOf({ allow_session: false }), ['deny', 'once'])
  assert.deepEqual(choicesOf({ smart_denied: true, allow_session: true, allow_permanent: true }), ['deny', 'once'])
  assert.deepEqual(choicesOf(null), ['deny'], 'nothing known: only the safe answer')
  assert.deepEqual(choicesOf('x'), ['deny'])
})

test('risk classes: refusing is safe, every answer that lets the command run is final, only a refusal skips the confirmation', () => {
  assert.deepEqual({ ...CHOICE_RISK }, { deny: 'safe', once: 'final', session: 'final', always: 'final' })
  assert.equal(choiceRisk('deny'), 'safe')
  for (const c of ['once', 'session', 'always']) assert.equal(choiceRisk(c), 'final', c)
  assert.equal(choiceRisk('whatever'), 'final', 'an unknown choice is never « safe »')
  assert.equal(choiceConfirms('deny'), false)
  for (const c of ['once', 'session', 'always']) assert.equal(choiceConfirms(c), true, c)
  assert.equal(riskOf({ verb: 'approval', choice: 'deny' }), 'safe')
  assert.equal(riskOf({ verb: 'approval', choice: 'always' }), 'final')
  assert.equal(riskOf({ verb: 'unblock' }), 'final')
  assert.ok(!WRITE_VERBS.includes('approval'), 'an approval is not an agent-half capability')
  assert.deepEqual(offeredWrites({ present: true, capabilities: ['approval', 'unblock'] }), ['unblock'])
})

test('contract: the real `approval.pending` row (measured on tools/approval.py) has no `choices`; the page derives all four from the allow flags', () => {
  const REAL_ROW = {
    allow_permanent: true, allow_session: true, command: 'rm -rf /tmp/oc-demo-never-run', description: 'recursive delete', pattern_key: 'recursive_delete',
    pattern_keys: ['recursive_delete'], request_id: 'r-real', timeout_s: 600
  }
  assert.deepEqual(Object.keys(REAL_ROW).sort(), ['allow_permanent', 'allow_session', 'command', 'description', 'pattern_key', 'pattern_keys', 'request_id', 'timeout_s'])
  const r = normalizeRequest(REAL_ROW, { sessionId: 's', nowMs: 5 })
  assert.deepEqual(r.choices, ['deny', 'once', 'session', 'always'])
  assert.equal(r.requestId, 'r-real')
  assert.equal(r.summary, 'recursive delete')
  assert.doesNotMatch(JSON.stringify(r), /rm -rf|oc-demo/)
})

test('privacy: a request keeps the summary, never the command; summary is one bounded line', () => {
  assert.equal(REQ.summary, 'recursive delete')
  assert.doesNotMatch(JSON.stringify(REQ), /rm -rf|SECRET_TOKEN|abc123|\/tmp/)
  assert.ok(!('command' in REQ) && !('pattern_key' in REQ))
  const long = normalizeRequest({ request_id: 'x', description: `line one\n\tline\u0000two ${'y'.repeat(400)}` }, { sessionId: 's', nowMs: 1 })
  assert.equal(long.summary.length, DESCRIPTION_MAX)
  assert.doesNotMatch(long.summary, /[\n\t\u0000]/)
  assert.equal(normalizeRequest({ request_id: 'x' }, { sessionId: 's', nowMs: 1 }).summary, '')
  assert.equal(normalizeRequest({ description: 'no id' }, { sessionId: 's' }), null)
  assert.equal(normalizeRequest({ request_id: 'x' }, { sessionId: '' }), null)
  assert.equal(normalizeRequest(null, { sessionId: 's' }), null)
  // the canonical protocol names the id `prompt_id` (and copies it to request_id)
  assert.equal(normalizeRequest({ prompt_id: 'p-9' }, { sessionId: 's' }).requestId, 'p-9')
  // a unit request's target never carries the command
  assert.doesNotMatch(JSON.stringify(approvalTarget(REQ, 'oid', 'deny')), /rm -rf|SECRET/)
})

test('store: received / settled / snapshot keep the list true (a read is the truth for its session)', () => {
  let s = emptyApprovals()
  s = approvalsReducer(s, { type: 'received', raw: PENDING_ROW, sessionId: 'sess-A', profile: 'oc-test-one', nowMs: T0 })
  s = approvalsReducer(s, { type: 'received', raw: { request_id: 'req-2', description: 'kill process' }, sessionId: 'sess-B', profile: 'oc-test-b', nowMs: T0 + 5000 })
  assert.deepEqual(pendingView(s, T0 + 9000).map(r => r.key), ['sess-A/req-1', 'sess-B/req-2'], 'longest waiting first')
  assert.equal(pendingView(s, T0 + 9000)[0].ageMs, 9000)
  // the same request again keeps the first time it was seen (its age does not reset)
  const again = approvalsReducer(s, { type: 'received', raw: PENDING_ROW, sessionId: 'sess-A', profile: '', nowMs: T0 + 60_000 })
  assert.equal(again.byKey['sess-A/req-1'].firstSeenMs, T0)
  assert.equal(again.byKey['sess-A/req-1'].profile, 'oc-test-one', 'an empty profile does not erase a known one')
  // settled elsewhere
  assert.equal(Object.keys(approvalsReducer(s, { type: 'settled', sessionId: 'sess-A', requestId: 'req-1' }).byKey).length, 1)
  assert.equal(approvalsReducer(s, { type: 'settled', sessionId: 'sess-A', requestId: 'nope' }), s, 'an unknown id changes nothing')
  // a read of sess-A that lists nothing: req-1 is gone, sess-B untouched
  const empty = approvalsReducer(s, { type: 'snapshot', sessionId: 'sess-A', rows: [], nowMs: T0 + 1 })
  assert.deepEqual(Object.keys(empty.byKey), ['sess-B/req-2'])
  // a read that lists a request the page never saw adds it
  const added = approvalsReducer(empty, { type: 'snapshot', sessionId: 'sess-C', rows: [{ request_id: 'req-3', description: 'chmod' }], nowMs: T0 + 2 })
  assert.deepEqual(Object.keys(added.byKey).sort(), ['sess-B/req-2', 'sess-C/req-3'])
  // a failed read keeps the requests, flagged; a vanished session drops them
  const flagged = approvalsReducer(s, { type: 'unreadable', sessionId: 'sess-A', gone: false })
  assert.equal(Object.keys(flagged.byKey).length, 2)
  assert.equal(pendingView(flagged, T0).find(r => r.sessionId === 'sess-A').unverified, true)
  assert.equal(pendingView(flagged, T0).find(r => r.sessionId === 'sess-B').unverified, false)
  assert.equal(pendingView(approvalsReducer(flagged, { type: 'snapshot', sessionId: 'sess-A', rows: [PENDING_ROW], nowMs: T0 }), T0)[0].unverified, false, 'a good read clears the flag')
  assert.deepEqual(Object.keys(approvalsReducer(s, { type: 'unreadable', sessionId: 'sess-A', gone: true }).byKey), ['sess-B/req-2'])
  // titles (runtime session id -> title) from the live list; blank titles are dropped
  const titled = approvalsReducer(s, { type: 'titles', titles: { 'sess-A': '  Fix the build ', 'sess-B': '   ', 'sess-C': 7 } })
  assert.equal(pendingView(titled, T0)[0].title, 'Fix the build')
  assert.equal(pendingView(titled, T0)[1].title, '')
  assert.equal(approvalsReducer(s, { type: 'bogus' }), s)
})

test('store: bounded (requests and sessions read), no input can make it grow without limit', () => {
  let s = emptyApprovals()
  for (let i = 0; i < REQUESTS_MAX + 20; i++) s = approvalsReducer(s, { type: 'received', raw: { request_id: `r${i}` }, sessionId: 'sx', nowMs: T0 + i })
  assert.equal(Object.keys(s.byKey).length, REQUESTS_MAX)
  assert.ok(s.byKey[`sx/r${REQUESTS_MAX + 19}`], 'the newest are kept')
  const live = Array.from({ length: 40 }, (_, i) => `live-${i}`)
  assert.equal(sessionsToRead(emptyApprovals(), live).length, SESSIONS_MAX)
  const held = approvalsReducer(emptyApprovals(), { type: 'received', raw: PENDING_ROW, sessionId: 'sess-A', nowMs: 1 })
  const heldBy = approvalsReducer(emptyApprovals(), { type: 'received', raw: PENDING_ROW, sessionId: 'sess-A', profile: 'oc-test-one', nowMs: 1 })
  assert.deepEqual(sessionsToRead(heldBy, ['live-1', 'sess-A', '', 7]), [{ sessionId: 'sess-A', profile: 'oc-test-one' }, { sessionId: 'live-1', profile: '' }], 'sessions that hold a request are read first, once, with their profile')
  assert.equal(sessionsToRead(held, []).length, 1)
  // a gateway that serves several profiles routes `approval.*` by profile (the app's own card sends it): sent when known, absent otherwise
  assert.deepEqual(withProfile({ session_id: 's' }, 'oc-test-one'), { session_id: 's', profile: 'oc-test-one' })
  assert.deepEqual(withProfile({ session_id: 's' }, ''), { session_id: 's' })
})

test('RPC shapes: session.active_list keeps id and title only; approval.respond -> resolved n; failures are named, a lost answer is unknown', () => {
  const list = readLiveSessions({ sessions: [{ id: 'a', title: 'T', status: 'waiting', preview: 'SECRET PREVIEW', model: 'm', session_key: 'k' }, { id: 'b', status: 'working' }, { id: '', title: 'x' }, { title: 'no id' }, null] })
  assert.deepEqual(list, { ids: ['a', 'b'], waiting: ['a'], titles: { a: 'T' } }, 'only sessions parked on a prompt are asked for their queue')
  assert.doesNotMatch(JSON.stringify(list), /SECRET|session_key/)
  assert.deepEqual(readLiveSessions(null), { ids: [], waiting: [], titles: {} })
  assert.deepEqual(readRespond({ ok: true, data: { resolved: 1 } }), { ok: true, result: 'done', reason: null })
  assert.deepEqual(readRespond({ ok: true, data: { resolved: 0 } }), { ok: false, result: 'refused', reason: 'already_settled' })
  assert.equal(readRespond({ ok: true, data: {} }), null, 'no number, no guess')
  assert.equal(readRespond({ ok: true, data: { resolved: '1' } }), null)
  assert.equal(readRespond({ ok: false, reason: 'unavailable' }).reason, 'unreachable')
  assert.equal(readRespond({ ok: false, reason: 'failed', error: new Error('Prompt is stale or unavailable; reconnect before responding') }).reason, 'stale')
  assert.equal(readRespond({ ok: false, reason: 'failed', error: new Error('session not found (4001)') }).reason, 'stale')
  assert.equal(readRespond({ ok: false, reason: 'failed', error: new Error('socket closed') }), null, 'a dropped socket may have delivered the answer: unknown outcome')
  assert.equal(sessionGone(new Error('session not found')), true)
  assert.equal(sessionGone(new Error('timeout')), false)
  assert.equal(sessionGone(undefined), false)
})

/* ---------- the order machine for an approval ---------- */

const ask = choice => ({ type: 'request', order: approvalTarget(REQ, `oid-${choice}`, choice), now: T0 })
const answered = { type: 'answered', answer: { ok: true, result: 'done', reason: null, before: null, after: null, comments: null, replayed: false, audited: true, atMs: null } }

test('deny: no confirmation, straight to the 6 s window; it can be cancelled with nothing sent', () => {
  let s = run(initialOrderState(), ask('deny'))
  assert.equal(s.phase, 'counting')
  assert.equal(s.left, UNDO_SECONDS)
  assert.equal(s.sendAt, T0 + 6000)
  assert.equal(isBusy(s), true)
  s = run(s, { type: 'tick', now: T0 + 3000 })
  assert.equal(s.left, 3)
  s = run(s, { type: 'cancel' })
  assert.equal(s.phase, 'idle')
  assert.equal(s.outcome.cancelled, true)
  assert.equal(s.outcome.wasCounting, true)
  assert.equal(s.outcome.verb, 'approval')
  assert.equal(s.outcome.choice, 'deny')
  assert.equal(s.outcome.agent, 'oc-test-one')
})

test('once / session / always: confirmation first (nothing counting), then 6 s, then the departure', () => {
  for (const c of ['once', 'session', 'always']) {
    let s = run(initialOrderState(), ask(c))
    assert.equal(s.phase, 'confirm', c)
    assert.equal(s.sendAt, null, `${c}: nothing is counting before the confirmation`)
    assert.equal(riskOf(s.order), 'final')
    // cancel from the confirmation: nothing counted, nothing sent
    assert.equal(run(s, { type: 'back' }).phase, 'idle', `${c}: back`)
    s = run(s, { type: 'confirm', now: T0 + 100 })
    assert.equal(s.phase, 'counting', c)
    assert.equal(s.sendAt, T0 + 100 + 6000)
    s = run(s, { type: 'tick', now: T0 + 100 + 6000 })
    assert.equal(s.phase, 'sending', `${c}: the window ran out`)
  }
})

test('one order at a time: a second order (approval or not) is refused while one counts, sends or verifies', () => {
  const first = run(initialOrderState(), ask('deny'))
  const refused = run(first, { type: 'request', order: approvalTarget(REQ, 'oid-2', 'once'), now: T0 + 10 })
  assert.equal(refused.notice, 'busy')
  assert.equal(refused.order.id, 'oid-deny', 'the first order is untouched')
  assert.equal(refused.phase, 'counting')
  assert.equal(run(first, { type: 'request', order: { id: 'u', verb: 'unblock', board: 'b', task: 't_00000000', code: 'X' }, now: T0 }).notice, 'busy')
  for (const phase of ['sending', 'verifying']) {
    let s = run(first, { type: 'tick', now: T0 + 6000 })
    if (phase === 'verifying') s = run(s, answered)
    assert.equal(s.phase, phase)
    assert.equal(run(s, ask('once')).notice, 'busy', phase)
  }
  // an unknown choice never becomes an order
  assert.equal(run(initialOrderState(), { type: 'request', order: { ...approvalTarget(REQ, 'o', 'deny'), choice: 'rm' }, now: T0 }).notice, 'not_an_order')
  assert.equal(run(initialOrderState(), { type: 'request', order: { ...approvalTarget(REQ, 'o', 'deny'), choice: undefined }, now: T0 }).notice, 'not_an_order')
})

test('read back: done only when the request is gone from approval.pending; still listed = failed; unreadable = done but unverified', () => {
  const upToRead = c => run(initialOrderState(), ask(c), ...(choiceConfirms(c) ? [{ type: 'confirm', now: T0 }] : []), { type: 'tick', now: T0 + 6000 }, answered)
  for (const c of CHOICES) {
    const v = upToRead(c)
    assert.equal(v.phase, 'verifying', c)
    assert.equal(v.outcome, null, `${c}: nothing is displayed before the read`)
    const gone = run(v, { type: 'read', liveOk: true, gone: true })
    assert.equal(gone.phase, 'done')
    assert.equal(gone.outcome.ok, true)
    assert.equal(gone.outcome.gone, true)
    assert.equal(gone.outcome.choice, c)
    assert.equal(gone.outcome.reason, null)
    const stuck = run(v, { type: 'read', liveOk: true, gone: false })
    assert.equal(stuck.outcome.ok, false, `${c}: still pending is not « done »`)
    assert.equal(stuck.outcome.reason, 'still_pending')
    assert.equal(stuck.outcome.gone, false)
    const blind = run(v, { type: 'read', liveOk: true, gone: null })
    assert.equal(blind.outcome.ok, true)
    assert.equal(blind.outcome.gone, null, 'the page says it could not re-read')
  }
  // the rule is about approvals: another order is not turned into « still pending » by a stray `gone`
  const unblock = run(initialOrderState(), { type: 'request', order: { id: 'u', verb: 'unblock', board: 'b', task: 't_00000000', code: 'X' }, now: T0 }, { type: 'confirm', now: T0 }, { type: 'tick', now: T0 + 6000 }, answered)
  assert.equal(run(unblock, { type: 'read', liveOk: true, gone: false }).outcome.ok, true)
  assert.equal(run(unblock, { type: 'read', liveOk: true }).outcome.gone, null)
})

test('failures are said: already settled (resolved 0), stale window, lost answer; none of them is shown as done', () => {
  const sending = run(initialOrderState(), ask('deny'), { type: 'tick', now: T0 + 6000 })
  const settled = run(sending, { type: 'answered', answer: { ...answered.answer, ok: false, result: 'refused', reason: 'already_settled' } }, { type: 'read', liveOk: true, gone: true })
  assert.equal(settled.outcome.ok, false)
  assert.equal(settled.outcome.reason, 'already_settled')
  const lost = run(sending, { type: 'failed', reason: 'unknown_outcome' }, { type: 'read', liveOk: true, gone: null })
  assert.equal(lost.outcome.ok, false)
  assert.equal(lost.outcome.reason, 'unknown_outcome')
  const stale = run(sending, { type: 'failed', reason: 'stale' }, { type: 'read', liveOk: true, gone: false })
  assert.equal(stale.outcome.reason, 'stale', 'a failed answer keeps its own reason')
  for (const r of ['already_settled', 'stale', 'still_pending']) assert.ok(REASONS.includes(r), r)
})

/* ---------- audit and journal ---------- */

test('audit: closed fields, risk from the choice, never the command, the summary or a title', () => {
  const order = approvalTarget({ ...REQ, title: 'Fix the build' }, 'b3b1c8d2-0000-4000-8000-000000000001', 'deny')
  const b = auditBody(order, { result: 'done', reason: null })
  assert.deepEqual(b, { id: 'b3b1c8d2-0000-4000-8000-000000000001', verb: 'approval', risk: 'safe', result: 'done', choice: 'deny' })
  assert.doesNotMatch(JSON.stringify(b), /rm -rf|recursive|Fix the build|oc-test|sess-A|req-1/)
  assert.equal(auditBody({ ...order, choice: 'always' }, { result: 'done' }).risk, 'final')
  assert.equal(auditBody(order, { result: 'refused', reason: 'already_settled' }).reason, 'already_settled')
  assert.equal(auditBody(order, { result: 'refused', reason: 'Bad Reason!' }).reason, undefined, 'a reason outside the stable-code shape is dropped')
  assert.equal(auditBody(order, null).result, 'failed')
  for (const k of Object.keys(auditBody(order, { result: 'done' }))) assert.ok(['id', 'verb', 'risk', 'result', 'reason', 'choice'].includes(k), k)
  // the journal shows an approval line with its choice and no board/card
  const j = toJournal({ ok: true, entries: [{ ts: 100, id: 'x', verb: 'approval', risk: 'final', result: 'done', choice: 'once', source: 'page', command: 'rm -rf /' }, { ts: 90, id: 'y', verb: 'approval', result: 'done', choice: 'evil' }] })
  assert.equal(j.entries[0].choice, 'once')
  assert.equal(j.entries[1].choice, null)
  assert.doesNotMatch(JSON.stringify(j), /rm -rf/)
})

/* ---------- source guards and i18n ---------- */

test('source: approvals never read the command; one timer-free poll >= 5 s with every flag off; the events are tapped by register()', () => {
  const data = readFileSync(new URL('../../src/data/approvals.js', import.meta.url), 'utf8')
  const core = readFileSync(new URL('../../src/core/approvals.js', import.meta.url), 'utf8')
  const ui = readFileSync(new URL('../../src/ui/Approvals.jsx', import.meta.url), 'utf8')
  for (const src of [data, ui]) {
    assert.doesNotMatch(src, /setInterval/)
    assert.doesNotMatch(src, /console\./)
    assert.doesNotMatch(src, /localStorage|sessionStorage|ctx\.storage/)
  }
  assert.doesNotMatch(ui, /\.command\b|\bcommand=|\{command\}/, 'the row never shows the command')
  assert.doesNotMatch(data, /\.command\b/)
  assert.doesNotMatch(core.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /raw\.command|\.command\b/, 'the command is never read, so it cannot be kept')
  const block = data.split('useQuery({')[1].split('\n  })')[0]
  assert.match(block, /refetchIntervalInBackground: false/)
  assert.match(block, /refetchOnReconnect: false/)
  const ms = Number((data.match(/APPROVALS_POLL_MS = ([\d_]+)/) || [, 'NaN'])[1].replace(/_/g, ''))
  assert.ok(ms >= 5000, `approvals poll ${ms}`)
  assert.match(data, /ctx\.onEvent\('approval\.request'/)
  assert.match(data, /ctx\.onEvent\('approval\.settled'/)
  assert.match(readFileSync(new URL('../../src/index.jsx', import.meta.url), 'utf8'), /initApprovals\(ctx\)/)
  // the hook that departs: refusal and the others both go through the host with the strict triple, once per order id
  assert.match(data, /safeRequest\('approval\.respond', withProfile\(\{ session_id: order\.sessionId, request_id: order\.requestId, choice: order\.choice \}, order\.agent\)\)/)
  assert.match(data, /safeRequest\('approval\.pending', withProfile\(\{ session_id: sessionId \}, profile\)\)/)
  const orders = readFileSync(new URL('../../src/data/orders.js', import.meta.url), 'utf8')
  assert.match(orders, /isGone\(order\)/, 'an approval is re-read from its own queue')
})

test('i18n: every choice has its label, explanation, confirmation effect and result line, in EN, FR and ES; risk words differ by class', () => {
  for (const lang of ['en', 'fr', 'es']) {
    const a = messages[lang].approvals
    for (const c of CHOICES) {
      assert.ok(typeof a.choice[c] === 'string' && a.choice[c].length >= 5, `${lang} choice.${c}`)
      for (const k of ['explain', 'effect']) assert.ok(typeof a[k][c] === 'string' && a[k][c].length > 8, `${lang} ${k}.${c}`)
      assert.match(a.done[c]('X'), /X/, `${lang} done.${c} names the target`)
    }
    for (const r of ['already_settled', 'stale', 'still_pending']) assert.ok(messages[lang].orders.reason[r].length > 20, `${lang} reason ${r}`)
    for (const k of ['verb', 'untitled', 'noSummary', 'unverified', 'commandNote', 'target', 'notReread']) assert.ok(a[k], `${lang} ${k}`)
    assert.match(a.asked('X'), /X/)
    assert.match(a.choicesLabel('X'), /X/)
    assert.notEqual(messages[lang].orders.risk[choiceRisk('deny')], messages[lang].orders.risk[choiceRisk('always')])
  }
  // the permanent choice says it is permanent, in every language
  assert.match(messages.en.approvals.effect.always, /permanent/i)
  assert.match(messages.fr.approvals.effect.always, /permanente/i)
  assert.match(messages.es.approvals.effect.always, /permanente/i)
})
}

// ===== approvals =====
{
// guard: the order is « done » only when `approval.pending` no longer lists the
// request, and a lost `approval.respond` answer is an unknown outcome, never an answered order.

// data/approvals.js imports the host SDK and react, which do not exist under node: stand-ins (`host.request` is driven by the test).
const STUB = 'export const host = { request: (m, p) => globalThis.__ocHost(m, p) }; export const useQuery = () => ({}); export const useQueryClient = () => null'
const REACT = 'export const useEffect = () => {}; export const useState = v => [v, () => {}]'
const url = src => `data:text/javascript,${encodeURIComponent(src)}`
register(url(`const M = { '@hermes/plugin-sdk': ${JSON.stringify(url(STUB))}, react: ${JSON.stringify(url(REACT))} }
export async function resolve(s, c, next) { return M[s] ? { url: M[s], shortCircuit: true } : next(s, c) }`))
const { isGone, resetApprovals, sendApproval } = await import('../../src/data/approvals.js')
const { CHOICES, answerReread } = await import('../../src/core/approvals.js')
const { messages } = await import('../../src/i18n/index.js')
const { readFileSync } = await import('node:fs')

test('« no longer pending (read back) » is said only when the re-read saw the request gone, never after a failed re-read', () => {
  assert.equal(answerReread({ ok: true, gone: true }), true)
  assert.equal(answerReread({ ok: true, gone: null }), false, 'a failed re-read is not a read-back')
  assert.equal(answerReread({ ok: true }), false)
  const READ_BACK = { en: /read back\)/, fr: /\(relu\)/, es: /\(releído\)/ }
  for (const lang of ['en', 'fr', 'es']) {
    const a = messages[lang].approvals
    for (const c of CHOICES) assert.match(a.done[c]('X'), READ_BACK[lang], `${lang} done.${c} claims the read-back`)
    const line = a.notReread(a.choice.deny, 'agent · T')
    assert.match(line, /agent · T/)
    assert.ok(line.includes(a.choice.deny), `${lang}: names the answer Hermes accepted`)
    assert.doesNotMatch(line, READ_BACK[lang], `${lang}: an unread outcome never claims the read-back`)
  }
  // the outcome line of the box picks between the two by this rule (Orders.jsx is JSX: not importable under node)
  const ui = readFileSync(new URL('../../src/ui/Orders.jsx', import.meta.url), 'utf8')
  assert.match(ui, /answerReread\(o\) \? t\(`approvals\.done\.\$\{o\.choice\}`/)
})

const ORDER = { id: 'o1', verb: 'approval', choice: 'deny', sessionId: 'sess-A', requestId: 'req-1', agent: 'oc-test-two', title: 'T', code: 'T' }
const calls = []
const answer = map => { calls.length = 0; globalThis.__ocHost = async (m, p) => { calls.push({ m, p }); const v = map[m]; if (v instanceof Error) throw v; return v } }

test('re-read after an answer: gone only when the queue no longer lists the request; still listed = false; unreadable = null', async () => {
  resetApprovals()
  answer({ 'approval.pending': { approvals: [{ request_id: 'other' }] } })
  assert.equal(await isGone(ORDER), true)
  assert.deepEqual(calls, [{ m: 'approval.pending', p: { session_id: 'sess-A', profile: 'oc-test-two' } }])
  answer({ 'approval.pending': { approvals: [{ request_id: 'req-1', description: 'x' }] } })
  assert.equal(await isGone(ORDER), false, 'still listed is not gone')
  answer({ 'approval.pending': new Error('socket closed') })
  assert.equal(await isGone(ORDER), null, 'a failed re-read is « could not read », not gone')
})

test('departure: strict params, resolved n read, a lost answer is unknown_outcome, the journal only when served', async () => {
  answer({ 'approval.respond': { resolved: 1 } })
  let act = await sendApproval({}, ORDER, false)
  assert.deepEqual(calls, [{ m: 'approval.respond', p: { session_id: 'sess-A', request_id: 'req-1', choice: 'deny', profile: 'oc-test-two' } }])
  assert.equal(act.type, 'answered')
  assert.equal(act.answer.ok, true)
  assert.equal(act.answer.audited, true, 'no journal served: nothing to report as missing')
  answer({ 'approval.respond': { resolved: 0 } })
  act = await sendApproval({}, ORDER, false)
  assert.deepEqual([act.type, act.answer.ok, act.answer.reason], ['answered', false, 'already_settled'])
  for (const lost of [new Error('socket closed'), {}]) {
    answer({ 'approval.respond': lost })
    assert.deepEqual(await sendApproval({}, ORDER, false), { type: 'failed', reason: 'unknown_outcome' }, 'a lost answer is never « answered »')
  }
  answer({ 'approval.respond': { resolved: 1 } })
  const posted = []
  act = await sendApproval({ rest: async (path, opts) => { posted.push({ path, body: opts.body }); return { ok: true } } }, ORDER, true)
  assert.equal(act.answer.audited, true)
  assert.deepEqual(posted, [{ path: '/audit', body: { id: 'o1', verb: 'approval', risk: 'safe', result: 'done', choice: 'deny' } }])
  act = await sendApproval({ rest: async () => { throw new Error('500') } }, ORDER, true)
  assert.equal(act.answer.audited, false, 'a journal that failed is said')
})
}

// ===== approvals =====
{
// Wiring: sendApproval writes the journal line with the request id only for a request the page had listed as pending,
// and falls back to the older body when the agent half refuses the new field (422).
const STUB = 'export const host = { request: (m, p) => globalThis.__ocHost(m, p) }; export const useQuery = () => ({}); export const useQueryClient = () => null'
const REACT = 'export const useEffect = () => {}; export const useState = v => [v, () => {}]'
const url = src => `data:text/javascript,${encodeURIComponent(src)}`
register(url(`const M = { '@hermes/plugin-sdk': ${JSON.stringify(url(STUB))}, react: ${JSON.stringify(url(REACT))} }
export async function resolve(s, c, next) { return M[s] ? { url: M[s], shortCircuit: true } : next(s, c) }`))
const { dispatchApprovals, resetApprovals, sendApproval } = await import('../../src/data/approvals.js')

const REQ = '0123456789abcdef0123456789abcdef'
const order = { id: 'order-1', verb: 'approval', choice: 'deny', sessionId: 'sess-A', requestId: REQ, agent: 'oc-test', title: 'T', code: 'T' }
const hermes = resolved => { globalThis.__ocHost = async () => ({ resolved }) }
const pend = () => dispatchApprovals({ type: 'received', raw: { request_id: REQ, description: 'x' }, sessionId: 'sess-A', profile: 'oc-test', nowMs: 1 })
const journal = (reply = async () => ({ ok: true })) => { const posted = []; return { posted, ctx: { rest: async (path, opts) => { posted.push(opts.body); return reply(opts.body) } } } }

test('a refusal of a request the page saw pending is journaled with its request id', async () => {
  resetApprovals(); pend(); hermes(1)
  const j = journal()
  const act = await sendApproval(j.ctx, order, true)
  assert.equal(act.answer.audited, true)
  assert.deepEqual(j.posted, [{ id: 'order-1', verb: 'approval', risk: 'safe', result: 'done', choice: 'deny', request: REQ }])
})
test('a request the page never listed is journaled without it (so it never unlocks « Guardian »)', async () => {
  resetApprovals(); hermes(1)
  const j = journal()
  await sendApproval(j.ctx, order, true)
  assert.equal('request' in j.posted[0], false)
})
test('an older agent half (422 on the new field) still gets the line, without the field', async () => {
  resetApprovals(); pend(); hermes(1)
  const j = journal(async body => { if ('request' in body) throw Object.assign(new Error('422'), { status: 422 }); return { ok: true } })
  const act = await sendApproval(j.ctx, order, true)
  assert.equal(act.answer.audited, true, 'the line was written')
  assert.deepEqual(j.posted.map(b => 'request' in b), [true, false])
})
test('any other failure is not retried and is said (not audited)', async () => {
  resetApprovals(); pend(); hermes(1)
  const j = journal(async () => { throw Object.assign(new Error('500'), { status: 500 }) })
  const act = await sendApproval(j.ctx, order, true)
  assert.equal(act.answer.audited, false)
  assert.equal(j.posted.length, 1)
})
}
