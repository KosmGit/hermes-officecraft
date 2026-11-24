// Who waits for a decision, and on what: the sign on a bot at work that also has a blocked card (scene label, team list, legend, names for
// the screen reader), the title instead of the id, the reason a bot gave, and the decision card that shows it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { taskTag, waitBearers, waitSign } from '../../src/core/hud.js'
import { buildOffice } from '../../src/core/office.js'
import { translate } from '../../src/core/translate.js'
import { messages } from '../../src/i18n/index.js'
import { labelOf } from '../../src/scene/labels.js'
import { STATE_ICONS } from '../../src/scene/stateicons.js'

const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const NOW = 1_800_000_000_000
const s = ms => ms / 1000
const tr = lang => (key, ...args) => translate(messages, lang, key, args)

const desk = (name, state) => ({ name, label: name, state, model: 'example/model-fast' })
const card = (id, status, assignee, extra = {}) => ({ id, title: `${id} title`, status, assignee, createdAt: s(NOW - 7_200_000), startedAt: s(NOW - 3_600_000), heartbeatAt: status === 'running' ? s(NOW - 20_000) : null, ...extra })
const office = (desks, boards) => buildOffice(desks, { ok: true, boards }, NOW)
const by = (o, name) => o.agents.find(a => a.name === name)

// ===== the sign =====

test('waitSign: a bot at work with a blocked card carries it; 0, 1 or several cards; a bot already waiting says it by its state', () => {
  const o = office(
    [desk('alpha', 'working'), desk('beta', 'working'), desk('gamma', 'working'), desk('delta', 'idle'), desk('lone', 'active'), desk('quiet', 'working')],
    [{ slug: 'website', tasks: [
      card('a1', 'running', 'alpha'), card('a2', 'blocked', 'alpha'),                                  // at work + 1 blocked
      card('b1', 'running', 'beta'), card('b2', 'blocked', 'beta'), card('b3', 'blocked', 'beta'),     // at work + 2 blocked
      card('g1', 'running', 'gamma'),                                                                   // at work, nothing blocked
      card('d1', 'blocked', 'delta'),                                                                   // not at work: the state itself is « waiting »
      // `quiet` runs a card that went silent AND has a blocked one: both signs
      card('q1', 'running', 'quiet', { heartbeatAt: s(NOW - 40 * 60_000) }), card('q3', 'running', 'quiet'), card('q2', 'blocked', 'quiet')
    ] }]
  )
  assert.equal(by(o, 'alpha').state, 'working')
  assert.equal(waitSign(by(o, 'alpha')), true, '1 blocked card')
  assert.equal(waitSign(by(o, 'beta')), true, 'several blocked cards')
  assert.equal(waitSign(by(o, 'gamma')), false, '0 blocked card')
  assert.equal(by(o, 'delta').state, 'waiting')
  assert.equal(waitSign(by(o, 'delta')), false, 'a waiting bot has its state, not the sign on top of it')
  assert.equal(waitSign(by(o, 'lone')), false, 'a bot with no card at all (no project)')
  assert.equal(by(o, 'lone').home, null)
  assert.equal(waitSign(by(o, 'quiet')), true, 'a bot with a silent card still carries the sign')
  assert.equal(by(o, 'quiet').quiet.length, 1)
  for (const bad of [null, undefined, {}, { state: 'working' }, { state: 'working', blocked: [] }, { state: 'working', blocked: 'x' }]) assert.equal(waitSign(bad), false)
})

test('waitBearers: the bots that say « a decision waits » on screen are exactly the bots with a blocked card', () => {
  const o = office(
    [desk('alpha', 'working'), desk('beta', 'working'), desk('gamma', 'idle'), desk('delta', 'idle'), desk('lone', 'new')],
    [{ slug: 'website', tasks: [card('a1', 'running', 'alpha'), card('a2', 'blocked', 'alpha'), card('b1', 'running', 'beta'), card('g1', 'blocked', 'gamma'), card('g2', 'blocked', 'gamma'), card('d1', 'done', 'delta')] },
      { slug: 'docs', tasks: [card('x1', 'blocked', null)] }]   // a blocked card nobody owns (a campaign's guard): no bot carries it
  )
  const withBlocked = o.agents.filter(a => a.blocked.length > 0).map(a => a.name)
  assert.deepEqual(withBlocked, ['alpha', 'gamma'])
  assert.deepEqual(waitBearers(o.agents).map(a => a.name), withBlocked, 'sign + waiting state = every bot that has a blocked card')
  assert.deepEqual(waitBearers([]), [])
  assert.deepEqual(waitBearers(null), [])
})

test('the tag and the label: only a bot at work carries `wait`; the label keeps its name and code; the state stays the main one', () => {
  const o = office([desk('alpha', 'working'), desk('beta', 'idle')], [{ slug: 'website', tasks: [card('a1', 'running', 'alpha', { title: 'WEB4 — Redesign' }), card('a2', 'blocked', 'alpha'), card('b1', 'blocked', 'beta')] }])
  const alpha = by(o, 'alpha')
  const tag = taskTag(alpha, NOW)
  assert.equal(tag.kind, 'working')
  assert.equal(tag.wait, 1)
  assert.deepEqual(labelOf(alpha, tag), { name: 'alpha', code: 'WEB4', wait: true })
  assert.equal(alpha.state, 'working', 'the state, so the outline, the ring on the floor and the selection hue, is still « working »')
  const beta = by(o, 'beta')
  assert.equal(taskTag(beta, NOW).kind, 'waiting')
  assert.equal(taskTag(beta, NOW).wait, undefined)
  assert.equal(labelOf(beta, taskTag(beta, NOW)).wait, undefined)
  // nothing blocked: the tag is what it was, key for key
  const plain = office([desk('g', 'working')], [{ slug: 'website', tasks: [card('g1', 'running', 'g')] }]).agents[0]
  assert.deepEqual(Object.keys(taskTag(plain, NOW)).sort(), ['kind', 'ref', 'span'])
})

test('the sign is drawn with the state icons of the scene (no character), the state colours stay the main state\'s', () => {
  const scene = src('src/ui/OfficeScene.jsx')
  assert.equal([...scene.matchAll(/<span className="oc-wait" data-wait aria-hidden="true"><StateIcon state="waiting" \/><\/span>/g)].length, 2, 'the label of the scene and the row of the list')
  assert.match(src('src/ui/AgentTab.jsx'), /className="ux-wait"[^>]*><StateIcon state="waiting" \/>/, 'the row of the team list')
  assert.ok(STATE_ICONS.waiting.some(r => r.includes('#')), 'the « ! » is a pixel icon')
  const css = src('src/ui/sceneStyles.js')
  const rule = css.match(/\.oc-wait\{[^}]*\}/)[0]
  assert.match(rule, /color:\$\{ink\(ORANGE\)\}/)
  const waitRules = css.split('\n').filter(l => l.includes('.oc-wait'))
  assert.ok(waitRules.length >= 2)
  for (const l of waitRules) assert.doesNotMatch(l, /oc-s-|--sel|border-color|outline/, 'the sign never touches the outline, the ring or the selection hue of the main state')
  assert.doesNotMatch(rule, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no colour literal')
})

test('the accessible name says it, in the three languages; the legend has the entry', () => {
  const scene = src('src/ui/OfficeScene.jsx')
  assert.match(scene, /const said = wait \? `\$\{state\}, \$\{wait\}` : state/)
  assert.match(scene, /label: `\$\{a\.label \|\| a\.name\} — \$\{said\}\./)
  assert.match(src('src/ui/Legend.jsx'), /data-legend-sign="wait"/)
  const one = { en: 'a decision is waiting for you', fr: 'une décision vous attend', es: 'una decisión te espera' }
  for (const lang of ['en', 'fr', 'es']) {
    assert.equal(tr(lang)('waitTip', 1), one[lang])
    assert.match(tr(lang)('waitTip', 3), /3/)
    for (const k of ['legend.waitName', 'legend.waitSign']) assert.ok(tr(lang)(k).length > 8, `${lang} ${k}`)
  }
  assert.equal(`${tr('fr')('state.working')}, ${tr('fr')('waitTip', 1)}`, 'Au travail, une décision vous attend')
})
