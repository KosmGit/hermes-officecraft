import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { followTitle, hireDraft } from '../../src/core/recruit.js'
import { messages } from '../../src/i18n/index.js'
import { DIALOG_CSS } from '../../src/ui/dialogStyles.js'

// What the action windows say and how they are laid out: the recruitment, the campaign, resources, the replay, the showcase.
const src = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')
const LANGS = ['en', 'fr', 'es']
const rule = (css, sel) => css.split('\n').find(l => l.startsWith(`${sel}{`)) ?? ''

/* ---------- recruitment ---------- */
test('the identifier follows the display title until it is written by hand', () => {
  const d = hireDraft([])
  assert.deepEqual(followTitle(d, 'Designer UI'), { name: 'designer-ui' })
  assert.deepEqual(followTitle({ ...d, title: 'Designer UI', name: 'designer-ui' }, 'Designer UI 2'), { name: 'designer-ui-2' }, 'still the slug of the previous title')
  assert.deepEqual(followTitle({ ...d, title: 'Designer UI', name: 'ui' }, 'Designer'), {}, 'typed by hand: left alone')
  assert.deepEqual(followTitle({ ...d, title: 'Designer', name: 'custom' }, ''), {}, 'a title cleared does not erase a typed identifier')
  assert.deepEqual(followTitle({ ...d, title: 'Designer', name: 'designer' }, ''), { name: '' }, 'a followed identifier follows the title down to nothing')
  assert.deepEqual(followTitle(d, 'Éric — Lead'), { name: 'eric-lead' }, 'accents and signs become a valid identifier')
  assert.ok(followTitle(d, 'x'.repeat(200)).name.length <= 64)
})

test('the title comes before the identifier, which the title fills in', () => {
  const dlg = src('ui/HireDialog.jsx')
  assert.ok(dlg.indexOf("htmlFor={`${id}-title`}") < dlg.indexOf("htmlFor={`${id}-name`}"), 'the readable name first')
  assert.match(dlg, /set\(\{ title: e\.target\.value, \.\.\.followTitle\(draft, e\.target\.value\) \}\)/)
  assert.match(dlg, /titleRef\.current\?\.focus\(\)/, 'the window opens on the first field')
})

test('the type of bot is one folded line that unfolds in place and folds back after a choice', () => {
  const rp = src('ui/RolePicker.jsx')
  assert.match(rp, /data-role-toggle/)
  assert.match(rp, /aria-expanded=\{open\}/)
  assert.match(rp, /useState\(false\)/, 'folded by default')
  assert.match(rp, /e\.detail > 0\) fold\(\)/, 'a click on a chip folds; the arrows of the keyboard only move')
  for (const lang of LANGS) {
    const r = messages[lang].recruit
    assert.match(r.roleGuessLine('Developer'), /Developer/, lang)
    assert.ok(r.roleChange.length && r.roleFold.length, lang)
  }
})

test('the portrait follows the scroll on a wide window and sits in the flow on a sheet', () => {
  assert.match(rule(DIALOG_CSS, '.oc-dg-prev'), /position:sticky;top:0/)
  assert.match(DIALOG_CSS, /@media \(max-width:560px\)\{[^@]*\.oc-dg-prev\{position:static/)
})

test('the starting points say what they hold, in plain words, with the counts agreeing', () => {
  assert.equal(messages.fr.recruit.starts.fresh, 'Neuf (compétences de Hermes)')
  assert.equal(messages.fr.recruit.starts.empty, 'Vide (aucune compétence)')
  assert.equal(messages.fr.recruit.skillsSum(12, 'default', 3), '12 compétences copiées de default, dont 3 propres')
  assert.equal(messages.fr.recruit.skillsSum(1, 'default', 0), '1 compétence copiée de default')
  assert.equal(messages.en.recruit.skillsSum(12, 'default', 3), '12 skills copied from default, 3 of them custom')
  assert.equal(messages.es.recruit.skillsSum(1, 'default', 1), '1 skill copiado de default, 1 propio')
  assert.match(messages.fr.recruit.modelInherited, /bot principal/)
})

test('the risk of « Recruit » is written next to the button, the diagnostic link is quiet, and « Close » keeps the draft', () => {
  const dlg = src('ui/HireDialog.jsx')
  assert.match(dlg, /<p className="oc-dg-fn" data-hire-risk>\{t\('recruit\.riskNote'\)\}<\/p>/)
  assert.match(dlg, /className="oc-dg-link quiet"/)
  assert.match(dlg, /data-hire-kept/)
  assert.match(rule(DIALOG_CSS, '.oc-dg-link.quiet'), /font-size:11px/)
  for (const lang of LANGS) {
    const r = messages[lang].recruit
    assert.ok(r.riskNote.length > 40, `${lang} the note says what is written and how to undo it`)
    assert.ok(messages[lang].dlg.draftKept.length > 10, lang)
  }
  assert.equal(messages.fr.recruit.cancel, 'Fermer')
})
