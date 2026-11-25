import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLightPref, isMotionPref, motionReduced, resolveLight } from '../../src/core/daylight.js'
import { toHistory } from '../../src/core/history.js'
import { modelOf, pinOf, withWorkerModels } from '../../src/core/models.js'
import { buildOffice } from '../../src/core/office.js'
import { CHAIN_LEN, EVENT_KINDS, plainTitle, badgesOf, chainsView, eventsView, inboxItems, inspectorOf, newBadges, sinceOf, topStats, untitledKey } from '../../src/core/panel.js'
import { buildRoster } from '../../src/core/roster.js'
import { ROLE_IDS } from '../../src/scene/index.js'
import { messages } from '../../src/i18n/index.js'
import { readFileSync } from 'node:fs'
import { HEALTH_RETRY_MS, healthPollMs } from '../../src/core/health.js'

// ===== panel =====
{
const NOW = 1_800_000_000_000
const s = ms => ms / 1000
const DEF = { model: 'example/model-fast', provider: 'example' }

const desks = buildRoster({
  profiles: [
    { name: 'dev', ...DEF, last_session: { id: 'S1', title: 'Fix the build', last_active: s(NOW - 3_600_000) }, worker_session: null },
    { name: 'ops', ...DEF, last_session: null, worker_session: null },
    { name: 'idle', model: 'model-x', provider: 'acme-cloud', last_session: null, worker_session: null }
  ]
}, NOW)
const card = (id, over = {}) => ({ id, title: `${id} title`, status: 'todo', assignee: 'dev', createdAt: s(NOW - 10_000_000), ...over })
const live = {
  ok: true,
  boards: [
    { slug: 'alpha', tasks: [
      card('A1', { status: 'done', completedAt: s(NOW - 9_000_000) }),
      card('A2', { status: 'blocked', createdAt: s(NOW - 8_000_000) }),
      card('A3', { status: 'blocked', assignee: 'ops', createdAt: s(NOW - 9_500_000), modelOverride: 'example/model-large' }),
      card('A4', { status: 'running', startedAt: s(NOW - 600_000), heartbeatAt: s(NOW - 10_000), modelOverride: 'example/model-large', providerOverride: 'acme-cloud' }),
      card('A5', { status: 'archived' })
    ] },
    { slug: 'beta', tasks: [card('B1', { status: 'blocked', assignee: null, createdAt: s(NOW - 20_000_000) }), card('B2', { status: 'ready' })] },
    { slug: 'empty', tasks: [] }
  ]
}
const office = buildOffice(desks, live, NOW)

test('inbox: exactly the blocked cards of every board, oldest first, with the pinned model when it differs', () => {
  const items = inboxItems(office)
  assert.deepEqual(items.map(i => `${i.board}/${i.id}`), ['beta/B1', 'alpha/A3', 'alpha/A2'])
  const blockedInData = live.boards.flatMap(b => b.tasks.filter(t => t.status === 'blocked'))
  assert.equal(items.length, blockedInData.length)
  assert.equal(items[0].assignee, null)
  assert.equal(items[0].pin, null)
  assert.deepEqual(items[1].pin, { model: 'example/model-large', provider: null, default: DEF })   // ops' default is another model
  assert.equal(items[2].pin, null)                                                                // dev has no override on A2
  assert.deepEqual(inboxItems({ boards: [], agents: [] }), [])
})

test('inbox: the age is when the card was last blocked (/history events), its creation only when no event says so', () => {
  const history = toHistory({ ok: true, profiles: [], boards: [
    { slug: 'alpha', runs: [], events: [
      { task: 'A2', kind: 'blocked', ts: s(NOW - 9_000_000) }, { task: 'A2', kind: 'unblocked', ts: s(NOW - 8_000_000) },
      { task: 'A2', kind: 'blocked', ts: s(NOW - 100_000) }, { task: 'A3', kind: 'blocked', ts: s(NOW - 200_000) }
    ] },
    { slug: 'beta', runs: [], events: [{ task: 'B2', kind: 'blocked', ts: s(NOW - 50_000) }] }
  ] })
  // B1 has no event (its creation, 20 000 s ago, is all that is known), A3 blocked 200 s ago, A2 blocked again 100 s ago
  assert.deepEqual(inboxItems(office, history).map(i => [i.id, i.blockedMs]), [['B1', null], ['A3', NOW - 200_000], ['A2', NOW - 100_000]])
  assert.deepEqual(inboxItems(office).map(i => i.blockedMs), [null, null, null])
  // Hermes does record the blocking (task_events): the page must not say otherwise
  for (const lang of ['en', 'fr', 'es']) assert.ok(!/not record|n’enregistre pas|no registra/.test(messages[lang].inbox.ageNote), lang)
})

test('inspector: at most 4 waiting cards, the rest counted', () => {
  const tasks = Array.from({ length: 6 }, (_, i) => card(`W${i}`, { status: 'blocked', createdAt: s(NOW - (10 - i) * 60_000) }))
  const o = buildOffice(desks, { ok: true, boards: [{ slug: 'w', tasks }] }, NOW)
  const i = inspectorOf(o.agents.find(a => a.name === 'dev'), { nowMs: NOW })
  assert.deepEqual(i.waiting.map(w => w.code), ['W0', 'W1', 'W2', 'W3'])
  assert.equal(i.waitingMore, 2)
})

test('inbox: a card whose override equals its assignee default shows nothing', () => {
  const o = buildOffice(desks, { ok: true, boards: [{ slug: 'x', tasks: [card('X1', { status: 'blocked', modelOverride: DEF.model })] }] }, NOW)
  assert.equal(inboxItems(o)[0].pin, null)
})

test('chains: last 16 cards per board, newest at the right, archived skipped, empty board kept', () => {
  const many = Array.from({ length: 20 }, (_, i) => card(`C${i}`, { createdAt: s(NOW - (30 - i) * 60_000), status: i % 2 ? 'done' : 'todo' }))
  const o = buildOffice(desks, { ok: true, boards: [{ slug: 'big', tasks: [...many, card('Z', { status: 'archived', createdAt: s(NOW) })] }, { slug: 'none', tasks: [] }] }, NOW)
  const [big, none] = chainsView(o)
  assert.equal(big.queue.length, CHAIN_LEN)
  assert.equal(big.queue.at(-1).id, 'C19')
  assert.equal(big.queue[0].id, 'C4')
  assert.ok(!big.queue.some(c => c.id === 'Z'))
  assert.equal(big.pct, 48)   // 10 done of 21 cards, the archived one counted like the whiteboard counts it
  assert.deepEqual([none.slug, none.queue.length, none.pct], ['none', 0, 0])
  const alpha = chainsView(office)[0]
  assert.deepEqual(alpha.pinned.map(c => c.id), ['A3', 'A4'])   // both impose a model that differs from their assignee's default
})

test('chains: states render with status and a pin only where the model differs', () => {
  for (const st of ['todo', 'triage', 'scheduled', 'ready', 'running', 'review', 'blocked', 'done']) {
    const o = buildOffice(desks, { ok: true, boards: [{ slug: 'b', tasks: [card('T1', { status: st })] }] }, NOW)
    assert.equal(chainsView(o)[0].queue[0].status, st)
  }
})

test('events: whitelisted kinds only, newest first, card code from the board, history required', () => {
  const history = toHistory({
    ok: true,
    profiles: [],
    boards: [{ slug: 'alpha', runs: [], events: [
      { task: 'A2', kind: 'blocked', ts: s(NOW - 1000) },
      { task: 'A4', kind: 'completed', ts: s(NOW - 500) },
      { task: 'A4', kind: 'secret_payload', ts: s(NOW - 100) },
      { task: 'gone', kind: 'crashed', ts: s(NOW - 2000) }
    ] }]
  })
  const ev = eventsView(history, office)
  assert.deepEqual(ev.map(e => e.kind), ['completed', 'blocked', 'crashed'])
  assert.deepEqual(ev.map(e => e.code), ['A4', 'A2', 'gone'])
  assert.equal(eventsView(null, office).length, 0)
  assert.equal(eventsView(history, office, 2).length, 2)
  for (const k of EVENT_KINDS) assert.ok(k in messages.en.journal, k)
})

test('inspector: name, state, since, current card, waiting cards, session, own skills (never a description)', () => {
  const history = toHistory({ ok: true, profiles: [{ name: 'dev', description: 'SECRET role text', skills: { own: [{ name: 'git-flow', category: 'devops', description: 'SECRET skill body' }], count: 1 } }], boards: [] })
  const dev = office.agents.find(a => a.name === 'dev')
  const i = inspectorOf(dev, { nowMs: NOW, history, models: modelOf(dev, office), roleId: 'developer' })
  assert.equal(i.name, 'dev')
  assert.equal(i.state, dev.state)
  assert.equal(i.current.code, 'A4')
  assert.equal(i.current.startedMs, NOW - 600_000)
  assert.deepEqual(i.waiting.map(w => w.code), ['A2'])
  assert.deepEqual(i.session, { title: 'Fix the build', ms: NOW - 3_600_000 })
  assert.deepEqual(i.skills, [{ name: 'git-flow', category: 'devops' }])
  assert.equal(i.grade, null)
  assert.ok(!JSON.stringify(i).includes('SECRET'))
  assert.equal(inspectorOf(null, {}), null)
})

test('inspector: the model row appears only when the model differs from the default', () => {
  const dev = office.agents.find(a => a.name === 'dev')
  const m = inspectorOf(dev, { nowMs: NOW, models: modelOf(dev, office) }).model
  assert.deepEqual(m, { card: 'example/model-large', default: DEF.model, actual: null })
  const ops = office.agents.find(a => a.name === 'ops')
  assert.equal(inspectorOf(ops, { nowMs: NOW, models: modelOf(ops, office) }).model, null)
  const same = buildOffice(desks, { ok: true, boards: [{ slug: 'x', tasks: [card('S1', { status: 'running', startedAt: s(NOW - 1e5), heartbeatAt: s(NOW - 5000) })] }] }, NOW).agents[0]
  assert.equal(inspectorOf(same, { nowMs: NOW, models: modelOf(same, null) }).model, null)
})

test('inspector: the actual model is shown when /history knows it', () => {
  const history = toHistory({ ok: true, profiles: [{ name: 'dev', workerModel: 'example/model-xl', worker: { last_active: s(NOW - 1000), title: 't' } }], boards: [] })
  const agents = withWorkerModels(office.agents, history)
  const dev = agents.find(a => a.name === 'dev')
  assert.equal(inspectorOf(dev, { nowMs: NOW, models: modelOf(dev, office) }).model.actual, 'example/model-xl')
})

test('sinceOf: which timestamp says since when', () => {
  const dev = office.agents.find(a => a.name === 'dev')
  assert.equal(sinceOf({ state: 'working', running: [{ startedMs: 5 }], lastActivityMs: 9 }, NOW).kind, 'working')
  assert.equal(sinceOf({ state: 'waiting', blocked: [{ createdMs: 7 }, { createdMs: 3 }] }, NOW).ms, 3)
  assert.deepEqual(sinceOf({ state: 'stale', silentMs: 600_000 }, NOW), { kind: 'stale', ms: NOW - 600_000 })
  assert.deepEqual(sinceOf({ state: 'idle', lastActivityMs: 42 }, NOW), { kind: 'activity', ms: 42 })
  assert.equal(sinceOf({ state: 'new' }, NOW), null)
  assert.equal(sinceOf(null, NOW), null)
  assert.ok(dev)
})

test('badges: present if and only if the running card differs from the default', () => {
  const models = new Map(office.agents.map(a => [a.name, modelOf(a, office)]))
  const b = badgesOf(office.agents, models)
  assert.deepEqual(b.map(x => x.name), ['dev'])
  assert.deepEqual([b[0].code, b[0].card, b[0].default, b[0].board], ['A4', 'example/model-large', DEF.model, 'alpha'])
  // no running card with an override -> nothing
  const calm = buildOffice(desks, { ok: true, boards: [{ slug: 'x', tasks: [card('K1', { status: 'running', startedAt: s(NOW - 1e5), heartbeatAt: s(NOW - 5000) })] }] }, NOW)
  assert.deepEqual(badgesOf(calm.agents, new Map(calm.agents.map(a => [a.name, modelOf(a, calm)]))), [])
})

test('badges: only new ones are announced', () => {
  const b = [{ name: 'a' }, { name: 'b' }]
  assert.deepEqual(newBadges(null, b).map(x => x.name), ['a', 'b'])
  assert.deepEqual(newBadges(new Set(['a']), b).map(x => x.name), ['b'])
  assert.deepEqual(newBadges(new Set(['a', 'b']), b), [])
})

test('pinOf: any status, needs a known assignee, compares model and provider', () => {
  const agent = { model: 'm1', provider: 'p1' }
  assert.equal(pinOf({ modelOverride: 'm1' }, agent), null)
  assert.deepEqual(pinOf({ modelOverride: 'm2' }, agent), { model: 'm2', provider: null, default: { model: 'm1', provider: 'p1' } })
  assert.ok(pinOf({ providerOverride: 'p2' }, agent))
  assert.equal(pinOf({ modelOverride: 'm2' }, undefined), null)
  assert.equal(pinOf({}, agent), null)
})

test('top counters', () => {
  assert.deepEqual(topStats(office), { agents: 3, working: 0, active: 0, decisions: 3, open: 5, cards: 7 })
  assert.deepEqual(topStats({ agents: [], boards: [] }), { agents: 0, working: 0, active: 0, decisions: 0, open: 0, cards: 0 })
})

test('light and motion settings: a forced light wins, anything else follows the clock', () => {
  const noon = new Date(2026, 10, 8, 12)
  const late = new Date(2026, 10, 8, 23)
  assert.equal(resolveLight('night', noon), 'night')
  assert.equal(resolveLight('day', late), 'day')
  assert.equal(resolveLight('auto', noon), 'day')
  assert.equal(resolveLight('auto', late), 'night')
  assert.equal(resolveLight('garbage', late), 'night')
  assert.ok(isLightPref('auto') && isLightPref('day') && isLightPref('night') && !isLightPref('dusk'))
  assert.ok(isMotionPref('auto') && isMotionPref('reduced') && !isMotionPref('none'))
  assert.equal(motionReduced('reduced', false), true)
  assert.equal(motionReduced('auto', true), true)
  assert.equal(motionReduced('auto', false), false)
})

test('every role has a translated label in every language', () => {
  for (const lang of ['en', 'fr', 'es']) {
    for (const id of [...ROLE_IDS, 'none']) assert.ok(messages[lang].role[id], `${lang}.role.${id}`)
  }
})

test('plainTitle drops the leading code (it is shown on its own) and never returns an empty title', () => {
  assert.equal(plainTitle('S1.4 — Inspector and tooltips', 'S1.4'), 'Inspector and tooltips')
  assert.equal(plainTitle('S3.2: wire it', 'S3.2'), 'wire it')
  assert.equal(plainTitle('S3.2', 'S3.2'), 'S3.2')
  assert.equal(plainTitle('write the docs', ''), 'write the docs')
  assert.equal(plainTitle(null, 'A1'), '')
})
}

// ===== panel =====
{
// The inspector dates and sorts a waiting card like the decision inbox (blocked event first, creation otherwise).
const NOW = 1_800_000_000_000
const s = ms => ms / 1000
const desks = buildRoster({ profiles: [{ name: 'dev', last_session: null, worker_session: null }] }, NOW)
const card = (id, createdAgo) => ({ id, title: `${id} card`, status: 'blocked', assignee: 'dev', createdAt: s(NOW - createdAgo) })
// B was created later than A, but blocked much earlier (its last `blocked` event): it has waited longer
const office = buildOffice(desks, { ok: true, boards: [{ slug: 'x', tasks: [card('a', 3_600_000), card('b', 600_000)] }] }, NOW)
const history = { ok: true, boards: [{ slug: 'x', events: [{ task: 'b', kind: 'blocked', ms: NOW - 7_200_000 }] }], profiles: {} }
const dev = () => office.agents.find(a => a.name === 'dev')

test('the inspector sorts and dates waiting cards by the blocking when an event says so, like the inbox', () => {
  const i = inspectorOf(dev(), { nowMs: NOW, history })
  assert.deepEqual(i.waiting.map(w => w.blockedMs), [NOW - 7_200_000, null])   // b first (blocked 2 h ago), then a (no event)
  assert.deepEqual(i.since, { kind: 'waitingBlocked', ms: NOW - 7_200_000 })
  // same order as the inbox
  assert.deepEqual(inboxItems(office, history).map(c => c.id), ['b', 'a'])
  assert.equal(i.waiting[0].createdMs, NOW - 600_000)
})

test('without a blocked event the creation dates it (kind waiting), oldest first', () => {
  const i = inspectorOf(dev(), { nowMs: NOW })
  assert.deepEqual(i.waiting.map(w => w.createdMs), [NOW - 3_600_000, NOW - 600_000])
  assert.deepEqual(i.since, { kind: 'waiting', ms: NOW - 3_600_000 })
})
}

// ===== panel =====
{
test('a session without a title is labelled untitled, never « no session »', () => {
  assert.equal(untitledKey({ title: '', ms: 1 }), 'insp.untitled')
  assert.equal(untitledKey({ title: 'Fix the build', ms: 1 }), null)
  assert.equal(untitledKey(null), null)
  for (const lang of ['en', 'fr', 'es']) {
    assert.ok(messages[lang].insp.untitled, `${lang} insp.untitled`)
    assert.notEqual(messages[lang].insp.untitled, messages[lang].insp.noSession, `${lang}: untitled is not the no-session text`)
  }
})

// a /health that failed once (network blip) or answered « absent » must not keep the office read-only for the 5 min staleTime
test('an absent or unreachable agent half is asked again, a present one never', () => {
  assert.equal(healthPollMs(undefined), HEALTH_RETRY_MS)
  assert.equal(healthPollMs({ present: false }), HEALTH_RETRY_MS)
  assert.equal(healthPollMs({ present: true, reads: ['live'] }), false)
  assert.ok(HEALTH_RETRY_MS >= 5_000, 'never faster than one request per 5 s')
})

// closing the wide panel with its X unmounts the focused button: left alone, the focus falls to <body> (keyboard users lose their place).
// DOM-free contract on the source: both branches of closePanel hand the focus to the toggle.
test('closePanel gives the focus to the toggle in the wide layout too', () => {
  const src = readFileSync(new URL('../../src/ui/OfficePage.jsx', import.meta.url), 'utf8')
  const body = src.match(/const closePanel = \(\) => \{([\s\S]*?)\n  \}/)?.[1] ?? ''
  assert.match(body, /toggleWide\(true\)/, "the wide branch folds the panel through the shared toggle")
  assert.match(body, /setDrawerOpen\(false\)/)
  assert.match(body, /toggleRef\.current\?\.focus\(\)/)
  assert.ok(!/else setPanelOpen\(false\)\s*$/.test(body.trim()), 'the wide branch must not be the last statement without a focus call')
})
}

// ===== the model block of the sheet, in two lines =====
{
const { modelLines } = await import('../../src/core/panel.js')
test('modelLines: the model used, whole, with who imposes it; the default under it; « really used » only when it differs', () => {
  assert.equal(modelLines(null), null)
  // a card pins a model, the worker ran with it: two lines, no « really used »
  assert.deepEqual(modelLines({ card: 'example/model-large', default: 'example/model-fast', actual: 'example/model-large' }, 'A4'), { shown: 'example/model-large', imposedBy: 'A4', actual: null, default: 'example/model-fast' })
  // the worker ran with something else than the card pins: the third line
  assert.deepEqual(modelLines({ card: 'example/model-large', default: 'example/model-fast', actual: 'example/model-xl' }, 'A4').actual, 'example/model-xl')
  // several cards: the code the facts name wins over the sole card
  assert.equal(modelLines({ card: 'a/b', default: 'c/d', actual: null, cardCode: 'B7' }, 'A4').imposedBy, 'B7')
  // nothing pinned, the worker differs from the default: its model is the first line and nobody « imposes » it
  assert.deepEqual(modelLines({ card: '', default: 'example/model-fast', actual: 'example/model-xl' }, 'A4'), { shown: 'example/model-xl', imposedBy: null, actual: null, default: 'example/model-fast' })
  // a pin on a card with no code: imposed, by « the card »
  assert.equal(modelLines({ card: 'a/b', default: 'c/d', actual: null }).imposedBy, '')
  for (const code of ['en', 'fr', 'es']) {
    assert.match(messages[code].insp.modelImposed('WX-1'), /WX-1/)
    assert.ok(!/WX-1/.test(messages[code].insp.modelImposed('')) && messages[code].insp.modelImposed('').length > 6, code)
  }
})

test('the sheet: the grade is a row of the table after the description, the labels are plain (« None », « Own skills » / « Compétences propres »)', () => {
  const tab = readFileSync(new URL('../../src/ui/AgentTab.jsx', import.meta.url), 'utf8')
  assert.ok(tab.indexOf("t('insp.grade')") > tab.indexOf('<DescriptionRow'), 'Grade comes after the description')
  assert.doesNotMatch(tab, /\{i\.grade \? ` · \$\{i\.grade\}` : ''\}/, 'no longer in the header line')
  assert.equal(messages.fr.insp.skills, 'Compétences propres')
  assert.equal(messages.fr.insp.noSession, 'Aucune')
  for (const code of ['en', 'fr', 'es']) assert.ok(messages[code].insp.grade.length > 3 && messages[code].insp.noSession.length > 3, code)
})
}
