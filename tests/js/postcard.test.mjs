// Postcard + game decor on the scene: the export comes from the drawScene buffer (no HUD, no text) and sober mode empties the Decor.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { computeGame, decorOf } from '../../src/core/game.js'
import { buildOffice } from '../../src/core/office.js'
import { buildBase, drawScene, layoutScene, needsAnimation, toSceneModel } from '../../src/scene/index.js'
import { postcardBuffer, postcardName } from '../../src/ui/postcard.js'

const NOW = new Date(2026, 9, 31, 15, 0).getTime()   // 31 Oct: Halloween
const H = 3_600_000
const D = 86_400_000
const desk = (name, extra = {}) => ({ name, label: name, state: 'idle', lastSession: null, workerSession: null, ...extra })
const card = (id, status, title, completedMs = null) => ({ id, title, status, assignee: 'ann', createdAt: (NOW - 30 * D) / 1000, completedAt: completedMs ? completedMs / 1000 : null })
const live = {
  ok: true,
  boards: [
    { slug: 'alpha', createdAt: (NOW - 60 * D) / 1000, tasks: [...Array.from({ length: 10 }, (_, i) => card(`d${i}`, 'done', `SECRET-TITLE ${i}`, NOW - (i + 1) * D)), card('b1', 'blocked', 'SECRET blocked card')] },
    { slug: 'beta', createdAt: (NOW - 20 * D) / 1000, tasks: [card('x1', 'todo', 'SECRET other')] }
  ]
}
const run = (outcome, ms) => ({ profile: 'ann', outcome, startedAt: (ms - 60_000) / 1000, endedAt: ms / 1000 })
const history = {
  ok: true,
  profiles: { ann: { name: 'ann', stats: { firstSeenMs: NOW - 90 * D, inputTokens: 1, cacheReadTokens: 9 } }, bob: { name: 'bob', stats: { firstSeenMs: NOW - 2 * D, inputTokens: 0, cacheReadTokens: 0 } } },
  boards: [{ slug: 'alpha', runs: [run('completed', NOW - 5 * H), run('crashed', NOW - 3 * H), run('timed_out', NOW - 2 * H)].map(r => ({ profile: r.profile, startedMs: r.startedAt * 1000, endedMs: r.endedAt * 1000, outcome: r.outcome })), events: [] }, { slug: 'beta', runs: [], events: [] }]
}

function scene({ sober, selected = null }) {
  const office = buildOffice([desk('ann'), desk('bob')], live, NOW)
  const game = computeGame(history, office, NOW, { sober })
  const model = toSceneModel(office, { nowMs: NOW, night: false, selected, decor: decorOf(game) })
  return { office, game, model, layout: layoutScene(model) }
}

test('the postcard is the drawScene buffer itself: the canvas size, the same bytes, and nothing else', () => {
  const { layout, model } = scene({ sober: false })
  const card_ = postcardBuffer(layout, model)
  const ref = drawScene(layout, buildBase(layout, model), { ...model, selected: null }, 0)
  assert.equal(card_.W, layout.W)
  assert.equal(card_.H, layout.H)
  assert.equal(card_.d.length, layout.W * layout.H * 4)
  assert.ok(Buffer.from(card_.d.buffer, card_.d.byteOffset, card_.d.length).equals(Buffer.from(ref.d.buffer, ref.d.byteOffset, ref.d.length)))
})

test('the postcard never carries the selection ring, whatever is selected on the page', () => {
  const a = scene({ sober: false, selected: null })
  const b = scene({ sober: false, selected: 'ann' })
  const plain = postcardBuffer(a.layout, a.model)
  const picked = postcardBuffer(b.layout, b.model)
  assert.ok(Buffer.from(plain.d).equals(Buffer.from(picked.d)))
  // ...while the live drawing does show it (so the test is not vacuous)
  const live_ = drawScene(b.layout, buildBase(b.layout, b.model), b.model, 0)
  assert.ok(!Buffer.from(live_.d).equals(Buffer.from(picked.d)))
})

test('the export code reads no DOM and no canvas: only the buffer of drawScene (no HUD can leak in)', () => {
  const src = readFileSync(new URL('../../src/ui/postcard.js', import.meta.url), 'utf8')
  const pure = src.slice(src.indexOf('export function postcardBuffer'), src.indexOf('/** `officecraft-'))
  for (const banned of ['document', 'getContext', 'drawImage', 'toDataURL', 'querySelector', 'fillText']) assert.equal(pure.includes(banned), false, `postcardBuffer uses ${banned}`)
  const page = readFileSync(new URL('../../src/ui/OfficeScene.jsx', import.meta.url), 'utf8')
  assert.ok(page.includes('postcardBuffer(live.current.layout, live.current.model)'))
  for (const f of ['OfficePage.jsx', 'GameBar.jsx', 'OfficeScene.jsx']) {
    const text = readFileSync(new URL(`../../src/ui/${f}`, import.meta.url), 'utf8')
    assert.equal(/toDataURL|drawImage|fillText|html2canvas/.test(text), false, `${f} must not rasterise the page`)
  }
  const out = readFileSync(new URL('../../src/ui/postcard.js', import.meta.url), 'utf8')
  assert.equal(/fillText|strokeText|font\s*=/.test(out), false, 'the export draws no text')
})

test('the file name carries the date, the picture carries nothing textual', () => {
  assert.equal(postcardName(Date.UTC(2026, 10, 9, 12)), 'officecraft-2026-11-09.png')
  const { layout, model } = scene({ sober: false })
  assert.equal(JSON.stringify(model.decor).includes('SECRET'), false)
  assert.equal(postcardBuffer(layout, model).d.length, layout.W * layout.H * 4)
})

test('no text reaches the pixels: card titles, display labels and pinned models change no byte of the postcard', () => {
  // Same office (same names, slugs, statuses, dates), every free text swapped: if any of it were drawn (a code on the
  // whiteboard, a title hashed into a sticky note, a label on a desk), the two pictures would differ.
  const swap = (title, model) => ({
    ok: true,
    boards: live.boards.map(b => ({ ...b, tasks: b.tasks.map(t => ({ ...t, title: title(t), modelOverride: model, providerOverride: model })) }))
  })
  const picture = (title, label, model) => {
    const office = buildOffice([desk('ann', { label }), desk('bob', { label })], swap(title, model), NOW)
    const game = computeGame(history, office, NOW, {})
    const model_ = toSceneModel(office, { nowMs: NOW, night: false, decor: decorOf(game) })
    return Buffer.from(postcardBuffer(layoutScene(model_), model_).d)
  }
  const a = picture(t => `SECRET-TITLE ${t.id}`, 'Ann', null)
  // one character longer than `a`, labels that read like roles (designer, security): neither may reach the drawing
  const b = picture(t => `XSECRET-TITLE ${t.id}`, 'Senior frontend designer and security reviewer', 'some/pinned-model')
  const c = picture(() => '', '', null)
  assert.ok(a.equals(b), 'a card title, a label or a pinned model changed the postcard pixels')
  assert.ok(a.equals(c), 'empty titles and labels draw the same postcard')
})

test('game decor is fed by computeGame: incident, season, mascot, trophies and the moving box are in the drawing', () => {
  const { game, model } = scene({ sober: false })
  assert.equal(model.decor.sober, false)
  assert.deepEqual(model.decor.incidentBoards, ['alpha'])
  assert.equal(model.decor.season, 'halloween')
  assert.equal(model.decor.mascotMood, 'hide')
  assert.deepEqual(model.decor.achievements, ['thrifty', 'hire', 'builder'])
  assert.deepEqual(model.decor.recruits, ['bob'])
  assert.equal(game.office.done, 10)
})

test('sober mode empties the Decor: the drawing is the plain office, byte for byte, and nothing animates for the game', () => {
  const game = scene({ sober: false })
  const sober = scene({ sober: true })
  const plainOffice = buildOffice([desk('ann'), desk('bob')], live, NOW)
  const plain = toSceneModel(plainOffice, { nowMs: NOW, night: false })   // no decor at all
  assert.equal(sober.model.decor.sober, true)
  assert.deepEqual([...sober.model.decor.incidentBoards, ...sober.model.decor.achievements, ...sober.model.decor.recruits], [])
  assert.equal(sober.model.decor.season, null)
  assert.equal(sober.model.decor.mascotMood, null)
  const withGame = postcardBuffer(game.layout, game.model)
  const withSober = postcardBuffer(sober.layout, sober.model)
  const withNone = postcardBuffer(layoutScene(plain), plain)
  assert.ok(Buffer.from(withSober.d).equals(Buffer.from(withNone.d)), 'sober = no decor at all')
  assert.ok(!Buffer.from(withGame.d).equals(Buffer.from(withSober.d)), 'game mode draws something sober mode does not')
  // an alert cat (a decision waits) animates the scene in game mode only
  const calm = buildOffice([desk('ann')], { ok: true, boards: [{ slug: 'a', tasks: [card('b', 'blocked', 't')] }] }, NOW)
  const inGame = toSceneModel(calm, { nowMs: NOW, decor: decorOf(computeGame(null, calm, NOW, {})) })
  assert.equal(needsAnimation({ ...inGame, agents: inGame.agents.map(a => ({ ...a, state: 'idle' })) }), true)
  const inSober = toSceneModel(calm, { nowMs: NOW, decor: decorOf(computeGame(null, calm, NOW, { sober: true })) })
  assert.equal(needsAnimation({ ...inSober, agents: inSober.agents.map(a => ({ ...a, state: 'idle' })) }), false)
})
