import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildOffice, toBoard } from '../../src/core/office.js'
import { toHistory } from '../../src/core/history.js'
import { modelOf, modelText, withWorkerModels } from '../../src/core/models.js'
import { buildRoster } from '../../src/core/roster.js'

const NOW = 1_800_000_000_000
const s = ms => ms / 1000
const DEFAULT = { model: 'example/model-fast', provider: 'example' }

/** Office with one bot `a` (default model above) and the given cards; returns the agent and the office. */
function setup(tasks, extraDesk = {}) {
  const desks = buildRoster({ profiles: [{ name: 'a', ...DEFAULT, last_session: null, worker_session: null, ...extraDesk }] }, NOW)
  const office = buildOffice(desks, {
    ok: true,
    boards: [{ slug: 'website', tasks: tasks.map(t => ({ title: 't', assignee: 'a', createdAt: s(NOW - 1e6), ...t })) }]
  }, NOW)
  return { agent: office.agents[0], office }
}
const running = extra => ({ id: 't1', status: 'running', startedAt: s(NOW - 60_000), heartbeatAt: s(NOW - 5000), ...extra })

test('no running card: default only, differs false (a blocked card with an override does not count)', () => {
  const { agent, office } = setup([{ id: 'x', status: 'blocked', modelOverride: 'large' }])
  assert.deepEqual(modelOf(agent, office), { default: DEFAULT, card: null, actual: null, differs: false })
  assert.equal(modelOf(setup([]).agent, null).differs, false)
})

test('running card without override: card present, nothing pinned, differs false', () => {
  const { agent, office } = setup([running()])
  assert.deepEqual(modelOf(agent, office), {
    default: DEFAULT, card: { model: null, provider: null, cardId: 't1', board: 'website' }, actual: null, differs: false
  })
})

test('override identical to the default: differs false', () => {
  const { agent, office } = setup([running({ modelOverride: DEFAULT.model, providerOverride: DEFAULT.provider })])
  const m = modelOf(agent, office)
  assert.equal(m.differs, false)
  assert.equal(m.card.model, DEFAULT.model)
})

test('override different: differs true, strings kept exactly (large is not example/model-large)', () => {
  const { agent, office } = setup([running({ modelOverride: 'large', providerOverride: 'acme-cloud' })])
  const m = modelOf(agent, office)
  assert.equal(m.differs, true)
  assert.deepEqual(m.card, { model: 'large', provider: 'acme-cloud', cardId: 't1', board: 'website' })
  assert.equal(m.default.model, DEFAULT.model)
  // the same string with another spelling is another model: no normalisation
  assert.equal(modelOf(setup([running({ modelOverride: 'Example/model-fast' })]).agent).differs, true)
})

test('same model, other provider: differs true', () => {
  const { agent, office } = setup([running({ modelOverride: DEFAULT.model, providerOverride: 'other-cloud' })])
  const m = modelOf(agent, office)
  assert.equal(m.differs, true)
  assert.equal(m.card.provider, 'other-cloud')
})

test('real model known: it decides, and it can differ from what the card pins', () => {
  const { agent, office } = setup([running({ modelOverride: 'large' })])
  // worker ran the card's model under another name: differs from the default, actual shown next to the card
  let m = modelOf({ ...agent, workerModel: 'example/model-large', workerActiveMs: NOW - 1000 }, office)
  assert.deepEqual(m.actual, { model: 'example/model-large' })
  assert.equal(m.card.model, 'large')
  assert.equal(m.differs, true)
  // the card pins another model but the session really used the default: nothing differs in practice
  m = modelOf({ ...agent, workerModel: DEFAULT.model, workerActiveMs: NOW - 1000 }, office)
  assert.equal(m.differs, false)
  assert.equal(m.card.model, 'large')
  // a worker session older than the card belongs to an earlier card: ignored
  m = modelOf({ ...agent, workerModel: DEFAULT.model, workerActiveMs: NOW - 9e6 }, office)
  assert.equal(m.actual, null)
  assert.equal(m.differs, true)
  // an idle bot's last worker model means nothing without a running card
  assert.equal(modelOf({ ...setup([]).agent, workerModel: 'large' }, null).actual, null)
})

test('several running cards: the first one (main card first) that pins a model decides, here the newer one', () => {
  const { agent } = setup([running({ id: 'old', startedAt: s(NOW - 9e5) }), running({ id: 'new', startedAt: s(NOW - 1e4), modelOverride: 'large' })])
  assert.equal(modelOf(agent).card.cardId, 'new')
})

test('toBoard keeps the overrides as exact strings, null when absent or empty', () => {
  const b = toBoard({ slug: 'b', tasks: [
    { id: '1', status: 'running', modelOverride: ' large ', providerOverride: 'acme-cloud' },
    { id: '2', status: 'todo', modelOverride: '', providerOverride: 7 },
    { id: '3', status: 'todo' }
  ] })
  assert.deepEqual(b.tasks.map(t => [t.modelOverride, t.providerOverride]), [['large', 'acme-cloud'], [null, null], [null, null]])
})

test('withWorkerModels reads workerModel from /history; no history leaves the agents as they are', () => {
  const agents = [{ name: 'a' }, { name: 'b' }]
  const history = toHistory({ ok: true, profiles: [
    { name: 'a', workerModel: 'example/model-large', worker: { title: '', last_active: s(NOW), source: 'kanban', model: 'example/model-large' } },
    { name: 'b' }
  ], boards: [] })
  const out = withWorkerModels(agents, history)
  assert.equal(out[0].workerModel, 'example/model-large')
  assert.equal(out[0].workerActiveMs, NOW)
  assert.equal(out[1].workerModel, undefined)
  assert.equal(withWorkerModels(agents, { ok: false }), agents)
})

/** Roster row without a model (what `profiles.list` really sends for most bots in the webapp). */
const blankDesk = () => ({
  desks: buildRoster({ profiles: [{ name: 'a', model: '', provider: '', last_session: null, worker_session: null }] }, NOW)
})
const historyWith = (row) => toHistory({ ok: true, profiles: [{ name: 'a', ...row }], boards: [] })

test('empty roster + /history: the default comes from /history and differs compares against it', () => {
  const { desks } = blankDesk()
  const agent = withWorkerModels(buildOffice(desks, null, NOW).agents, historyWith({ defaultModel: DEFAULT.model, defaultProvider: DEFAULT.provider }))[0]
  assert.equal(agent.model, DEFAULT.model)
  assert.equal(agent.provider, DEFAULT.provider)

  const office = buildOffice(desks, { ok: true, boards: [{ slug: 'website', tasks: [running({ assignee: 'a', modelOverride: 'large', providerOverride: 'acme-cloud' })] }] }, NOW)
  const [withHist] = withWorkerModels(office.agents, historyWith({ defaultModel: DEFAULT.model, defaultProvider: DEFAULT.provider }))
  let m = modelOf(withHist, office)
  assert.deepEqual(m.default, DEFAULT)
  assert.equal(m.differs, true)

  // a card pinning the same default does not differ
  const same = buildOffice(desks, { ok: true, boards: [{ slug: 'website', tasks: [running({ assignee: 'a', modelOverride: DEFAULT.model, providerOverride: DEFAULT.provider })] }] }, NOW)
  const [sameAgent] = withWorkerModels(same.agents, historyWith({ defaultModel: DEFAULT.model, defaultProvider: DEFAULT.provider }))
  assert.equal(modelOf(sameAgent, same).differs, false)
})

test('roster model wins over /history (no regression)', () => {
  const { agent, office } = setup([running({ modelOverride: 'large' })])
  const provided = withWorkerModels([agent], historyWith({ defaultModel: 'example/model-large', defaultProvider: 'acme-cloud' }))[0]
  assert.deepEqual({ model: provided.model, provider: provided.provider }, DEFAULT)
  assert.equal(provided.provider, DEFAULT.provider)
  assert.equal(modelOf(provided, office).differs, true)
})

test('unknown default on both sides: no differs, no "null", default stays empty', () => {
  const { desks } = blankDesk()
  const office = buildOffice(desks, { ok: true, boards: [{ slug: 'website', tasks: [running({ assignee: 'a', modelOverride: 'large' })] }] }, NOW)
  // /history says nothing about the default (missing and explicit null behave the same)
  for (const row of [{}, { defaultModel: null, defaultProvider: null }, { defaultModel: '  ', defaultProvider: 'null' }]) {
    const [agent] = withWorkerModels(office.agents, historyWith(row))
    assert.equal(agent.model, '')
    assert.equal(agent.provider, '')
    const m = modelOf(agent, office)
    assert.deepEqual(m.default, { model: '', provider: '' })
    assert.equal(m.differs, false)
    assert.equal(modelText(m.default), '')
    assert.ok(!JSON.stringify(m.default).includes('null'))
  }
  // a known real worker model does not invent a comparison either
  const [agent] = withWorkerModels(office.agents, historyWith({ workerModel: 'example/model-large', worker: { last_active: s(NOW) } }))
  assert.equal(modelOf(agent, office).differs, false)
})
