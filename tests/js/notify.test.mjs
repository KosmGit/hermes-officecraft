import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { LEGACY_TYPES, NOTIFY_TYPES, changeBody, needsTarget, toNotify, typesWithoutRoute, TEST_WAIT_S, cooldownUntil, hourChoices, inQuiet, passesMidnight, previewOf, previewPieces, previewPlatform, quietSentence, readTestError, sameForAll, sharedRoute, testState, testView, toggleRoute, trophyPayload } from '../../src/core/notify.js'
import { translate } from '../../src/core/translate.js'
import { messages } from '../../src/i18n/index.js'
import { register } from 'node:module'

// ===== notify =====
{
// The notification settings of the page. Pure shape (src/core/notify.js), the i18n block (prefix `notify.`, three
// languages), and the contract that the form only ever talks to the server: nothing about notifications in ctx.storage,
// no recipient typed by hand, no chat id kept.
const src = rel => readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), 'utf8')

const A = 'telegram#aaaaaaaa'
const B = 'discord#bbbbbbbb'
const target = (key, platform = 'telegram') => ({ key, platform, label: '…1234', source: 'cron' })
// what the agent half serves (hermes_officecraft/notify.py)
const served = ({ types = {}, routes = {}, quiet, targets = [target(A)] } = {}) => ({
  ok: true,
  settings: { types, routes, quiet, lang: 'en', target: null },
  targets,
  hourlyCap: 6,
  maxRoutes: 4,
  timezone: { name: 'CET', offset: '+01:00' },
  last: null,
  lastBy: {}
})
// what an older agent half served (one `target`, no `routes`, no `quiet`, four types)
const old = (types = {}, target_ = null) => ({ ok: true, settings: { types, target: target_, lang: 'en' }, targets: [target(A)], hourlyCap: 6, last: null })

test('the eight types, all OFF unless the server said true', () => {
  assert.deepEqual([...NOTIFY_TYPES], ['decision', 'silent', 'gateway', 'cron', 'campaign', 'review', 'llm_cap', 'trophy'])
  assert.deepEqual([...LEGACY_TYPES], ['decision', 'silent', 'gateway', 'cron'])
  const off = toNotify(served())
  assert.deepEqual(off.types, Object.fromEntries(NOTIFY_TYPES.map(t => [t, false])))
  assert.equal(toNotify(served({ types: { decision: 'yes', silent: 1, gateway: true, trophy: true } })).types.decision, false)
  const on = toNotify(served({ types: { gateway: true, trophy: true } }))
  assert.equal(on.types.gateway, true)
  assert.equal(on.types.trophy, true)
})

test('a recipient the server does not list is not shown as chosen; a failed read gives null, not defaults', () => {
  const one = toNotify(served({ routes: { decision: [B, A] } }))
  assert.deepEqual(one.routes.decision, [A], 'B is not a known recipient')
  assert.deepEqual(one.routes.cron, [], 'a type with no route says so')
  for (const bad of [null, undefined, {}, { ok: false }, { ok: true }]) assert.equal(toNotify(bad), null)
})

test('the display of the OLD settings (one `target`, four types, no routes, no quiet hours) is what the agent half migrates them to', () => {
  // two historic types on: the recipient is theirs and only theirs
  const some = toNotify(old({ decision: true, cron: true }, A))
  assert.equal(some.modern, false)
  assert.deepEqual(some.routes, { decision: [A], silent: [], gateway: [], cron: [A], campaign: [], review: [], llm_cap: [], trophy: [] })
  // none on: the four historic types get it, nothing is lost
  const none = toNotify(old({}, A))
  assert.deepEqual(LEGACY_TYPES.map(t => none.routes[t]), [[A], [A], [A], [A]])
  assert.deepEqual(['campaign', 'review', 'llm_cap', 'trophy'].map(t => none.routes[t]), [[], [], [], []])
  // a recipient Hermes no longer lists is not shown
  assert.deepEqual(toNotify(old({ decision: true }, B)).routes.decision, [])
  // the four new types are off, the quiet hours too, with the default range
  assert.deepEqual(some.quiet, { enabled: false, from: '22:00', to: '07:00', urgent: [] })
  assert.equal(some.types.campaign, false)
  // and what a first save posts is the whole new board (the migration is written only then)
  const body = changeBody(some, { types: { silent: true } }, 'fr')
  assert.deepEqual(body.routes.decision, [A])
  assert.equal(body.types.silent, true)
  assert.equal('target' in body, false, 'the old field is never posted again')
})

test('a change posts the whole board (types, routes, quiet hours), the page language, and never a raw chat id', () => {
  const cur = toNotify(served({ types: { decision: true }, routes: { decision: [A] } }))
  const body = changeBody(cur, { types: { cron: true } }, 'fr')
  assert.deepEqual(Object.keys(body).sort(), ['lang', 'quiet', 'routes', 'types'])
  assert.deepEqual(body.types, { decision: true, silent: false, gateway: false, cron: true, campaign: false, review: false, llm_cap: false, trophy: false })
  assert.deepEqual(body.routes.decision, [A])
  assert.equal(body.lang, 'fr')
  assert.equal(changeBody(cur, {}, 'de').lang, 'en')
  assert.match(JSON.stringify(body), /^[^]*telegram#aaaaaaaa[^]*$/)
  assert.doesNotMatch(JSON.stringify(body), /chat|[0-9]{8,}/)
})

test('a type on with nobody to send to is said, not left looking active', () => {
  assert.equal(needsTarget(toNotify(served())), false)
  const lonely = toNotify(served({ types: { decision: true, trophy: true }, routes: { trophy: [A] } }))
  assert.equal(needsTarget(lonely), true)
  assert.deepEqual(typesWithoutRoute(lonely), ['decision'], 'only the type that has nobody')
  assert.equal(needsTarget(toNotify(served({ types: { decision: true }, routes: { decision: [A] } }))), false)
})

test('every notify.* string exists in en, fr and es, and the interpolators render', () => {
  const keys = ['title', 'types', 'recipients', 'sameForAll', 'sameForAllHint', 'mixed', 'noneChosen', 'noTarget', 'noRoute', 'oneRecipient', 'addApp', 'addAppNote',
    'test', 'testing', 'saveFailed', 'unknownTarget', 'unavailable', 'tested.unknown_target', 'tested.platform_not_connected', 'tested.send_failed',
    'tested.daily_limit', 'tested.notify_unavailable', 'tested.failed', 'quiet.title', 'quiet.on', 'quiet.onHint', 'quiet.start', 'quiet.end', 'quiet.range', 'quiet.urgent',
    'quiet.urgentHint', 'quiet.empty', 'preview.title', 'preview.empty', 'preview.summary', 'preview.note',
    ...['mark', 'board', 'decision', 'silent', 'cron', 'campaign', 'review', 'trophy'].map(k => `sample.${k}`),
    ...NOTIFY_TYPES.flatMap(t => [`type.${t}`, `typeHint.${t}`])]
  for (const lang of ['en', 'fr', 'es']) {
    for (const k of keys) assert.ok(translate(messages, lang, `notify.${k}`) !== `notify.${k}`, `${lang} notify.${k}`)
    assert.match(translate(messages, lang, 'notify.hint', [6]), /6/)
    assert.match(translate(messages, lang, 'notify.last', [true, 2]), /2/)
    assert.match(translate(messages, lang, 'notify.targetLabel', ['telegram', '…1234']), /telegram/)
    assert.match(translate(messages, lang, 'notify.testFor', ['telegram …1234']), /telegram/)
    assert.match(translate(messages, lang, 'notify.maxRoutes', [4]), /4/)
    assert.match(translate(messages, lang, 'notify.tested.sent', ['14:05']), /14:05/)
    assert.match(translate(messages, lang, 'notify.quiet.clock', ['CET +01:00']), /CET/)
    // one word per thing: a type is named in a couple of words, never a sentence
    for (const type of NOTIFY_TYPES) assert.ok(translate(messages, lang, `notify.type.${type}`).split(/\s+/).length <= 3, `${lang} type ${type}`)
  }
})

test('the form talks to the server only (no storage, no typed recipient, no chat id kept)', () => {
  const form = src('ui/SettingsFormNotify.jsx')
  const data = src('data/notify.js')
  assert.doesNotMatch(form + data, /storage/i)
  assert.doesNotMatch(form, /type="text"|<textarea|contentEditable/, 'the recipient is chosen among those Hermes knows, never typed')
  assert.match(form, /<select id=\{id\} className="oc-fc" data-notify-all/)
  assert.match(form, /type="checkbox"/, 'the recipients of a type are real checkboxes')
  // the switches are the Switch of SettingsKit (a native checkbox with role=switch)
  assert.match(form, /<Switch /)
  assert.match(src('ui/SettingsKit.jsx'), /role="switch"/)
  assert.match(data, /'\/notify'/)
  assert.match(data, /'\/notify\/test'/)
  assert.match(data, /'\/notify\/trophy'/)
  assert.doesNotMatch(data, /setInterval|refetchInterval:/, 'no timer: nothing here changes by itself')
  assert.match(src('ui/SettingsForm.jsx'), /<SettingsFormNotify \/>/)
})
}

// ===== notify =====
{
// The recipients of each type, the quiet hours (a range over midnight), the preview, the states of the test button,
// the trophies the page reports. Pure (src/core/notify.js): no SDK, no DOM.
const A = 'telegram#aaaaaaaa'
const B = 'discord#bbbbbbbb'
const C = 'slack#cccccccc'
const D = 'email#dddddddd'
const E = 'signal#eeeeeeee'
const targets = [A, B, C, D, E].map(key => ({ key, platform: key.split('#')[0], label: '…1234', source: 'cron' }))
const state = (settings = {}) => toNotify({ ok: true, settings: { types: {}, routes: {}, lang: 'en', ...settings }, targets, hourlyCap: 6, maxRoutes: 4, timezone: { name: 'CET', offset: '+01:00' }, last: null, lastBy: {} })
const min = (h, m = 0) => h * 60 + m
const words = { mark: 'DEMO', board: 'demo', decision: 'Sample decision', silent: 'Sample silent card', cron: 'nightly-sample', campaign: 'Sample campaign', review: 'Sample review', trophy: 'Sample trophy' }

// ------------------------------------------------------------------ routes
test('routes: a recipient is added, removed, and never past the maximum (4)', () => {
  let s = state()
  const list = (type) => s.routes[type]
  s = { ...s, routes: { ...s.routes, cron: toggleRoute(s, 'cron', A) } }
  assert.deepEqual(list('cron'), [A])
  s = { ...s, routes: { ...s.routes, cron: toggleRoute(s, 'cron', B) } }
  s = { ...s, routes: { ...s.routes, cron: toggleRoute(s, 'cron', C) } }
  s = { ...s, routes: { ...s.routes, cron: toggleRoute(s, 'cron', D) } }
  assert.deepEqual(list('cron'), [A, B, C, D])
  assert.deepEqual(toggleRoute(s, 'cron', E), [A, B, C, D], 'a fifth is refused, the list is unchanged')
  assert.deepEqual(toggleRoute(s, 'cron', B), [A, C, D], 'a chosen one is removed')
  assert.deepEqual(s.routes.decision, [], 'the other types are untouched')
})

test('routes: « the same for everything » gives every type this one recipient; the select shows it back', () => {
  const all = sameForAll(B)
  assert.deepEqual(Object.keys(all), [...NOTIFY_TYPES])
  assert.ok(NOTIFY_TYPES.every(type => all[type].length === 1 && all[type][0] === B))
  const s = state({ routes: all })
  assert.equal(sharedRoute(s), B)
  assert.equal(sharedRoute(state({ routes: { ...all, trophy: [A] } })), null, 'one type differs: not shared')
  assert.equal(sharedRoute(state({ routes: { ...all, trophy: [B, A] } })), null, 'two recipients on one type: not shared')
  assert.equal(sharedRoute(state()), null)
  assert.ok(NOTIFY_TYPES.every(type => sameForAll(null)[type].length === 0), 'none = every type emptied')
  // it posts every route, and only the known ones are kept
  const body = changeBody(state(), { routes: all }, 'en')
  assert.ok(NOTIFY_TYPES.every(type => body.routes[type][0] === B))
})

test('routes: the recipients posted are the ones chosen, deduplicated and capped', () => {
  const body = changeBody(state(), { routes: { decision: [A, A, B, C, D, E] } }, 'en')
  assert.deepEqual(body.routes.decision, [A, B, C, D])
  assert.deepEqual(body.routes.cron, [])
})

// ------------------------------------------------------------------ quiet hours
test('quiet hours: a range over midnight (22:00 to 07:00) — start included, end excluded', () => {
  const q = { enabled: true, from: '22:00', to: '07:00', urgent: [] }
  assert.equal(passesMidnight(q), true)
  for (const [m, expected] of [[min(21, 59), false], [min(22), true], [min(23, 30), true], [0, true], [min(3), true], [min(6, 59), true], [min(7), false], [min(12), false]]) {
    assert.equal(inQuiet(q, m), expected, `minute ${m}`)
  }
})

test('quiet hours: a range inside one day, from = to is empty (no effect), off is off', () => {
  const day = { enabled: true, from: '09:00', to: '17:00', urgent: [] }
  assert.equal(passesMidnight(day), false)
  assert.deepEqual([min(8, 59), min(9), min(16, 59), min(17)].map(m => inQuiet(day, m)), [false, true, true, false])
  const same = { enabled: true, from: '07:00', to: '07:00', urgent: [] }
  assert.ok([0, min(7), min(12), min(23, 59)].every(m => !inQuiet(same, m)), 'from = to: the replay night rule, an empty range')
  assert.equal(quietSentence(same), null, 'and nothing to say about it')
  assert.equal(inQuiet({ ...day, enabled: false }, min(12)), false)
  assert.equal(quietSentence({ ...day, enabled: false }), null)
})

test('quiet hours: the sentence says the two ends and the urgent types that still go through, in the display order', () => {
  const q = quietSentence({ enabled: true, from: '22:00', to: '07:00', urgent: ['trophy', 'gateway'] })
  assert.deepEqual(q, { from: '22:00', to: '07:00', urgent: ['gateway', 'trophy'] })
  assert.deepEqual(quietSentence({ enabled: true, from: '22:00', to: '07:00', urgent: [] }).urgent, [])
})

test('quiet hours: the hour selectors offer 24 hours and keep a time set elsewhere (never rewritten); a bad clock falls back', () => {
  assert.equal(hourChoices('22:00').length, 24)
  assert.deepEqual(hourChoices('22:00').slice(0, 2), ['00:00', '01:00'])
  const odd = hourChoices('22:30')
  assert.equal(odd.length, 25)
  assert.ok(odd.includes('22:30'))
  const s = state({ quiet: { enabled: true, from: '25:00', to: 'x', urgent: ['gateway', 'nope', 'gateway'] } })
  assert.deepEqual(s.quiet, { enabled: true, from: '22:00', to: '07:00', urgent: ['gateway'] })
  const body = changeBody(s, { quiet: { from: '23:00' } }, 'en')
  assert.deepEqual(body.quiet, { enabled: true, from: '23:00', to: '07:00', urgent: ['gateway'] })
  assert.equal(changeBody(s, { quiet: { to: '99:99' } }, 'en').quiet.to, '07:00', 'an invalid clock is never posted')
})

test('quiet hours: the server timezone is read for the sentence', () => {
  assert.deepEqual(state().timezone, { name: 'CET', offset: '+01:00' })
})

// ------------------------------------------------------------------ preview
test('preview: nothing on = no message; the message follows the types that are on', () => {
  assert.equal(previewOf(state(), 'en', words), null)
  const one = previewOf(state({ types: { decision: true } }), 'en', words)
  assert.equal(one.count, 1)
  const lines = one.text.replace(/[\u0001\u0002]/g, '').split('\n')
  assert.match(lines[0], /^⏸ 1 decision is waiting for you · demo$/)
  assert.match(lines[1], /^DEMO-1 Sample decision · backend · for 12 min$/)
  const three = previewOf(state({ types: { decision: true, cron: true, gateway: true } }), 'en', words)
  assert.equal(three.count, 3)
  const t3 = three.text.replace(/[\u0001\u0002]/g, '')
  assert.match(t3, /^3 events · demo/, 'several types: a header per type')
  assert.match(t3, /⏸ 1 decision/)
  assert.match(t3, /⚡ 1 gateway alert/)
  assert.match(t3, /stopped 02:10–02:48 · 38 min/)
  assert.match(t3, /nightly-sample · default · 3 min ago/)
  assert.ok(t3.indexOf('⏸') < t3.indexOf('⚡') && t3.indexOf('⚡') < t3.indexOf('⏰'), 'the order of the types, not of the clicks')
})

test('preview: every one of the eight types has a sample that renders', () => {
  const all = Object.fromEntries(NOTIFY_TYPES.map(t => [t, true]))
  const p = previewOf(state({ types: all }), 'en', words)
  assert.equal(p.count, 8)
  const text = p.text.replace(/[\u0001\u0002]/g, '')
  for (const needle of ['DEMO-1', 'DEMO-2', 'Sample campaign', 'ready to launch · 5 cards', 'DEMO-3', 'sent back', '90 % of the cap'.replace(' %', '%'), 'Sample trophy', 'bronze tier']) assert.ok(text.includes(needle), needle)
  assert.equal(text.split('\n').length <= 1 + 8 + 8, true, 'a header, a line per fact, a header per type')
})

test('preview: it follows the language (en, fr, es) with the French non-breaking spaces', () => {
  const s = state({ types: { decision: true, llm_cap: true } })
  const en = previewOf(s, 'en', words).text
  const fr = previewOf(s, 'fr', { ...words, decision: 'Exemple de décision' }).text
  const es = previewOf(s, 'es', { ...words, decision: 'Decisión de ejemplo' }).text
  assert.match(en, /4\.5 of \$5|\$4\.5 of \$5/)
  assert.match(fr, /90\u00a0% du plafond · 4,5\u00a0\$ sur 5\u00a0\$/)
  assert.match(fr, /depuis 12\u00a0min/)
  assert.match(es, /hace|desde hace 12 min/)
  assert.notEqual(en, fr)
  assert.notEqual(fr, es)
})

test('preview: the bold of the platform is drawn bold, and only where the platform has one', () => {
  const s = state({ types: { decision: true } })
  const tg = previewOf(s, 'en', words, 'telegram')
  const slack = previewOf(s, 'en', words, 'slack')
  assert.ok(previewPieces(tg.text).some(([, bold]) => bold))
  assert.ok(previewPieces(tg.text).every(([text]) => !/[\u0001\u0002]/.test(text)))
  assert.ok(previewPieces(slack.text).every(([, bold]) => !bold))
  assert.equal(previewPieces(tg.text).map(p => p[0]).join(''), slack.text, 'same words either way')
})

test('preview: every symbol of the message is a piece of its own that names its kind (the page draws a line icon, never an emoji)', () => {
  const all = Object.fromEntries(NOTIFY_TYPES.map(t => [t, true]))
  const p = previewOf(state({ types: all, quiet: { enabled: true, from: '22:00', to: '07:00', urgent: [] } }), 'en', words, 'telegram')
  for (const text of [p.text, p.quietText]) {
    const pieces = previewPieces(text)
    const glyphs = pieces.filter(([, , glyph]) => glyph).map(([, , glyph]) => glyph)
    assert.deepEqual(new Set(glyphs), new Set(text === p.text ? NOTIFY_TYPES : [...NOTIFY_TYPES, 'quiet']), 'one glyph kind per symbol of the message')
    assert.ok(pieces.filter(([, , glyph]) => !glyph).every(([chunk]) => !/\p{Extended_Pictographic}/u.test(chunk)), 'no symbol is left as text')
    assert.equal(pieces.map(piece => piece[0]).join('').replace(/[\u0001\u0002]/g, ''), text.replace(/[\u0001\u0002]/g, ''), 'put end to end, the pieces are the message')
  }
})

test('preview: the platform is the first recipient of the first type that is on and routed (else the first known one)', () => {
  assert.equal(previewPlatform(state({ types: { cron: true }, routes: { cron: [B] } })), 'discord')
  assert.equal(previewPlatform(state({ types: { decision: true, cron: true }, routes: { cron: [B], decision: [] } })), 'discord')
  assert.equal(previewPlatform(state()), 'telegram')
})

test('preview: the summary of the end of the quiet hours appears with the quiet hours only', () => {
  const on = state({ types: { decision: true }, quiet: { enabled: true, from: '22:00', to: '07:00', urgent: [] } })
  const p = previewOf(on, 'en', words)
  assert.ok(p.quietText)
  assert.match(p.quietText.replace(/[\u0001\u0002]/g, ''), /^🌙 Quiet hours 22:00–07:00: 1 to review · 1 resolved since · demo/)
  assert.equal(previewOf(state({ types: { decision: true } }), 'en', words).quietText, null)
  assert.equal(previewOf({ ...on, quiet: { ...on.quiet, to: '22:00' } }, 'en', words).quietText, null, 'an empty range has no summary')
})

// ------------------------------------------------------------------ the test button
test('test button: the answer of the host\'s REST door is read whatever its shape', () => {
  assert.deepEqual(readTestError({ status: 429, body: { ok: false, error: 'rate_limited', retryAfter: 41 } }), { status: 429, reason: 'rate_limited', retryAfter: 41 })
  assert.deepEqual(readTestError(new Error('429: {"ok":false,"error":"rate_limited","retryAfter":12.2}')), { status: 429, reason: 'rate_limited', retryAfter: 13 })
  assert.deepEqual(readTestError(new Error('409: {"detail":{"ok":false}}')), { status: 409, reason: null, retryAfter: null })
  assert.deepEqual(readTestError(new Error('409: {"reason":"platform_not_connected"}')), { status: 409, reason: 'platform_not_connected', retryAfter: null })
  assert.deepEqual(readTestError(new Error('502 Bad Gateway')), { status: 502, reason: null, retryAfter: null })
  assert.deepEqual(readTestError(new Error('network down')), { status: null, reason: null, retryAfter: null })
  assert.deepEqual(readTestError(null), { status: null, reason: null, retryAfter: null })
})

test('test button: sent (at HH:MM), a clear error per reason, the minute to wait, the day\'s limit', () => {
  const now = 1_000_000
  assert.deepEqual(testState({ ok: true }, now), { kind: 'sent', at: now })
  assert.deepEqual(testState({ ok: false, reason: 'platform_not_connected' }, now), { kind: 'error', reason: 'platform_not_connected' })
  assert.deepEqual(testState({ ok: false, reason: 'send_failed' }, now), { kind: 'error', reason: 'send_failed' })
  assert.deepEqual(testState({ ok: false, reason: 'unknown_target' }, now), { kind: 'error', reason: 'unknown_target' })
  assert.deepEqual(testState({ ok: false, reason: 'daily_limit', retryAfter: 4000 }, now), { kind: 'error', reason: 'daily_limit' })
  assert.deepEqual(testState({ ok: false, reason: 'weird' }, now), { kind: 'error', reason: 'failed' }, 'an unknown reason is a plain failure')
  assert.deepEqual(testState({ ok: false, reason: null }, now), { kind: 'error', reason: 'failed' })
  assert.deepEqual(testState({ ok: false, reason: 'rate_limited', retryAfter: 41 }, now), { kind: 'wait', until: now + 41_000 })
  assert.deepEqual(testState({ ok: false, reason: 'rate_limited', retryAfter: null }, now), { kind: 'wait', until: now + TEST_WAIT_S * 1000 }, 'no number: the minute')
})

test('test button: idle, sending, sent, the minute between two tests (every button waits), then free again', () => {
  const t0 = 5_000_000
  assert.deepEqual(testView(undefined, t0), { busy: false, disabled: false, line: null })
  assert.deepEqual(testView({ kind: 'sending' }, t0), { busy: true, disabled: true, line: null })
  const sent = testState({ ok: true }, t0)
  const cool = cooldownUntil(t0)
  assert.equal(cool, t0 + 60_000)
  assert.deepEqual(testView(sent, t0 + 1000, cool), { busy: false, disabled: true, line: { key: 'sent', at: t0 } }, 'sent at HH:MM, the button rests')
  assert.equal(testView(undefined, t0 + 1000, cool).disabled, true, 'another recipient\'s button rests too: the limit is one a minute for all')
  assert.equal(testView(sent, t0 + 60_000, cool).disabled, false, 'free after the minute')
  assert.deepEqual(testView(sent, t0 + 60_000, cool).line, { key: 'sent', at: t0 }, 'and it still says when it went')
  // a refusal that says to wait: the countdown, then nothing
  const wait = testState({ ok: false, reason: 'rate_limited', retryAfter: 41 }, t0)
  assert.deepEqual(testView(wait, t0 + 1000), { busy: false, disabled: true, line: { key: 'wait', seconds: 40 } })
  assert.deepEqual(testView(wait, t0 + 41_000), { busy: false, disabled: false, line: null })
  // an error does not lock the button (nothing reached the sender), the daily limit says its own words
  assert.deepEqual(testView({ kind: 'error', reason: 'platform_not_connected' }, t0), { busy: false, disabled: false, line: { key: 'platform_not_connected' } })
  assert.deepEqual(testView({ kind: 'error', reason: 'daily_limit' }, t0), { busy: false, disabled: false, line: { key: 'daily_limit' } })
})

test('the wait line counts down to the last second in every language, never « 1 min » with 5 s left', async () => {
  const { en } = await import('../../src/i18n/en.js')
  const { fr } = await import('../../src/i18n/fr.js')
  const { es } = await import('../../src/i18n/es.js')
  const t0 = 9_000_000
  const wait = testState({ ok: false, reason: 'rate_limited', retryAfter: 60 }, t0)
  for (const words of [en, fr, es]) {
    for (let s = 1; s <= 59; s += 1) {
      const { line } = testView(wait, t0 + (60 - s) * 1000)
      assert.equal(line.seconds, s)
      assert.match(words.notify.tested.wait(line.seconds), new RegExp(`\\b${s} s$`), `${s} s left`)
    }
    assert.match(words.notify.tested.wait(60), /\b60 s$/)
    assert.match(words.notify.tested.wait(3600), /\b60 min$/)
  }
})

// ------------------------------------------------------------------ trophies
test('trophies: the page reports only what it has just seen unlock — never the first launch, never a grouped update', () => {
  const game = { achievements: [{ id: 'zero', tier: 'silver' }, { id: 'night_owl', tier: null }, { id: 'Bad-Id', tier: 'gold' }] }
  const nameOf = id => ({ zero: 'Zero breakage', night_owl: 'Night owl', 'Bad-Id': 'x' })[id]
  assert.deepEqual(trophyPayload({ kind: 'new', ids: ['zero', 'night_owl'] }, game, nameOf), [{ id: 'zero', name: 'Zero breakage', tier: 'silver' }, { id: 'night_owl', name: 'Night owl', tier: null }])
  assert.deepEqual(trophyPayload({ kind: 'first', ids: ['zero'] }, game, nameOf), [])
  assert.deepEqual(trophyPayload({ kind: 'many', ids: ['zero'] }, game, nameOf), [])
  assert.deepEqual(trophyPayload({ kind: null, ids: [] }, game, nameOf), [])
  assert.deepEqual(trophyPayload(null, game, nameOf), [])
  assert.deepEqual(trophyPayload({ kind: 'new', ids: ['Bad-Id'] }, game, nameOf), [], 'an id the agent half would refuse is not sent')
  assert.deepEqual(trophyPayload({ kind: 'new', ids: ['zero'] }, game, () => ''), [], 'a trophy with no name is not sent')
  const long = trophyPayload({ kind: 'new', ids: ['zero'] }, game, () => 'x'.repeat(90))
  assert.equal(long[0].name.length, 60)
  const many = trophyPayload({ kind: 'new', ids: Array.from({ length: 30 }, (_, i) => `t${i}`) }, { achievements: [] }, id => id)
  assert.equal(many.length, 12, 'at most 12 at a time')
})

test('the preview of the quiet-hours summary (1 resolved) is singular in every language', () => {
  const s = state({ types: { decision: true }, quiet: { enabled: true, from: '22:00', to: '07:00', urgent: [] } })
  const head = (lang) => previewOf(s, lang, words).quietText.split('\n')[0].replace(/[\u0001\u0002]/g, '')
  assert.match(head('fr'), / · 1 résolu entre-temps(?: |$)/)
  assert.match(head('es'), / · 1 resuelto entretanto(?: |$)/)
  assert.match(head('en'), / · 1 resolved since(?: |$)/)
})
}

// ===== notify =====
{
// A save must put what the server answered into that cache: otherwise a form reopened within 15 s shows the board from
// BEFORE the save, and the next switch posts that whole stale board, silently turning the previous change back off.

// data/notify.js imports from the host SDK, which does not exist under node: a stand-in, only for this test.
const STUB = 'export const useQuery = () => ({}); export const useQueryClient = () => null'
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) { return s === '@hermes/plugin-sdk' ? { url: 'data:text/javascript,${encodeURIComponent(STUB)}', shortCircuit: true } : next(s, c) }`)}`)
const { NOTIFY_KEY, initNotify, saveNotify } = await import('../../src/data/notify.js')

const served = types => ({
  ok: true,
  settings: { types, target: 'telegram#aaaaaaaa', lang: 'en' },
  targets: [{ key: 'telegram#aaaaaaaa', platform: 'telegram', label: '…1234', source: 'cron' }],
  hourlyCap: 6,
  last: null
})

const fakeCache = () => {
  const writes = []
  return { writes, setQueryData: (key, value) => writes.push({ key, value }) }
}

test('a saved board is what the shared cache holds afterwards (no stale board on reopen)', async () => {
  initNotify({ rest: async () => served({ decision: true }) })
  const cache = fakeCache()
  const res = await saveNotify({ types: { decision: true }, target: 'telegram#aaaaaaaa', lang: 'en' }, cache)
  assert.equal(res.ok, true)
  assert.equal(cache.writes.length, 1, 'the save must update the shared query cache')
  assert.deepEqual(cache.writes[0].key, NOTIFY_KEY)
  assert.equal(cache.writes[0].value.types.decision, true)
})

test('a refused save leaves the cache alone', async () => {
  initNotify({ rest: async () => { const e = new Error('422'); e.body = { ok: false, reason: 'unknown_target' }; throw e } })
  const cache = fakeCache()
  const res = await saveNotify({ types: { decision: true }, target: 'telegram#bbbbbbbb', lang: 'en' }, cache)
  assert.deepEqual(res, { ok: false, reason: 'unknown_target' })
  assert.equal(cache.writes.length, 0)
})
}
