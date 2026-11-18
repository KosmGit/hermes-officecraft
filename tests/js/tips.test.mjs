import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildOffice } from '../../src/core/office.js'
import { buildRoster } from '../../src/core/roster.js'
import { translate } from '../../src/core/translate.js'
import { badgeTip, clockText, tipOf } from '../../src/core/tips.js'
import { messages } from '../../src/i18n/index.js'
import { hotspots, layoutScene, toSceneModel } from '../../src/scene/index.js'

// ===== tips =====
{
const NOW = 1_800_000_000_000
const s = ms => ms / 1000
const LANGS = ['en', 'fr', 'es']
// strings that must never reach a tooltip: planted in every field a card, a cron or a platform could carry
const PLANTED = ['SECRET-BODY', 'SECRET-PROMPT', '/home/secret/path', 'sk-live-secret', 'SECRET-SCRIPT']

const desks = buildRoster({ profiles: [{ name: 'a', model: 'm', provider: 'p', last_session: null, worker_session: null }, { name: 'b', last_session: null, worker_session: null }] }, NOW)
function officeWith(boards, ops) {
  return buildOffice(desks, { ok: true, boards, ops }, NOW)
}
const secretCard = (id, status) => ({ id, title: `${id} SECRET-BODY`, status, assignee: 'a', createdAt: s(NOW - 1e6), body: 'SECRET-BODY', result: 'SECRET-BODY', path: '/home/secret/path' })
const ops = {
  gateway: { state: 'degraded', platforms: [{ name: 'telegram', state: 'connected' }, { name: 'discord SECRET-PROMPT', state: 'retrying' }] },
  crons: [{ name: 'nightly', profile: 'a', schedule_display: 'daily', enabled: true, last_status: 'error', prompt: 'SECRET-PROMPT', script: 'SECRET-SCRIPT' }, { name: 'paused', enabled: false }]
}
const full = officeWith([
  { slug: 'alpha', tasks: [secretCard('A1', 'done'), secretCard('A2', 'blocked')] },
  { slug: 'beta', tasks: [secretCard('B1', 'running')] }
], ops)

const ctx = lang => ({ readMs: NOW, lang, night: true, lightForced: false })
const render = (parts, lang) => (parts ? translate(messages, lang, parts[0], parts.slice(1)) : '')
const fullText = (tp, lang) => [tp.name, tp.fact, tp.extra, tp.source].map(p => render(p, lang)).join(' | ')

function spotsOf(office) {
  const model = toSceneModel(office, { nowMs: NOW })
  return hotspots(layoutScene(model), model)
}

test('hotspots: the whiteboard of every board, the electrical panel, the mail, the night-shift board, the clock, and your desk (no lamp any more)', () => {
  const spots = spotsOf(full)
  const kinds = spots.map(x => x.kind)
  assert.equal(kinds.filter(k => k === 'board').length, 2)
  for (const k of ['gateway', 'mail', 'crons', 'clock', 'desk']) assert.equal(kinds.filter(x => x === k).length, 1, k)
  assert.equal(kinds.filter(k => k === 'lamp').length, 0, 'the lamps were removed (they carried no fact of their own)')
  assert.equal(new Set(spots.map(x => x.id)).size, spots.length, 'ids are unique')
  for (const sp of spots) {
    assert.ok(sp.factKey.startsWith('tip.'), sp.id)
    assert.ok(sp.rect.w >= 14 && sp.rect.h >= 14, `${sp.id} is big enough to hover and focus`)
    assert.ok(Number.isInteger(sp.rect.x) && Number.isInteger(sp.rect.y), sp.id)
  }
})

test('hotspots: 0 boards still has its fixed objects; 8 boards give 8 whiteboards; same input, same zones', () => {
  assert.deepEqual(spotsOf(officeWith([], null)).map(x => x.kind).filter(k => k === 'board'), [])
  assert.ok(spotsOf(officeWith([], null)).some(x => x.kind === 'clock'))
  const eight = officeWith(Array.from({ length: 8 }, (_, i) => ({ slug: `b${i}`, tasks: [secretCard(`T${i}`, 'todo')] })), ops)
  assert.equal(spotsOf(eight).filter(x => x.kind === 'board').length, 8)
  assert.deepEqual(spotsOf(eight), spotsOf(eight))
})

test('hotspots lie inside the art (a zone outside the canvas would be unreachable)', () => {
  const model = toSceneModel(full, { nowMs: NOW })
  const layout = layoutScene(model)
  for (const sp of hotspots(layout, model)) {
    assert.ok(sp.rect.x >= -2 && sp.rect.y >= -2 && sp.rect.x + sp.rect.w <= layout.W + 2 && sp.rect.y + sp.rect.h <= layout.H + 2, `${sp.id} ${JSON.stringify(sp.rect)} in ${layout.W}x${layout.H}`)
  }
})

test('one tooltip per hotspot, each with a name, a fact and a source, in every language', () => {
  const spots = spotsOf(full)
  for (const lang of LANGS) {
    const tips = spots.map(sp => tipOf(sp, full, ctx(lang)))
    assert.equal(tips.length, spots.length)
    for (const tp of tips) {
      for (const part of [tp.name, tp.fact, tp.source]) {
        assert.ok(part && messages.en && render(part, lang).length > 0, JSON.stringify(part))
        assert.notEqual(render(part, lang), part[0], `${lang}: ${part[0]} is not translated`)
      }
    }
  }
})

test('no tooltip contains a forbidden datum (card body, cron prompt/script, path, key), whatever the state', () => {
  const variants = [
    full,
    officeWith([{ slug: 'alpha', tasks: [secretCard('A1', 'blocked')] }], { gateway: { state: 'stopped', platforms: [] }, crons: [] }),
    officeWith([{ slug: 'alpha', tasks: [] }], { gateway: { state: 'startup_failed', platforms: [{ name: 'x', state: 'connected' }] }, crons: ops.crons }),
    buildOffice(desks, null, NOW)   // roster-only mode
  ]
  for (const office of variants) {
    for (const lang of LANGS) {
      for (const night of [true, false]) {
        for (const sp of spotsOf(office)) {
          const text = fullText(tipOf(sp, office, { ...ctx(lang), night, lightForced: night }), lang)
          for (const bad of PLANTED) assert.ok(!text.includes(bad), `${sp.id}/${lang}: ${bad}`)
        }
      }
    }
  }
})

test('the templates themselves name no forbidden data', () => {
  const FORBIDDEN = /\b(prompt|script|preview|soul|password|passwd|secret|token|api[_ -]?key|path|body|comment|message content)\b/i
  const walk = (node, trail, lang) => {
    for (const [k, v] of Object.entries(node)) {
      const at = `${lang}.${trail}${k}`
      if (v && typeof v === 'object') walk(v, `${trail}${k}.`, lang)
      else {
        const text = typeof v === 'function' ? v('X', 2, 3) : v
        assert.ok(!FORBIDDEN.test(String(text)), `${at}: ${text}`)
      }
    }
  }
  for (const lang of LANGS) {
    walk(messages[lang].tip, 'tip.', lang)
    walk(messages[lang].spot, 'spot.', lang)
  }
})

test('board tooltip: « 12/30 cards done » with its source and read time; blocked count only when there are some', () => {
  const sp = spotsOf(full).find(x => x.id === 'board:alpha')
  const tp = tipOf(sp, full, ctx('en'))
  assert.equal(render(tp.fact, 'en'), '1/2 cards done, 1 blocked')
  const src = render(tp.source, 'en')
  assert.match(src, /^kanban alpha, read at /)
  assert.ok(src.includes(clockText(NOW, 'en')))
  const calm = officeWith([{ slug: 'alpha', tasks: [secretCard('A1', 'done')] }], null)
  assert.equal(render(tipOf(spotsOf(calm).find(x => x.kind === 'board'), calm, ctx('fr')).fact, 'fr'), '1/1 cartes terminées')
})

test('gateway, mail, crons, desk, clock cite the right facts and sources', () => {
  const by = id => spotsOf(full).find(x => x.id === id)
  assert.match(render(tipOf(by('gateway'), full, ctx('en')).fact, 'en'), /degraded/)
  assert.equal(render(tipOf(by('mail'), full, ctx('en')).fact, 'en'), '2 messaging platforms: 1 connected, 1 reconnecting or failing')
  assert.equal(render(tipOf(by('crons'), full, ctx('en')).fact, 'en'), '1 active scheduled job, 1 failing')
  assert.equal(render(tipOf(by('desk'), full, ctx('en')).fact, 'en'), '1 decision waits for you (a blocked card).')
  assert.match(render(tipOf(by('clock'), full, ctx('en')).fact, 'en'), /shows \d/)
})

test('a gateway state this page does not know is said as unknown, never a raw i18n key', () => {
  const odd = officeWith([], { gateway: { state: 'hibernating', platforms: [] }, crons: [] })
  const sp = spotsOf(odd).find(x => x.kind === 'gateway')
  for (const lang of LANGS) assert.equal(render(tipOf(sp, odd, ctx(lang)).fact, lang), render(['tip.gateway.unknown'], lang))
})

test('roster-only mode: infrastructure tooltips say the agent half is missing instead of inventing a state', () => {
  const roster = buildOffice(desks, null, NOW)
  for (const kind of ['gateway', 'mail', 'crons']) {
    const sp = spotsOf(roster).find(x => x.kind === kind)
    const tp = tipOf(sp, roster, ctx('en'))
    assert.match(render(tp.source, 'en'), /agent half/)
    assert.match(render(tp.fact, 'en'), /not known/)
  }
})

test('model badge tooltip: card, models and source, as the card words it', () => {
  const b = { name: 'a', label: 'a', code: 'S3.2', card: 'example/model-large', default: 'example/model-fast', actual: null, board: 'beta' }
  const tp = badgeTip(b)
  assert.equal(render(tp.fact, 'en'), 'Card S3.2: example/model-large — the bot’s default model: example/model-fast')
  assert.equal(render(tp.fact, 'fr'), 'Carte S3.2 : example/model-large — modèle par défaut du bot : example/model-fast')
  assert.equal(render(tp.source, 'en'), 'kanban beta, card S3.2')
  assert.equal(tp.extra, null)
  assert.match(render(badgeTip({ ...b, actual: 'model-xl' }).extra, 'es'), /model-xl/)
  for (const lang of LANGS) assert.ok(render(badgeTip(b).name, lang).includes('a'))
})

test('clockText: hours and minutes in the plugin language, empty without a time', () => {
  assert.match(clockText(NOW, 'en'), /\d{1,2}:\d{2}/)
  assert.equal(clockText(null, 'en'), '')
})

test('model badge tooltip: an unknown default model is said, not invented (profiles.list may send an empty model)', () => {
  const tp = badgeTip({ name: 'a', code: 'S3.2', card: 'example/model-large', default: '', board: 'b' })
  assert.match(render(tp.fact, 'en'), /default model is not known$/)
  assert.match(render(tp.fact, 'fr'), /inconnu$/)
  assert.match(render(tp.fact, 'es'), /desconocido$/)
})
}

// ===== tips =====
{
// `needsAttention` of a messaging platform is served and read: it must be shown too. The mail tooltip says it.
const NOW = 1_800_000_000_000
const desks = buildRoster({ profiles: [{ name: 'a', last_session: null, worker_session: null }] }, NOW)
const officeOf = platforms => buildOffice(desks, { ok: true, boards: [], ops: { gateway: { state: 'running', platforms }, crons: [] } }, NOW)
const render = (parts, lang) => (parts ? translate(messages, lang, parts[0], parts.slice(1)) : '')
const mailTip = office => {
  const model = toSceneModel(office, { nowMs: NOW })
  return tipOf(hotspots(layoutScene(model), model).find(x => x.kind === 'mail'), office, { readMs: NOW, lang: 'en', night: false, lightForced: false })
}

test('one platform to reconnect -> « 1 messaging platform to reconnect » (EN, FR, ES), none -> nothing added', () => {
  const one = mailTip(officeOf([{ name: 'telegram', state: 'connected' }, { name: 'slack', state: 'retrying', needsAttention: true }]))
  assert.equal(render(one.extra, 'en'), '1 messaging platform to reconnect')
  assert.equal(render(one.extra, 'fr'), '1 messagerie à reconnecter')
  assert.equal(render(one.extra, 'es'), '1 plataforma de mensajería por reconectar')
  const two = mailTip(officeOf([{ name: 'a', state: 'x', needsAttention: true }, { name: 'b', state: 'x', needsAttention: true }]))
  assert.equal(render(two.extra, 'en'), '2 messaging platforms to reconnect')
  assert.equal(render(two.extra, 'fr'), '2 messageries à reconnecter')
  assert.equal(mailTip(officeOf([{ name: 'telegram', state: 'connected' }])).extra ?? null, null)
})
}
