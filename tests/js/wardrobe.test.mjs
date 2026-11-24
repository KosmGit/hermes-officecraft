// Role detection must adapt to any bot setup, in any common language.
// The catalogue is the engine's own (src/scene/wardrobe.js), imported as is.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ROLES, ROLE_IDS, detectRole, outfitOf, roleOf } from '../../src/scene/wardrobe.js'

const role = (name, description = '', names = []) => detectRole({ name, description, skills: { names } })?.id ?? null

test('a French-speaking team (French names and descriptions)', () => {
  assert.equal(role('coordinatrice', "Pilotage : découpe un objectif en étapes et confie chacune au bon profil"), 'manager')
  assert.equal(role('frontend', 'Intégration des écrans : interface HTML et CSS, composants, animations'), 'designer')
  assert.equal(role('backend', 'Services et stockage : API, migrations, tâches planifiées'), 'developer')
  assert.equal(role('reviewer', 'Relit chaque changement avant fusion : qualité, tests'), 'reviewer')
  assert.equal(role('plume', 'Rédige les notes de version et le contenu du guide'), 'writer')
  assert.equal(role('seo', 'Référencement des pages : mots-clés et balises'), 'marketer')
  assert.equal(role('boutique', "Monétisation de l'application : offres payantes et suivi des vendeurs"), 'sales')
  assert.equal(role('vigie', 'Veille et recherche : suit les nouvelles versions des bibliothèques'), 'researcher')
})

test('other languages, by name, description or skill', () => {
  assert.equal(role('ceo', 'Chief executive: sets priorities.'), 'executive')
  assert.equal(role('diseñadora', 'Diseño de interfaces y tipografía.'), 'designer')
  assert.equal(role('entwickler', 'Backend-Entwicklung: APIs und Deployment.'), 'developer')
  assert.equal(role('revisora', 'Revisión de código, pruebas y seguridad.'), 'reviewer')
  assert.equal(role('vendite', 'Vendite e partnership con i rivenditori.'), 'sales')
  assert.equal(role('データ係', 'データ分析とレポート作成を担当。'), 'data')
  assert.equal(role('helper', 'Customer support: answers tickets, writes help-center articles.'), 'support')
  assert.equal(role('tresorerie', 'Factures, comptabilité et suivi des dépenses.'), 'finance')
  assert.equal(role('bob', '', ['security-review', 'code-review']), 'reviewer')
  assert.equal(role('analyst', 'Market research and competitor monitoring with sources.'), 'researcher')
})

test('short keywords match whole words only', () => {
  assert.equal(role('guild master', 'gossip about the latest ideal descriptions'), null)   // no "ui", "ops", "test", "deal", "script"
  assert.equal(role('ops'), 'devops')
  assert.equal(role('ui-bot'), 'designer')
})

test('no clue = no role, but still a composed outfit that varies with the name', () => {
  assert.equal(role('x7'), null)
  const a = outfitOf({ name: 'x7' }), b = outfitOf({ name: 'zeta' })
  assert.equal(a.role, null)
  assert.ok(a.label && b.label)
})

test('every role is reachable from its first keyword and dresses with a label', () => {
  assert.ok(ROLE_IDS.length >= 12)
  for (const id of ROLE_IDS) {
    assert.equal(role('n', ROLES[id].keys[0].replace(/^=/, '')), id, id)
    assert.ok(outfitOf({ name: 'n', description: ROLES[id].keys[0] }).label, id)
  }
})

test('stems match at word starts: ordinary words do not change the role', () => {
  for (const d of ['Keeps information up to date', 'validation and recommendations', 'mandatory updating', 'excellent results',
    'handles authorization', 'prevented outages', 'emotional promotion copy', 'trusted partner', 'directory cleanup', 'manufacturing notes',
    'renseigne les fiches', 'biographies and geography', 'encoding helpers', 'leaderboard', 'Escritorio limpio'])
    assert.notEqual(role('x', d), detectRoleWithout(d), d)
})
function detectRoleWithout(d){ return { 'Keeps information up to date': 'teacher', 'validation and recommendations': 'data', 'mandatory updating': 'data',
  'excellent results': 'data', 'handles authorization': 'writer', 'prevented outages': 'sales', 'emotional promotion copy': 'designer', 'trusted partner': 'developer',
  'directory cleanup': 'executive', 'manufacturing notes': 'finance', 'renseigne les fiches': 'teacher', 'biographies and geography': 'designer',
  'encoding helpers': 'developer', leaderboard: 'manager', 'Escritorio limpio': 'writer' }[d] }

test('names that used to get a wrong role', () => {
  for (const n of ['information', 'intelligence', 'directory', 'trustee', 'leaderboard']) assert.equal(role(n), null, n)
  assert.equal(role('team-lead'), 'manager')
  assert.equal(role('excel-wizard'), 'data')
  assert.equal(role('formation'), 'teacher')
})

test('a role override that names an inherited key is not a role: detection runs and the outfit draws', () => {
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) {
    const agent = { name: 'alpha', description: '', skills: [], roleOverride: name }
    assert.notEqual(roleOf(agent).why.kind, 'manual', name)
    assert.ok(roleOf(agent).role === null || Object.hasOwn(ROLES, roleOf(agent).role), name)
    assert.doesNotThrow(() => outfitOf(agent), name)
  }
  assert.deepEqual(roleOf({ name: 'alpha', description: '', skills: [], roleOverride: ROLE_IDS[0] }), { role: ROLE_IDS[0], why: { kind: 'manual' } })
  assert.equal(roleOf({ name: 'alpha', description: '', skills: [], roleOverride: 'none' }).role, null)
})
