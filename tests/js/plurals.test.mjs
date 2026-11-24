import assert from 'node:assert/strict'
import { test } from 'node:test'

import { translate } from '../../src/core/translate.js'
import { messages } from '../../src/i18n/index.js'

/**
 * The keys that carry a count, with the arguments that make `n` the counted number. Every one reads « 1 card » for one and keeps its
 * plural otherwise, in the three languages (the same `n === 1` branch as the keys that were already right).
 * A key that takes a count and is missing here is not covered: add it.
 */
const n = (...rest) => c => [c, ...rest]
const second = (first, ...rest) => c => [first, c, ...rest]
const KEYS = {
  tipCards: n('alpha, beta'),
  'campaign.afterN': n(),
  'campaign.graph.label': n(),
  'campaign.groupAria': second('A, B'),
  'campaign.groupTip': n('A, B'),
  'campaign.groupFold': second('A, B'),
  'campaign.create': n('website'),
  'campaign.createNew': n('website'),
  'campaign.tpl.room': n(),
  'orders.effect.comment': n(),
  'orders.effect.cancel': n(),
  'orders.done.campaign': second('website'),
  'campaign.created.body': second(5),
  'game.levelTop': n(),
  'game.toast.many': n(),
  'game.collection.summary': n(9),
  'game.fact.chain': second('website'),
  'game.fact.centurion': second('website'),
  'game.fact.owl': second('website'),
  'game.fact.hire': n(),
  'game.fact.builder': n(),
  'game.fact.wide': n(),
  'game.fact.versatile': second('alpha'),
  'game.fact.iron': second('website'),
  'game.fact.present': n(),
  'game.fact.noqueue': n(),
  'game.fact.veteran': n(),
  'game.fact.zero': n(),
  'game.fact.smooth': second('website'),
  'game.fact.architect': second('website'),
  'game.fact.teamwork': second('website'),
  'game.fact.multimodel': second('website'),
  'game.fact.ontime': n(),
  'game.fact.firstpass': n(),
  'game.fact.swiss': second('nightly'),
  'game.fact.fullteam': n(),
  'game.fact.quiet': n(),
  'notify.maxRoutes': n(),
  'notify.hint': n(),
  'recruit.model.count': c => [c, c],
  'recruit.skillsSum': n(8),
  'replay.night.usageLine': c => [c, c, c],
  'replay.night.agentRuns': c => [2, c],
  'replay.night.ordersDetail': c => [c, c, c],
  'replay.state': c => [c, c, 0],
  'usage.exact': n(),
  'usage.days.bar': second('Mon 3'),
  'usage.days.detail': second('Mon 3'),
  'usage.models.calls': n(),
  'usage.models.aux': n(),
  'llm.spendCalls': n(1),
  'llm.gaugeCalls': c => [c, c],
  'llm.ref.capCalls': c => [c, c],
  'llm.soul.written': n(),
  'llm.body.current': n(),
  'llm.lint.reading': n(),
  'ux.badge.levelTip': n(9),
  'ux.prj.queue': n(),
  'insp.more': n(),
  'inbox.more': n(),
  'campaign.issue.more': n(),
  'recruit.model.more': n()
}

// what a plural noun after « 1 » looks like, per language (the words these keys count)
const PLURAL = {
  en: /\b1 (?:[a-z]+ )?(?:cards|calls|characters|chars|tokens|models|recipients|projects|days|profiles|messages|bots|roles|runs|trophies|links)\b/i,
  fr: /\b1 (?:[a-zé]+ )?(?:cartes|liens|appels|caractères|jetons|modèles|destinataires|projets|jours|profils|messages|bots|rôles|exécutions|trophées|autres|propres)\b/i,
  es: /\b1 (?:[a-zé]+ )?(?:tarjetas|enlaces|llamadas|caracteres|tokens|modelos|destinatarios|proyectos|días|perfiles|mensajes|bots|roles|ejecuciones|trofeos|propios)\b/i
}

// the keys whose number reaches them already formatted (text)
const TEXT_COUNT = new Set(['usage.exact', 'usage.days.bar', 'usage.days.detail', 'usage.models.calls', 'replay.night.usageLine', 'replay.night.agentRuns'])
// wordings that do not change with the count in that language (the unit is invariable or not written)
const SAME = {
  en: new Set(['game.collection.summary', 'insp.more', 'inbox.more', 'campaign.issue.more', 'recruit.model.more', 'usage.models.aux', 'recruit.skillsSum', 'replay.state', 'replay.night.ordersDetail']),
  fr: new Set(['llm.soul.written', 'llm.body.current']),
  es: new Set(['llm.soul.written', 'llm.body.current', 'insp.more', 'inbox.more', 'campaign.issue.more', 'recruit.model.more', 'usage.boards.without'])
}

const at = (lang, key, args) => translate(messages, lang, key, args)

test('no count of one is written in the plural, in any language', () => {
  for (const lang of Object.keys(PLURAL)) {
    for (const [key, args] of Object.entries(KEYS)) {
      for (const one of TEXT_COUNT.has(key) ? [1, '1'] : [1]) {
        const out = at(lang, key, args(one))
        assert.ok(!PLURAL[lang].test(out), `${lang}.${key}(1) -> ${out}`)
      }
    }
  }
})

test('the plural stays the plural from two', () => {
  for (const lang of Object.keys(PLURAL)) {
    for (const [key, args] of Object.entries(KEYS)) {
      if (SAME[lang].has(key)) continue
      const one = at(lang, key, args(1))
      const two = at(lang, key, args(2))
      assert.notEqual(one.replace(/1/g, '#'), two.replace(/2/g, '#'), `${lang}.${key} reads the same for 1 and 2: ${one}`)
    }
  }
})

test('a formatted count (text) and a number branch the same way', () => {
  for (const lang of Object.keys(PLURAL)) {
    for (const key of ['usage.exact', 'usage.models.calls', 'replay.night.usageLine']) {
      assert.equal(at(lang, key, KEYS[key]('1')), at(lang, key, KEYS[key](1)), `${lang}.${key}`)
      assert.notEqual(at(lang, key, KEYS[key]('1 234')), at(lang, key, KEYS[key]('1')), `${lang}.${key} 1 234`)
    }
  }
})

test('the three languages agree on the exact singular wording of the keys fixed here', () => {
  assert.equal(at('en', 'usage.models.calls', ['1']), '1 call')
  assert.equal(at('en', 'ux.prj.queue', [1]), 'Last card')
  assert.equal(at('en', 'orders.effect.comment', [1]).includes('(1 character)'), true)
  assert.equal(at('fr', 'usage.exact', ['1']), '1 jeton')
  assert.equal(at('fr', 'ux.prj.queue', [1]), 'Dernière carte')
  assert.equal(at('es', 'usage.models.calls', ['1']), '1 llamada')
  assert.equal(at('es', 'ux.prj.queue', [1]), 'Última tarjeta')
})
