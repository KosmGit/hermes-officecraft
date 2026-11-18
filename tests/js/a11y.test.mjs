import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { buildOffice } from '../../src/core/office.js'
import { buildRoster } from '../../src/core/roster.js'
import { translate } from '../../src/core/translate.js'
import { messages } from '../../src/i18n/index.js'
import { hotspots, layoutScene, toSceneModel } from '../../src/scene/index.js'
import { MIN_TARGET, hitBox, spotTip, skipPlan } from '../../src/ui/targets.js'
import { newAttention } from '../../src/core/panel.js'
import { msUntilPageTick, pageTickDelay } from '../../src/core/daylight.js'
import { es } from '../../src/i18n/es.js'
import { GRADES } from '../../src/core/game.js'
import { en } from '../../src/i18n/en.js'
import { fr } from '../../src/i18n/fr.js'
import { PANEL_CSS } from '../../src/ui/panelStyles.js'
import { PAGE_CSS } from '../../src/ui/pageStyles.js'

// ===== a11y =====
{
// Keyboard and targets. Every target is at least 24 CSS px (WCAG 2.5.8),
// and a skip link « Go to the details » leads from the header to the side panel.
const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const NOW = 1_800_000_000_000
const desks = buildRoster({ profiles: [{ name: 'a', last_session: null, worker_session: null }, { name: 'b', last_session: null, worker_session: null }] }, NOW)
const office = buildOffice(desks, { ok: true, boards: [{ slug: 'alpha', tasks: [] }, { slug: 'beta', tasks: [] }, { slug: 'gamma', tasks: [] }], ops: null }, NOW)
const model = toSceneModel(office, { nowMs: NOW })
const layout = layoutScene(model)
const spots = hotspots(layout, model)
const ctx = lang => ({ readMs: NOW, lang, night: false, lightForced: false })
const say = (parts, lang) => translate(messages, lang, parts[0], parts.slice(1))

test('(no lamps any more) every remaining scene object keeps its own name and tooltip', () => {
  assert.equal(spots.filter(s => s.kind === 'lamp').length, 0, 'the lamps are gone from the hover zones')
  for (const lang of ['en', 'fr', 'es']) {
    const names = spots.map(s => say(spotTip(s, office, ctx(lang)).name, lang))
    assert.ok(names.every(n => n && !n.startsWith('spot.')), `${lang}: every zone has a real name: ${names.join(' | ')}`)
    assert.ok(names.every(n => !/lamp|lámpara|lampe/i.test(n)), `${lang}: no lamp is named`)
  }
  // the other objects keep their own name and tooltip
  const clock = spots.find(s => s.kind === 'clock')
  assert.deepEqual(spotTip(clock, office, ctx('en')).name, ['spot.clock'])
})

test('hitBox: never under 24 CSS px, same centre, larger boxes untouched', () => {
  assert.equal(MIN_TARGET, 24)
  assert.deepEqual(hitBox({ left: 100, top: 50, width: 21, height: 18 }), { left: 98.5, top: 47, width: 24, height: 24 })
  assert.deepEqual(hitBox({ left: 10, top: 10, width: 40, height: 60 }), { left: 10, top: 10, width: 40, height: 60 })
  assert.deepEqual(hitBox({ left: 0, top: 0, width: 24, height: 24 }), { left: 0, top: 0, width: 24, height: 24 })
  // every scene spot, at every scale the scene can take (0.75 .. 4), ends up at least 24 px
  for (const S of [0.75, 1, 1.3, 2, 4]) {
    for (const sp of spots) {
      const b = hitBox({ left: sp.rect.x * S, top: sp.rect.y * S, width: sp.rect.w * S, height: sp.rect.h * S })
      assert.ok(b.width >= 24 && b.height >= 24, `${sp.id} at x${S}: ${b.width}x${b.height}`)
    }
  }
})

test('the scene wires the 24 px boxes (objects and agent stations) and the lamp names', () => {
  const scene = src('src/ui/OfficeScene.jsx')
  assert.match(scene, /hitBox\(/)
  assert.match(scene, /spotTip\(/)
  assert.doesNotMatch(scene, /tipOf\(sp, office/, 'the tooltip and the label come from spotTip, not the bare tipOf')
})

test('the page opens with a skip link to the details, visible at focus, in the three languages', () => {
  const page = src('src/ui/OfficePage.jsx')
  assert.match(page, /data-skip/, 'the link exists')
  assert.ok(page.indexOf('data-skip') < page.indexOf('<PageHeader'), 'it is the first stop of the page (the header is PageHeader)')
  assert.match(page, /t\('skipDetails'\)/)
  const css = src('src/ui/panelStyles.js')
  assert.match(css, /\.oc-skip:not\(:focus\)/, 'hidden until it takes the focus')
  assert.match(css, /\.oc-skip:focus/, 'and shown at focus')
  for (const lang of ['en', 'fr', 'es']) assert.ok(say(['skipDetails'], lang).length > 4, lang)
  assert.match(say(['skipDetails'], 'fr'), /détails/i)
  assert.match(page, /skipToDetails/, 'activating it moves the focus into the panel (opening it first when it is folded)')
  assert.match(page, /headRef\.current\?\.focus\(\)/)
})
}

// ===== a11y =====
{
// An element never carries a `title` equal to its `aria-label` (screen readers read the name twice).
const dir = new URL('../../src/ui/', import.meta.url)
const files = readdirSync(dir).filter(f => f.endsWith('.jsx'))

// JSX opening tags that carry both attributes, with the attribute expressions compared as written
const tags = text => [...text.matchAll(/<(?:button|span|div|a)\b[^<>]*?(?:=>[^<>]*?)*>/gs)].map(m => m[0])
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}=(\\{(?:[^{}]|\\{[^{}]*\\})*\\}|"[^"]*")`))?.[1]

test('no title equal to the aria-label on the same element', () => {
  const bad = []
  for (const f of files) {
    for (const tag of tags(readFileSync(new URL(f, dir), 'utf8'))) {
      const title = attr(tag, 'title')
      const label = attr(tag, 'aria-label')
      if (title && label && title === label) bad.push(`${f}: ${tag.slice(0, 80)}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('the agent buttons keep their aria-label and the postcard keeps its name without the tip repeated', () => {
  const scene = readFileSync(new URL('OfficeScene.jsx', dir), 'utf8')
  assert.equal((scene.match(/aria-label=\{f\.label\}/g) || []).length, 2, 'scene station + list row')
  assert.doesNotMatch(scene, /title=\{badge \? undefined : f\.label\}/)
  const bar = readFileSync(new URL('GameBar.jsx', dir), 'utf8')
  assert.doesNotMatch(bar, /aria-label=\{`\$\{t\('game\.postcard'\)\}\. \$\{t\('game\.postcardTip'\)\}`\}/, 'the description is the title, not repeated in the name')
})
}

// ===== a11y =====
{
// Entering « waiting for you » / « silent » is announced, and the legend is not inside a live region.
const page = readFileSync(new URL('../../src/ui/OfficePage.jsx', import.meta.url), 'utf8')

test('newAttention: only agents that ENTER waiting or stale are announced, nothing at first sight', () => {
  const agents = [{ name: 'a', state: 'waiting' }, { name: 'b', state: 'stale' }, { name: 'c', state: 'working' }, { name: 'd', state: 'idle' }]
  assert.deepEqual(newAttention(null, agents), [], 'first sight: the states are on screen, nothing changed')
  const prev = new Map([['a', 'working'], ['b', 'idle'], ['c', 'idle'], ['d', 'idle']])
  assert.deepEqual(newAttention(prev, agents).map(a => a.name), ['a', 'b'])
  // already waiting before: not announced again; an agent unknown before (hired meanwhile) is not an « entry » either
  assert.deepEqual(newAttention(new Map([['a', 'waiting'], ['b', 'stale']]), agents), [])
  assert.deepEqual(newAttention(new Map(), agents), [])
})

test('every language says it for both states, with the agent name', () => {
  for (const [code, m] of Object.entries(messages)) {
    for (const state of ['waiting', 'stale']) assert.match(m.announce[state]('Alice'), /Alice/, `${code}.${state}`)
  }
})

// the header (PageHeader) and the dock under the scene (ProjectDock, which holds <Legend />) live outside OfficePage
const ui = f => readFileSync(new URL(`../../src/ui/${f}`, import.meta.url), 'utf8')
const dock = ui('ProjectDock.jsx')

test('the legend sits outside every aria-live region of the page, and the live region exists once, off screen', () => {
  const live = ['OfficePage.jsx', 'PageHeader.jsx', 'ProjectDock.jsx', 'AlertRail.jsx', 'DecisionsTab.jsx', 'SidePanel.jsx', 'TabBar.jsx'].map(f => [...ui(f).matchAll(/aria-live="polite"/g)].length).reduce((a, b) => a + b, 0)
  // header live state (working / decisions / agents) + the dedicated announce region
  assert.equal(live, 2, 'two polite regions: the header live state and the dedicated announcement')
  const bar = dock.match(/<div className="ux-dock"[^>]*>/)?.[0] ?? ''
  assert.ok(bar && !/aria-live/.test(bar), `the dock (which holds <Legend />) is not a live region: ${bar}`)
  assert.match(dock, /<span className="oc-announce" data-announce aria-live="polite">\{announce\}<\/span>/)
  assert.match(dock, /<Legend \/>/)
})
}

// ===== a11y =====
{
const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

// es.js speaks « tú » everywhere (Selecciona, Te espera), never « usted » (reinicie, Vea, Cree).
test('Spanish strings keep the « tú » register of the rest of es.js', () => {
  const bad = []
  const walk = (o, p) => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') walk(v, `${p}${k}.`)
      else {
        const text = typeof v === 'function' ? String(v(...Array(v.length).fill(1))) : String(v)
        if (/\b(Vea|vea|Cree|cree|reinicie|Reinicie|Active|active su)\b/.test(text)) bad.push(`${p}${k}: ${text}`)
      }
    }
  }
  walk(es, '')
  assert.deepEqual(bad, [])
})

// No timer while the window is hidden. The decision is pure (the hook only reads document.hidden).
test('the page clock arms no timer while the window is hidden', () => {
  const d = new Date(2026, 10, 8, 12, 30, 45, 500)
  assert.equal(pageTickDelay(true, d), null)
  assert.equal(pageTickDelay(false, d), msUntilPageTick(d))
  assert.match(src('src/ui/usePageClock.js'), /pageTickDelay\(document\.hidden, new Date\(\)\)/)
})

// Badges and attention are announced together: two effects that both setAnnounce in the same commit would let the second erase the first.
test('a badge and an attention change in the same read are both announced (one writer of the live region)', () => {
  const page = src('src/ui/OfficePage.jsx')
  assert.equal((page.match(/setAnnounce\(/g) || []).length, 1, 'one setAnnounce call')
  assert.match(page, /\[\.\.\.fresh\.map\([^\n]*\), \.\.\.entered\.map\(/)
})
}

// ===== a11y =====
{
// The skip link « Go to the details »: panel open -> the focus goes to its title now; panel folded -> it
// opens first (the drawer on a narrow pane, the side panel on a wide one), and the focus follows once it is there.
test('skip link: focus now when the panel is open, otherwise open the right panel first', () => {
  assert.deepEqual(skipPlan({ panelOpen: true, narrow: false }), { focusNow: true, open: null })
  assert.deepEqual(skipPlan({ panelOpen: true, narrow: true }), { focusNow: true, open: null })
  assert.deepEqual(skipPlan({ panelOpen: false, narrow: false }), { focusNow: false, open: 'panel' })
  assert.deepEqual(skipPlan({ panelOpen: false, narrow: true }), { focusNow: false, open: 'drawer' })
})
}

// ===== a11y =====
{
// Proof tests (UX, design, accessibility, languages): each one fails while the defect it names exists.
// Measures were taken in the real webapp (headless Chromium, CDP, pixels of the screenshots).
const LANGS = { en, fr, es }

test('the first-launch notice says the gateway must restart after the Agent switch', () => {
  // Hermes, Capabilities → Plugins: « Extend the agent for the selected profile … Take effect after a gateway restart. »
  // (apps/desktop/src/i18n/en.ts, plugins.agentBlurb). Following the notice alone, the page stays roster-only.
  for (const [code, L] of Object.entries(LANGS)) {
    assert.match(L.rosterOnly, /restart|redémarr|reinici/i, `${code}: rosterOnly never mentions the gateway restart: « ${L.rosterOnly} »`)
  }
})

test('the first-launch notice is not drawn in the tertiary text colour (3.53:1 on the light page)', () => {
  // the tertiary text colour is 3.53:1 on the light page (fg 133,136,139 on 254,254,254, < 4.5:1): the notice never uses it.
  // The notice lines are the chips of the alert rail (`rosterOnly` is the « roster » chip, its sentence is in the popover)
  const rule = sel => PAGE_CSS.split('\n').find(l => l.startsWith(`${sel}{`)) ?? ''
  assert.match(rule('.ux-al'), /color:var\(--foreground\)/, 'the chip is drawn in the text colour')
  assert.match(rule('.ux-pop p'), /color:var\(--ui-text-secondary\)/, 'the sentence is drawn in the secondary text colour (not the tertiary)')
  assert.doesNotMatch(rule('.ux-pop p'), /--ui-text-tertiary\)(;|})/, 'never the bare tertiary')
})

test('« 1 agents »: the header counts agree in number with one agent', () => {
  // first launch of a typical user (one profile): the header read « 0 working · 1 agents » (EN), « 1 agents » (FR), « 1 agentes » (ES)
  // the summary is the three pills of the header (number in the button, the word after it): the word follows the number
  for (const [code, L] of Object.entries(LANGS)) {
    const s = `1 ${L.ux.pill.agents(1)}`
    assert.doesNotMatch(s, /\b1 agent(e)?s\b/, `${code}: « ${s} »`)
    assert.notEqual(L.ux.pill.agents(1), L.ux.pill.agents(2), `${code}: agent(s)`)
    assert.notEqual(L.ux.pill.decisions(1), L.ux.pill.decisions(2), `${code}: decision(s)`)
  }
})

test('the grade is never shown as a two-letter abbreviation: its translated name is in the tooltip', () => {
  // GRADES[].short ('St', 'Cf', 'Sr', 'Lg') were French abbreviations rendered as-is by OfficeScene gradeChip in every language:
  // an English label read « St » for Intern. Then translated (« In », « Rg »…), still cryptic; the grade is off the scene labels
  // and the list rows: it is spelt out in the tooltip and the Agent tab, in the language shown.
  for (const [code, L] of Object.entries(LANGS)) {
    assert.equal(L.game.gradeShort, undefined, `${code}: no abbreviated grade left to show`)
    for (const g of GRADES) assert.ok(L.game.grade[g.id] && L.game.grade[g.id].length > 2, `${code}: ${g.id} has its full name`)
  }
  const scene = readFileSync(new URL('../../src/ui/OfficeScene.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(scene, /gradeShort|g\.short|\.short\b/, 'the office never draws the short form')
  assert.match(scene, /t\('game\.gradeTip', t\(`game\.grade\./, 'the full grade name is in the tooltip')
})

test('the « / total » of the Open cards tile reaches 4.5:1 (opacity .6 measured 3.79:1, light theme)', () => {
  const rule = PANEL_CSS.match(/\.oc-stat b small\{([^}]*)\}/)?.[1] ?? ''
  assert.ok(rule, 'rule .oc-stat b small found')
  const op = Number(rule.match(/opacity:\s*([\d.]+)/)?.[1] ?? 1)
  assert.ok(op >= 0.8, `.oc-stat b small has opacity ${op}`)
})
}
