// Skills shown in the office and the hiring dialog's requests.
// Desk objects: src/scene/kits.js. Hiring: src/core/recruit.js (recruiting, pure).
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hireDraft as draftOf, hireErrors as errorsOf, hirePayload } from '../../src/core/recruit.js'
import { kitOf, kitsOf } from '../../src/scene/kits.js'
import { detectRole } from '../../src/scene/wardrobe.js'

// the profiles the hiring form validates against
const profiles = [{ name: 'default', isDefault: true, skills: { enabled: 90, own: [] } }, { name: 'scout', skills: { enabled: 6, own: [] } }]
const hireDraft = () => draftOf(profiles)
const hireErrors = h => errorsOf(h, profiles)
const sk = (name, category = '', tags = []) => ({ name, category, tags })

test('skills map to desk objects from their name, category or tags', () => {
  assert.equal(kitOf(sk('seo-check')), 'magnifier')
  assert.equal(kitOf(sk('copy-desk')), 'books')
  assert.equal(kitOf(sk('obsidian', 'note-taking', ['notes', 'markdown'])), 'notebook')
  assert.equal(kitOf(sk('rival-watch', 'research', ['competitors', 'news'])), 'research')
  assert.equal(kitOf(sk('himalaya', 'email')), 'mail')
  assert.equal(kitOf(sk('figma-export')), 'tablet')
})

test('short keys match whole words only (no "ui" in "build", "art" in "chart", "git" in "digital")', () => {
  assert.equal(kitOf(sk('build-helper')), null)
  assert.equal(kitOf(sk('chart-maker')), 'chart')
  assert.equal(kitOf(sk('digital-garden')), null)
  assert.equal(kitOf(sk('client-portal')), null)
  assert.equal(kitOf(sk('latest-news-digest')), 'mail')
  assert.equal(kitOf(sk('ui-polish')), 'tablet')
})

test('a skill matching nothing still shows, as a binder', () => {
  assert.equal(kitOf(sk('zzq-thing')), null)
  assert.deepEqual([...kitsOf({ skills: { own: [sk('zzq-thing')] } }).map(k => k.id)], ['binder'])
})

test('skills feed the role too (tags are mostly English)', () => {
  const a = { name: 'bob', description: '', skills: { own: [sk('obscure-one', 'research', ['citations', 'arxiv'])] } }
  assert.equal(detectRole(a)?.id, 'researcher')
})

test('hiring validates the id like Hermes does', () => {
  const h = { ...hireDraft(), name: 'Bad Name' }
  assert.ok(hireErrors(h).length)
  assert.ok(hireErrors({ ...hireDraft(), name: 'scout' }).includes('name_taken'))
  assert.ok(hireErrors({ ...hireDraft(), name: 'default' }).length)
  assert.deepEqual([...hireErrors({ ...hireDraft(), name: 'designer' })], [])
  assert.ok(hireErrors({ ...hireDraft(), name: 'designer', model: 'x' }).length, 'model without provider')
})

test('hiring sends profiles.create then tags the bot for the office', () => {
  const reqs = hirePayload({ ...hireDraft(), name: 'designer', title: 'Designer', description: 'UI', start: 'clone', from: 'default', off: ['a'] })
  assert.equal(reqs[0][0], 'profiles.create')
  assert.equal(reqs[0][1].clone_from, 'default')
  assert.equal(reqs[0][1].description, 'UI')   // the kanban routes on this text: no title glued in
  assert.equal(reqs[0][1].soul, undefined)       // a copied bot keeps the copied SOUL.md
  assert.deepEqual({ ...reqs.at(-1)[1].ui_meta['hermes-bots'] }, { title: 'Designer' })
  assert.deepEqual([...reqs[1][1].disabled_skills], ['a'])
  assert.equal(reqs.at(-1)[1].ui_meta['hermes-officecraft'].hiredFrom, 'office')
  const empty = hirePayload({ ...hireDraft(), name: 'x', start: 'empty' })
  assert.equal(empty[0][1].no_skills, true)
  assert.equal(empty[0][1].clone_from, undefined)
})

test('a fresh bot gets a composed SOUL (the server writes none when soul is absent)', () => {
  const [[, create]] = hirePayload({ ...hireDraft(), name: 'scribe', title: 'Scribe', description: 'Writes release notes', start: 'bundled' })
  assert.match(create.soul, /^# Scribe/)
  assert.match(create.soul, /\*\*Mission:\*\* Writes release notes/)
})

test('4+ letter keys match at word starts only; hyphenated multi-word keys work', () => {
  for (const [name, expected] of [['latest-news', 'research'], ['contest-entry', null], ['password-manager', null], ['acronym-expander', null],
    ['wallpaper', null], ['composite-actions', null], ['denote', null], ['sprint-review-planning', 'notebook'], ['standup-action-items', 'notebook']])
    assert.equal(kitOf(sk(name)), expected, name)
})
