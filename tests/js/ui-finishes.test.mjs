import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { computeGame, keepSeenWhilePartial } from '../../src/core/game.js'
import { PARTIAL_CONFIRM_READS, bannerOf, confirmedPartial, nextStreaks } from '../../src/core/page.js'
import { DAYS_BY_WINDOW, daysFor, dayRanges } from '../../src/core/usage.js'
import { messages } from '../../src/i18n/index.js'
import { DIALOG_CSS } from '../../src/ui/dialogStyles.js'
import { PAGE_CSS } from '../../src/ui/pageStyles.js'
import { cronsTile } from '../../src/core/replay.js'
import { PANEL_CSS } from '../../src/ui/panelStyles.js'
import { SCENE_CSS } from '../../src/ui/sceneStyles.js'
import * as s from '../../src/ui/styles.js'
import { BTN_RADIUS, BTN_WEIGHT, CARD, EDGE, FIELD_CSS, FIELD_EDGE, FIELD_RADIUS, RING, RING_FOCUS } from '../../src/ui/tokens.js'

// ===== ui-finishes =====
{
// Finishes of the interface, each kept as a test that fails without its fix.
//  (« Open session opens an empty session » is in roster.test.mjs)
const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const locked = source => ({ source, reason: 'locked' })

// --- the banner « Partial data · 1 source » (gone at the next read): a state.db that missed its 0.3 s slot ---
test('partial: a transient failure (locked) is said only when the same source fails 2 reads in a row; schema / missing at once', () => {
  assert.equal(PARTIAL_CONFIRM_READS, 2)
  const once = nextStreaks(new Map(), [locked('sessions:qa')])
  assert.deepEqual(confirmedPartial([locked('sessions:qa')], once), [], 'one blip: nothing')
  const twice = nextStreaks(once, [locked('sessions:qa')])
  assert.deepEqual(confirmedPartial([locked('sessions:qa')], twice), [locked('sessions:qa')], 'two in a row: named')
  const healed = nextStreaks(twice, [])
  assert.equal(healed.size, 0, 'a good read resets every streak')
  const hard = [{ source: 'kanban:x', reason: 'schema' }, { source: 'sessions:y', reason: 'missing' }]
  assert.deepEqual(confirmedPartial(hard, new Map()), hard, 'a structural failure does not wait')
})

test('partial: bannerOf stays silent on a blip and names the source once it repeats; without streaks it says everything (as before)', () => {
  const live = { data: { partial: [] }, dataUpdatedAt: 1, errorUpdatedAt: 0 }
  const history = { ok: true, partial: [locked('sessions:qa')] }
  assert.equal(bannerOf({ live, history, streaks: { live: new Map(), history: nextStreaks(new Map(), history.partial) } }), null)
  const two = nextStreaks(nextStreaks(new Map(), history.partial), history.partial)
  const banner = bannerOf({ live, history, streaks: { live: new Map(), history: two } })
  assert.deepEqual(banner.partial.labels, [{ kind: 'sessions', name: 'qa' }])
  assert.equal(bannerOf({ live, history }).partial.labels.length, 1)
})

test('partial: the agent half retries a missed state.db at the next 60 s read (skip window < poll)', () => {
  const py = src('hermes_officecraft/snapshot.py')
  const skip = Number(py.match(/^SLOW_SESSION_SKIP_S = ([\d.]+)/m)?.[1])
  assert.ok(skip > 0 && skip < 60, `skip ${skip} s must stay under the 60 s /history poll`)
})

// --- trophies that fall with a partial history ---
const ach = (id, unlocked) => ({ id, unlocked, unlockedMs: unlocked ? 1 : null, dated: unlocked, fact: ['f'], progress: [0, 1], source: 'cards' })
const game = list => ({ sober: false, achievements: list })

test('trophies: a seen trophy a partial reading shows locked stays unlocked, undated, « to re-check »; a complete reading is the truth', () => {
  const g = game([ach('a', true), ach('b', false), ach('c', false)])
  const kept = keepSeenWhilePartial(g, ['a', 'b'], true)
  assert.equal(kept.achievements.filter(x => x.unlocked).length, 2, 'a (read) + b (seen, not readable now)')
  const b = kept.achievements.find(x => x.id === 'b')
  assert.deepEqual([b.unlocked, b.recheck, b.dated, b.unlockedMs], [true, true, false, null])
  assert.equal(kept.achievements.find(x => x.id === 'c').unlocked, false, 'never seen: never invented')
  assert.equal(keepSeenWhilePartial(g, ['a', 'b'], false), g, 'complete reading: untouched')
  assert.equal(keepSeenWhilePartial(g, null, true), g, 'first launch on this machine: nothing seen')
  assert.equal(keepSeenWhilePartial({ sober: true }, ['a'], true).sober, true)
})

test('trophies: the 3 languages say « to re-check », and a real computeGame without history keeps what was seen', () => {
  for (const code of ['en', 'fr', 'es']) assert.ok(messages[code].game.tip.recheck.length > 10, code)
  const real = computeGame(null, { boards: [], agents: [] }, Date.now(), {}, [])
  const seen = real.achievements.slice(0, 5).map(a => a.id)
  const kept = keepSeenWhilePartial(real, seen, true)
  assert.equal(kept.achievements.filter(a => a.recheck).length, seen.filter(id => !real.achievements.find(a => a.id === id).unlocked && !real.achievements.find(a => a.id === id).unavailable).length)
})

// --- Resources: the day by day follows the chosen window ---
test('Resources: 24 h touches 2 local days, 7 days = 7, 30 days = 30; the chart says its span', () => {
  assert.deepEqual([daysFor('24h'), daysFor('7d'), daysFor('30d'), daysFor('x')], [2, 7, 30, 7])
  assert.equal(Object.keys(DAYS_BY_WINDOW).length, 3)
  const now = new Date(2026, 10, 14, 11).getTime()
  assert.equal(dayRanges(now, daysFor('24h')).length, 2)
  assert.equal(dayRanges(now, daysFor('30d')).length, 30)
  for (const code of ['en', 'fr', 'es']) assert.ok(messages[code].usage.days.span(7).includes('7') && messages[code].usage.days.span(2).length > 3, code)
  assert.match(src('src/ui/UsageDialog.jsx'), /useUsageDays\(ctx, \{ enabled: on, kind \}\)/)
})

test('dialogs: the body of a window shows a shadow where more is hidden (scroll hint)', () => {
  assert.match(DIALOG_CSS, /\.oc-dg-b\{[^}]*background:linear-gradient\([^}]*local[^}]*scroll/)
})

// --- 1920 px / 380 px ---
test('1920 / 380: header badge 32 px, wide panel ends with its content, projects on one scrollable row, replay keeps its list', () => {
  assert.match(PAGE_CSS, /\.ux-game\{[^}]*height:32px/)
  assert.match(PAGE_CSS, /@container ux \(min-width: 1500px\)\{[\s\S]*?\.ux-panel\{align-self:start/)
  assert.match(PAGE_CSS, /\.ux-dk-l\{[^}]*flex-wrap:nowrap;[^}]*overflow-x:auto/)
  assert.match(PAGE_CSS, /\.ux-stage\[data-replaying\] \.oc-list>p\{display:none\}/)
  const bar = src('src/ui/ReplayBar.jsx')
  assert.match(bar, /replay\.windowShort/)
  assert.equal(messages.fr.replay.windowShort['24h'], '24 h', 'the French choice no longer wraps (« 24 dernières heures »)')
  for (const code of ['en', 'fr', 'es']) for (const w of ['night', '24h', '7d']) assert.ok(messages[code].replay.windowShort[w], `${code} ${w}`)
})

test('level bar: the header badge fills done/next like the window does', () => {
  const hdr = src('src/ui/PageHeader.jsx')
  assert.match(hdr, /lvl\.done \/ lvl\.next/)
  assert.doesNotMatch(hdr, /levelFloor/)
})

// --- the page really wires the two fixes ---
test('wiring: the page feeds the read streaks to pageModel and keeps seen trophies while a source is unreadable', () => {
  const page = src('src/ui/OfficePage.jsx')
  const streaks = page.match(/const streaks = \{ live: usePartialStreaks\(live\.data, live\.dataUpdatedAt\), history: usePartialStreaks\(history\.data, history\.dataUpdatedAt\) \}/)
  assert.ok(streaks, 'one streak counter per route, moved by each answer')
  assert.match(page, /pageModel\(\{\s*streaks,/, 'pageModel receives the streaks (without them every blip is a banner)')
  assert.match(page, /const unreadable = !history\.data\?\.ok \|\| partialSources\(live\.data \?\? null, history\.data \?\? null\)\.length > 0/)
  assert.match(page, /keepSeenWhilePartial\(computeGame\([^)]*\), readSeen\(\), unreadable\)/)
})

test('Journal tiles: 8 tiles in a 3-column grid, the last one spans 2 so no cell stays empty', () => {
  const card = src('src/ui/NightCard.jsx')
  const tiles = (card.match(/const TILES = \[([\s\S]*?)\n\]/)[1].match(/^\s*\['/gm) || []).length + 2   // + orders + crons
  assert.equal(tiles, 8)
  assert.equal(tiles % 3, 2, 'a 3-column grid leaves one hole after the 8th tile')
  assert.match(src('src/ui/replayStyles.js'), /\.oc-nt-grid\{display:grid;grid-template-columns:repeat\(3,/)
  assert.match(src('src/ui/replayStyles.js'), /\.oc-nt-grid \.oc-nt-tile:nth-child\(8\):last-child\{grid-column:span 2\}/)
})

test('1920 px dock: the project chips share the row from their content width and never shrink, so 8 projects scroll instead of losing their names', () => {
  const wide = PAGE_CSS.match(/@container ux \(min-width: 1500px\)\{([\s\S]*?)\n\}/)[1]
  const chip = wide.match(/\.ux-dk-l \.ux-pj:not\(\.all\)\{([^}]*)\}/)[1]
  const [grow, shrink, basis] = chip.match(/flex:([^;]+)/)[1].trim().split(/\s+/)
  assert.equal(grow, '1', 'the chips grow to share the dock')
  assert.equal(shrink, '0', 'a chip is never squeezed: the row scrolls (the dock is one row of a fixed height)')
  assert.ok(!/^0(px|%)?$/.test(basis), `basis ${basis}: a 0 basis would squeeze 8 projects to a ring and a cut count`)
  assert.match(PAGE_CSS, /\.ux-dk-l\{[^}]*flex-wrap:nowrap/, 'one row, also on a wide pane')
})

// --- 0 agent ---
test('empty office: three steps and a recruit button, in the 3 languages', () => {
  for (const code of ['en', 'fr', 'es']) for (const k of ['emptyStep1', 'emptyStep2', 'emptyStep3', 'emptyCli']) assert.ok(messages[code][k]?.length > 10, `${code} ${k}`)
  const page = src('src/ui/OfficePage.jsx')
  assert.match(page, /<EmptyOffice t=\{t\} onRecruit=/)
  assert.match(src('src/ui/EmptyOffice.jsx'), /data-empty-recruit/)
})
}

// ===== ui-finishes =====
{
// More finishes — each fix kept as a test that fails without it.
const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

// the Journal tile read « 23 cron jobs failed · 3 / 23 » for 3 failures out of 23 runs (the big number was the total).
test('crons tile: the big number is what its label names (the failures under « failed », the total as detail)', () => {
  assert.deepEqual(cronsTile({ ok: 20, failed: 3 }), { n: 3, label: 'replay.night.cronsFailed', total: 23, tone: 'fail' })
  assert.deepEqual(cronsTile({ ok: 4, failed: 0 }), { n: 4, label: 'replay.night.cronsOk', total: null, tone: '' })
  assert.deepEqual(cronsTile({ ok: 0, failed: 0 }), { n: 0, label: 'replay.night.cronsOk', total: null, tone: '' })
  for (const lang of ['en', 'fr', 'es']) assert.match(messages[lang].replay.night.cronsOf(23), /^\S+( \S+)? 23$/, `${lang}: « out of 23 »`)
  const card = src('src/ui/NightCard.jsx')
  assert.match(card, /const cron = cronsTile\(summary\.crons\)/)
  assert.match(card, /\['crons', 'cron', cron\.tone, cron\.n, t\(cron\.label\), cron\.total \? t\('replay\.night\.cronsOf', cron\.total\) : ''\]/)
})

// in Resources the day's label sat 3 px above the bottom of its (pressed) button: the 4 px edge rule of the finishes.
test('Resources days: the day label keeps 4 px from the bottom of its button (7 and 30 days)', () => {
  const css = src('src/ui/usageStyles.js')
  const pad = sel => css.match(new RegExp(`^${sel.replace(/[.[\]"()]/g, '\\$&')}\\{[^}]*?padding:(\\d+)px`, 'm'))[1]
  assert.ok(Number(pad('.oc-us-day')) >= 4, 'week view')
  assert.ok(Number(pad('.oc-us-days[data-n="30"] .oc-us-day')) >= 4, '30 days view')
})
}

// ===== ui-finishes =====
{
// Defects measured in the real webapp, each test fails without its fix.
/** The declarations of the first rule whose selector is exactly `selector` (whitespace-insensitive), or null. */
function rule(css, selector) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim().replace(/\s+/g, ' ') === selector) return m[2]
  }
  return null
}

// Measured at 1440x900, FR: a second order tried during the 6 s window is refused, and the refusal line
// was drawn below the bar with no background, over the page's « Sélectionnez un agent… » hint (text on text).
test('the refusal under the order bar sits on its own card background (no text over the page hint)', () => {
  const decl = rule(PANEL_CSS, '.oc-ordbar .oc-ordnote')
  assert.ok(decl, 'a rule for the refusal inside the floating bar')
  assert.match(decl, /background:\s*var\(--ui-bg-elevated/, 'opaque theme background, like the bar itself')
  assert.match(decl, /padding:\s*\d/, 'padded so the text never touches the edge')
})
}

// ===== ui-finishes =====
{
// The controls look like Hermes' own.
//  - a field's border is darker than the page hairline, the field is filled with --ui-bg-elevated, and `--card` (absent from the
//    webapp: it resolved to nothing) never stands alone.
//  - buttons have a 4 px radius, weight 500 and the host's focus ring (border in the ring colour + 3 px halo), not an accent outline.
// Here, the rules by value.
const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
/** the declarations of every rule whose selector list contains `sel` exactly (a selector inside a longer one does not count) */
const rules = (css, sel) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
  .filter(m => m[1].split(',').map(x => x.trim()).includes(sel))
  .map(m => m[2])
const decl = (css, sel, prop) => rules(css, sel).map(r => r.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))?.[1]?.trim()).filter(Boolean).at(-1)
const focusRule = (css, sel) => rules(css, `${sel}:focus-visible`).join(';')

test('--card never stands alone: the surface falls back to an explicit one, in every file', () => {
  assert.match(CARD, /var\(--card, Canvas\)/)
  for (const f of ['src/ui/SettingsForm.jsx', 'src/ui/SettingsFormNotify.jsx', 'src/ui/styles.js', 'src/ui/panelStyles.js', 'src/ui/sceneStyles.js']) {
    const bare = src(f).replace(/var\(--ui-bg-elevated, var\(--card, Canvas\)\)/g, '')
    assert.doesNotMatch(bare, /var\(--card\b/, `${f}: a bare var(--card)`)
  }
  assert.doesNotMatch(PANEL_CSS + SCENE_CSS + JSON.stringify(s), /var\(--card\)/)
})

test('the border of a field is darker than the hairline, and the field has its own fill', () => {
  assert.notEqual(FIELD_EDGE, EDGE)
  assert.match(FIELD_EDGE, /var\(--foreground\) (4[0-9]|5[0-9])%/, 'a mix of the text colour: strong enough for 3:1')
  assert.doesNotMatch(FIELD_EDGE, /#|rgb|hsl/, 'theme variables only')
  assert.equal(FIELD_RADIUS, '2.5px', 'the radius of Hermes\' own fields (control.ts)')
  for (const f of ['src/ui/SettingsForm.jsx', 'src/ui/SettingsFormNotify.jsx']) {
    const text = src(f)
    assert.match(text, /FIELD_EDGE/, `${f}: the selects take the field border`)
    assert.match(text, /background: CARD/, `${f}: and the explicit fill`)
    assert.doesNotMatch(text, /1px solid var\(--ui-stroke-secondary\)/, `${f}: no page hairline on a field`)
  }
})

test('buttons: radius 4 px, weight 500 (text buttons), the host focus ring', () => {
  assert.equal(BTN_RADIUS, '4px')
  assert.equal(BTN_WEIGHT, 500)
  assert.match(RING_FOCUS, /box-shadow:0 0 0 3px color-mix\(in oklab, .+ 50%, transparent\)/)
  assert.match(RING_FOCUS, /border-color:/)
  assert.match(RING, /--ring/, 'the host ring colour first')
  // .oc-btn is still the button of the campaign window's footer and template picker
  for (const sel of ['.oc-btn', '.oc-legend-btn', '.oc-gear', '.oc-x']) {
    assert.equal(decl(PANEL_CSS, sel, 'border-radius'), '4px', `${sel} radius`)
    const ring = focusRule(PANEL_CSS, sel)
    assert.ok(ring.includes('box-shadow:0 0 0 3px'), `${sel}: focus ring is the host's (3 px halo): ${ring}`)
    assert.doesNotMatch(ring, /outline:2px solid (?!transparent)/, `${sel}: no accent outline (the outline is the transparent one of forced-colors mode)`)
  }
  assert.match(src('src/ui/CampaignDialog.jsx'), /className="oc-btn"/)
  assert.equal(decl(PANEL_CSS, '.oc-btn', 'font-weight'), '500', '.oc-btn weight')
  // the « Open session » button of the dock keeps its class (and its host ring); the dock's buttons are styled by pageStyles.js, not by inline styles
  assert.match(src('src/ui/ProjectDock.jsx'), /className="ux-b sm pri oc-btn-open"/)
  assert.ok(focusRule(PANEL_CSS, '.oc-btn-open').includes('box-shadow:0 0 0 3px'))
  // the settings selects (inline style, so no :focus rule of their own) take the ring through one injected rule
  assert.ok(FIELD_CSS.includes('.oc-fc:focus-visible') && FIELD_CSS.includes('box-shadow:0 0 0 3px'))
  assert.match(FIELD_CSS, /border-color:[^;]+ !important/, 'the border turns to the ring colour although the select\'s own border is an inline style')
  assert.match(src('src/ui/SettingsForm.jsx'), /<style>\{FIELD_CSS\}<\/style>/)
  for (const f of ['src/ui/SettingsForm.jsx', 'src/ui/SettingsFormNotify.jsx']) {
    const selects = src(f).match(/<select [^>]*>/g) || []
    assert.ok(selects.length > 0 && selects.every(x => x.includes('className="oc-fc"')), `${f}: every select takes the ring class`)
  }
})
}
