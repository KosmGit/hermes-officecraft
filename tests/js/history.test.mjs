// /history on the front: whitelist, merge into the scene model (roles, desk objects, diploma), and the degraded
// modes (no agent half, failed read).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { RECENT_SKILL_MS, hasRecentSkill, sceneProfiles, toHistory } from '../../src/core/history.js'
import { buildOffice } from '../../src/core/office.js'
import { buildRoster } from '../../src/core/roster.js'
import { buildBase, drawScene, kitsOf, layoutScene, needsAnimation, roleOf, toSceneModel } from '../../src/scene/index.js'

const example = JSON.parse(readFileSync(new URL('./fixtures/example-office.json', import.meta.url), 'utf8'))
const NOW_S = example.generatedAt
const NOW = NOW_S * 1000

const body = { ok: true, at: NOW_S, profiles: example.profiles, boards: example.boards || [] }
const rows = example.profiles.map(p => ({ name: p.name, description: p.description, last_session: null, worker_session: null }))
const desks = buildRoster({ profiles: rows }, NOW)
const office = buildOffice(desks, null, NOW)
const liveOffice = buildOffice(desks, { ok: true, boards: example.boards, ops: example.ops }, NOW)

test('desk objects and diploma are drawn once /history is there, and not before', () => {
  const history = toHistory(body)
  const withSkills = toSceneModel(liveOffice, { nowMs: NOW, profiles: sceneProfiles(history, liveOffice.agents, NOW) })
  const without = toSceneModel(liveOffice, { nowMs: NOW, profiles: sceneProfiles(null, liveOffice.agents, NOW) })
  const paint = m => { const l = layoutScene(m); return drawScene(l, buildBase(l, m), m, 0).d }
  const a = paint(withSkills)
  const b = paint(without)
  let differ = 0
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) differ++
  assert.ok(differ > 0, 'skill objects must be drawn once /history is there')
})

test('toHistory keeps the whitelist only and never a skill description or a preview', () => {
  const h = toHistory({
    ok: true,
    profiles: [{
      name: 'a', description: 'writes docs', soul: 'SECRET', path: '/x', preview: 'SECRET',
      skills: { own: [{ name: 'figma', category: 'design', tags: ['ui', ''], description: 'SECRET', body: 'SECRET' }], recent: [{ name: 'figma', mtime: NOW_S - 10 }], count: 3, enabled: 2, disabled: 1 },
      lastSession: { title: 't', last_active: NOW_S, source: 'cli', preview: 'SECRET' },
      stats: { firstSeen: NOW_S - 100, inputTokens: 5, cacheReadTokens: 2, prompt: 'SECRET' }
    }],
    boards: [{ slug: 'b', tasks: [{ id: 't', body: 'SECRET' }], runs: [{ profile: 'a', startedAt: 1, endedAt: 2, outcome: 'completed', summary: 'SECRET' }], events: [{ task: 't', kind: 'blocked', ts: 3, payload: 'SECRET' }] }]
  })
  assert.ok(!JSON.stringify(h).includes('SECRET'))
  assert.deepEqual(h.profiles.a.skills.own, [{ name: 'figma', category: 'design', tags: ['ui'] }])
  assert.equal(h.profiles.a.stats.firstSeenMs, (NOW_S - 100) * 1000)
  assert.deepEqual(h.boards[0].runs, [{ profile: 'a', startedMs: 1000, endedMs: 2000, outcome: 'completed' }])
  assert.deepEqual(h.boards[0].events, [{ task: 't', kind: 'blocked', ms: 3000 }])
})

test('toHistory carries the bot default model / provider when present, null when absent', () => {
  const h = toHistory({ ok: true, profiles: [
    { name: 'a', defaultModel: ' example/model-fast ', defaultProvider: 'example' },
    { name: 'b', defaultModel: null, defaultProvider: null },
    { name: 'c', defaultModel: 'x'.repeat(200) }
  ], boards: [] })
  assert.equal(h.profiles.a.defaultModel, 'example/model-fast')
  assert.equal(h.profiles.a.defaultProvider, 'example')
  assert.equal(h.profiles.b.defaultModel, null)
  assert.equal(h.profiles.b.defaultProvider, null)
  assert.equal(h.profiles.c.defaultModel.length, 120)
  assert.equal(h.profiles.c.defaultProvider, null)
})

test('malformed or failed bodies never throw and read as "no history"', () => {
  for (const bad of [undefined, null, 0, 'x', [], {}, { ok: false, error: 'OSError' }, { ok: true, profiles: 'nope' }]) {
    const h = toHistory(bad)
    assert.equal(h.ok, false)
    assert.deepEqual({ ...sceneProfiles(h, office.agents, NOW) }, {})
  }
  const h = toHistory({ ok: true, profiles: [null, 3, {}, { name: ' ' }, { name: 'x', skills: 5, stats: 'no', lastSession: 7 }], boards: [null, {}, { slug: 'b', runs: 4, events: 'no' }] })
  assert.deepEqual(Object.keys(h.profiles), ['x'])
  assert.deepEqual(h.profiles.x.skills.own, [])
  assert.deepEqual(h.boards, [{ slug: 'b', runs: [], events: [] }])
})

test('a backend that only sends the legacy `names` list still gives desk objects (names only); `own` wins when present', () => {
  const h = toHistory({ ok: true, profiles: [
    { name: 'a', skills: { names: ['figma', ' ', 'excalidraw'] } },
    { name: 'b', skills: { own: [{ name: 'pdf', category: 'productivity' }], names: ['ignored'] } }
  ] })
  assert.deepEqual(h.profiles.a.skills.own, [{ name: 'figma', category: '', tags: [] }, { name: 'excalidraw', category: '', tags: [] }])
  assert.deepEqual(h.profiles.b.skills.own.map(s => s.name), ['pdf'])
  const sp = sceneProfiles(h, [{ name: 'a', description: '' }], NOW)
  assert.equal(sp.a.skills.length, 2)
})

test('the roster description wins; /history only fills a missing one; a diploma lasts 7 days', () => {
  const h = toHistory({ ok: true, profiles: [{ name: 'a', description: 'from history', skills: { recent: [{ name: 's', mtime: NOW_S - 6 * 86400 }] } }, { name: 'b', description: 'from history' }] })
  const sp = sceneProfiles(h, [{ name: 'a', description: 'from roster' }, { name: 'b', description: '' }, { name: 'ghost' }], NOW)
  assert.equal(sp.a.description, 'from roster')
  assert.equal(sp.b.description, 'from history')
  assert.equal('ghost' in sp, false)
  assert.equal(sp.a.recentSkill, true)
  assert.equal(hasRecentSkill({ skills: { recent: [{ mtimeMs: NOW - RECENT_SKILL_MS }] } }, NOW), false)
  assert.equal(hasRecentSkill({ skills: { recent: [{ mtimeMs: NOW + 5000 }] } }, NOW), false)   // clock skew never earns a diploma
})

test('without the agent half or without /history: scene rendered, everyone in the common room, outfits from name and roster text, no throw', () => {
  const roster = buildRoster({ profiles: [{ name: 'designer-bot', description: '' }, { name: 'zed', description: 'Writes the blog articles' }, { name: 'nobody' }] }, NOW)
  for (const history of [null, undefined, toHistory({ ok: false })]) {
    const off = buildOffice(roster, null, NOW)          // ctx.rest absent => no /live either
    assert.equal(off.mode, 'roster')
    assert.equal(off.hall.length, 3)
    const model = toSceneModel(off, { nowMs: NOW, profiles: sceneProfiles(history, off.agents, NOW) })
    assert.ok(model.agents.every(a => a.home === null && a.skills.length === 0 && a.recentSkill === false))
    const layout = layoutScene(model)
    const px = drawScene(layout, buildBase(layout, model), model, 0)
    assert.ok(px.d.length > 0)
    assert.equal(needsAnimation(model), false)
    const roles = Object.fromEntries(model.agents.map(a => [a.name, roleOf(a).role]))
    assert.deepEqual(roles, { 'designer-bot': 'designer', zed: 'writer', nobody: null })
  }
})
