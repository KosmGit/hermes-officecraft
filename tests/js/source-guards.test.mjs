import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { computeGame, gameShown } from '../../src/core/game.js'
import { boardsKnown, topStats } from '../../src/core/panel.js'
import { messages } from '../../src/i18n/index.js'
import { pollingGuard } from './helpers/polling-guard.mjs'
import { buildOffice } from '../../src/core/office.js'
import { en } from '../../src/i18n/en.js'
import { panelCloseEffects, soberOf } from '../../src/core/page.js'

// ===== source-guards =====
{
// Defects measured in the real webapp, each guarded here.
const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

// Without the agent half (or before /history answered) the game strip said « Level 1 Garage 0/10 cards done »,
// « Trophies 0/10 » and every bot wore « St » (Stagiaire) — measured in the webapp with /health answering 404, while the
// history holds plenty of done cards and a Légende. A level, a grade or a trophy count without its source is invented
// (nothing is shown without a real source): the game layer shows only once both reads it is computed from answered.
test('the game layer shows only with /history ok and /live read (else nothing of it, as in sober mode)', () => {
  const full = { mode: 'full', agents: [], boards: [] }
  const roster = { mode: 'roster', agents: [], boards: [] }
  assert.equal(gameShown(true, { ok: true }, full), true)
  assert.equal(gameShown(true, null, full), false, '/history not answered yet (or failed)')
  assert.equal(gameShown(true, { ok: false }, full), false, '/history answered ok:false')
  assert.equal(gameShown(true, { ok: true }, roster), false, 'no /live: no board, a level would read 0')
  assert.equal(gameShown(true, null, roster), false, 'agent half absent')
  assert.equal(gameShown(false, { ok: true }, full), false, 'game mode off (sober)')
  // what computeGame alone would print without history: the invented facts this guard keeps off the screen
  const blind = computeGame(null, roster, Date.now(), {})
  assert.equal(blind.office.done, 0)
  // the page derives its « sober » flag from that guard, so every game element (strip, grades, decor, cabinet, journal) follows it
  const page = src('src/ui/OfficePage.jsx')
  assert.match(page, /const \{ sober, narrow, panelOpen \} = model/)   // the flag comes from pageModel (soberOf = !gameShown, tests/js/page.test.mjs)
  assert.ok(page.indexOf('const model = pageModel(') < page.indexOf('computeGame('), 'sober is known before the game is computed')
})

// Without the agent half (/health 404, roster only) the side panel said « 0 Decisions », « 0/0 Open cards »,
// « Nothing waits for a decision. The boards run by themselves. », « No board yet. » and « Card: No card running » —
// measured in the webapp while 2 cards were blocked and 2 running. Without /live nothing is known about cards: the panel
// says the agent half is needed (as the journal already did), never « nothing ».
test('roster-only mode shows no card count and no « nothing waits » (unknown, not zero)', () => {
  const roster = { mode: 'roster', agents: [{ name: 'a', state: 'idle' }], boards: [] }
  const full = { mode: 'full', agents: [{ name: 'a', state: 'idle' }], boards: [] }
  assert.equal(boardsKnown(roster), false)
  assert.equal(boardsKnown(full), true)
  assert.equal(boardsKnown({ agents: [], boards: [] }), true, 'an office built from /live without a mode flag is full')
  assert.deepEqual(topStats(roster), { agents: 1, working: 0, active: 0, decisions: null, open: null, cards: null })
  assert.deepEqual(topStats(full), { agents: 1, working: 0, active: 0, decisions: 0, open: 0, cards: 0 })
  for (const lang of ['en', 'fr', 'es']) assert.ok(messages[lang].panel.needsAgentHalf, `${lang} panel.needsAgentHalf`)
  // every card section of the panel asks boardsKnown before printing an empty state
  // the sections are the tabs of the panel (Inspector -> AgentTab, Inbox -> DecisionsTab, Chains -> ProjectsTab)
  for (const [fn, file] of [['function AgentTab', 'AgentTab'], ['function DecisionsTab', 'DecisionsTab'], ['function ProjectsTab', 'ProjectsTab']]) {
    const panel = src(`src/ui/${file}.jsx`)
    const body = panel.slice(panel.indexOf(fn), panel.indexOf('\n}\n', panel.indexOf(fn)))
    assert.match(body, /boardsKnown\(office\)/, `${fn} checks boardsKnown(office)`)
    assert.match(body, /t\('panel\.needsAgentHalf'\)/, `${fn} says the agent half is needed`)
  }
})

// No request may leave with the page hidden (`refetchIntervalInBackground: false` in src/data/queries.js; measured in the
// webapp: 0 plugin request in 60 s hidden). DOM-free
// contract on the source, since useQuery cannot run under node: every query polls at most once per 5 s and never in background.
// The guard (tests/js/helpers/polling-guard.mjs) also reads the DEFAULT interval of every hook (the one
// OfficePage really uses), the 60 s ceiling of /history, the retry (<= 1, never sooner than 5 s) and refetchOnReconnect.
test('every polled query of src/data/queries.js stops when the page is hidden and polls at most every 5 s', () => {
  pollingGuard(src('src/data/queries.js'))
})
}

// ===== source-guards =====
{
// Proof tests of the polling and of the clock: each one fails while the defect it names exists.
const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

// The useQuery({ ... }) option blocks of src/data/queries.js (same cut as the polling guard).
const queryBlocks = () => src('src/data/queries.js').split('useQuery({').slice(1).map(b => b.slice(0, b.indexOf('\n  })')))

// At most one request per 5 s per source. React Query retries a failed fetch after
// min(1000 * 2^n, 30000) ms by default (query-core 5.104.1, retryer.js defaultRetryDelay): with `retry: 1` and no
// `retryDelay`, a failed /live read is asked again ~1 s later.
test('every query that retries waits at least 5 s before its retry (≤ 1 request / 5 s per source)', () => {
  const blocks = queryBlocks()
  assert.equal(blocks.length, 4, 'roster, live, history, health')
  for (const b of blocks) {
    const retry = (b.match(/\bretry: (\w+)/) || [])[1]
    if (retry === undefined || retry === 'false' || retry === '0') continue
    const delay = Number(((b.match(/\bretryDelay: ([\d_]+)/) || [])[1] || '0').replace(/_/g, ''))
    assert.ok(delay >= 5000, `a query with retry: ${retry} has no retryDelay >= 5000 ms:\n${b.slice(0, 120)}`)
  }
})

// One switch scheduled at the boundary hour, no polling. The page's clock (nowMs: wall clock, night,
// silence spans) is only recomputed when a read changes reference; React Query keeps `desks` by reference when a
// roster poll brings identical rows (structural sharing, measured with the host's replaceEqualDeep), so in roster-only
// mode with a quiet roster the wall clock and the day/night switch freeze. msUntilNextSwitch exists and is tested,
// but nothing schedules it.
test('the page does not derive its clock from data reads only (day/night switch and wall clock keep time)', () => {
  const page = src('src/ui/OfficePage.jsx')
  const memo = page.match(/const \{ office(?:: \w+)?, nowMs(?:: \w+)? \} = useMemo\([\s\S]*?\}, \[([^\]]*)\]\)/)
  assert.ok(memo, 'the nowMs memo of OfficePage is where the page clock is taken')
  const deps = memo[1].split(',').map(s => s.trim()).filter(Boolean)
  const dataOnly = deps.every(d => ['desks', 'live.data', 'history.data'].includes(d))
  const scheduled = /msUntilNextSwitch/.test(page) || /msUntilNextSwitch/.test(src('src/ui/OfficeScene.jsx'))
  assert.ok(!dataOnly || scheduled, `nowMs depends only on [${deps.join(', ')}] and no switch is scheduled`)
})
}

// ===== source-guards =====
{
// Proof tests (resilience and long-running behaviour of the page). Each one fails while the defect it names
// exists.
// Measurements come from the real Webapp driven over CDP
// (replies intercepted with Fetch + a WebSocket shim); these tests pin the cause in the source.
const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

// The useQuery({ ... }) option blocks of src/data/queries.js (same cut as tests/js/source-guards.test.mjs).
const queryBlocks = () => src('src/data/queries.js').split('useQuery({').slice(1).map(b => b.slice(0, b.indexOf('\n  })')))

// queries.js header: « A failed poll keeps the last good data » is written for /live. fetchRoster resolves a failed
// profiles.list (JSON-RPC error, null result, host timeout) to `{ ok: false, desks: [] }`: React Query sees a SUCCESS with an
// empty roster, replaces the last good one, and OfficePage swaps the whole office for « Backend unreachable » (scene unmounted,
// remounted on the next good poll: 120-250 ms long task). Measured: one failing reply -> unmounted within 5 s.
test('a failed profiles.list keeps the last good roster (it is thrown, like /live), not replaced by an empty one', () => {
  const fn = src('src/data/queries.js').match(/async function fetchRoster\(\) \{[\s\S]*?\n\}/)
  assert.ok(fn, 'fetchRoster exists')
  const failBranch = fn[0].match(/if \(!res\.ok\)[^\n]*/)
  assert.ok(failBranch, 'fetchRoster handles a failed read')
  assert.match(failBranch[0], /throw/, `a failed read must not resolve to an empty roster: ${failBranch[0].trim()}`)
})

// A failing /live (HTTP 500, ok:false, truncated JSON, network error, 8 s timeout) leaves the page showing the last reading with no
// sign at all (measured: no banner, no text change, for every failure shape; only the hover tooltip says « read at hh:mm »).
// OfficePage never looks at the query's failure state.
test('the page says so when /live is failing (the last reading is shown as stale), not only in a tooltip', () => {   // behaviour in page.test.mjs
  const page = src('src/ui/OfficePage.jsx')
  assert.match(page, /\blive\.(isError|isRefetchError|errorUpdatedAt|failureCount|isStale)\b/, 'OfficePage reads the failure / staleness of the /live query')
})

// toBoard() gives every board without a usable slug the same name 'board'; the scene keys its zone labels by slug
// (OfficeScene.jsx `key={`b:${b.slug}`}`), so two of them collide: React keeps phantom labels (measured: 3 extra « board 3/12 blocked »
// labels still on screen 22 s after the data returned to normal, until a reload).
test('boards without a slug do not share one slug (zone keys stay unique)', () => {
  const office = buildOffice([], { ok: true, boards: [{ tasks: [] }, { tasks: [] }, { slug: 5, tasks: [] }] })
  const slugs = office.boards.map(b => b.slug)
  assert.equal(new Set(slugs).size, slugs.length, `slugs: ${slugs.join(', ')}`)
})

// Polling only while the page is mounted AND the window is visible. refetchIntervalInBackground: false is
// guarded above, but React Query's default refetchOnReconnect: true fires when the browser comes back online even if the
// page is hidden (measured: `online` event with document.hidden === true -> 1 /live + 1 /history + 1 profiles.list within 10 s).
test('no query refetches on reconnect while the window is hidden (refetchOnReconnect off, or visibility-gated)', () => {
  const blocks = queryBlocks().filter(b => /refetchInterval/.test(b))
  assert.equal(blocks.length, 4, 'roster, live, history, health')
  for (const b of blocks) assert.match(b, /refetchOnReconnect:\s*false/, `no refetchOnReconnect: false in:\n${b.slice(0, 100)}`)
})

// « Waiting for you » lists every blocked card (SidePanel.jsx `items.map`): 2 000 blocked cards -> 2 000 rows (DOM 1 951 -> 12 665
// nodes at 10 000 cards, long tasks up to 269 ms per poll). The inspector is capped (INSPECTOR_WAITING_MAX = 4, « +N »), the inbox is not.
test('the decision inbox renders a bounded number of rows (cap + « N more », or windowing)', () => {   // behaviour in inbox.test.mjs
  // the inbox is the Decisions tab (src/ui/DecisionsTab.jsx); its rows are built from the bounded view only
  const panel = src('src/ui/DecisionsTab.jsx')
  assert.match(panel.slice(panel.indexOf('function DecisionsTab'), panel.indexOf('data-inbox')), /inboxView\(/, 'the inbox rows come from the bounded view')
  assert.match(panel, /decisionRows\(view, office\)/, 'only the rows of that view are built...')
  assert.match(panel, /rs\.map\(one\)/, '...and drawn')
  assert.doesNotMatch(panel, /items\.map\(/, 'never the whole list of blocked cards')
})

// The baked base (floor, walls, furniture: buildBase, 180-210 ms for 13 agents / 4 boards, ~260-300 ms for 30 / 8, measured in the real
// Webapp) is rebuilt every minute because `baseKey` carries Math.floor(nowMs / 60_000) (the wall clock is drawn in the base):
// an idle office with nothing to animate still blocks the main thread for 111-211 ms once a minute (5 long tasks in 300 s, at
// page seconds 65, 129, 188, 248, 308). The clock hands belong to the per-frame layer, or the key to a coarser bucket.
test('the minute of the wall clock is not part of the baked-base key (no full rebuild per minute at rest)', () => {   // the hands are drawn per frame (src/scene/clock.js), behaviour in clock.test.mjs
  const scene = src('src/ui/OfficeScene.jsx')
  const key = scene.match(/const baseKey = [\s\S]*?\n\n/)
  assert.ok(key, 'baseKey exists')
  assert.doesNotMatch(key[0], /nowMs\s*\/\s*60_?000/, `baseKey changes every minute:\n${key[0].slice(0, 200)}`)
})
}

// ===== source-guards =====
{
// Proof tests (quality of the tests and of the code). Each one fails while the defect it names exists.
//
// Some guards read the SOURCE TEXT of src/ui and src/data (useQuery and React cannot run under node).
// The tests below replay the guard's own check, verbatim, on a copy of the real source carrying a mutant that breaks the
// behaviour the guard is named after. The guard must reject the mutant.
// When such a guard is replaced by a behavioural test, update or drop the matching proof test here.
const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const mutate = (text, find, repl) => {
  assert.equal(text.split(find).length, 2, `the mutated line is still in the source: ${find}`)
  return text.replace(find, repl)
}

// --- the guards, copied verbatim from the files that own them --------------------------------------------------------------
// the polling guard
// (the shared one of tests/js/helpers/polling-guard.mjs — it is replayed here on the mutants)
const sharedGuard = pollingGuard
const rejects = (guard, text) => {
  try { guard(text) } catch { return true }
  return false
}

test('rejects a /live polled every second (the default interval of useLive, not only the exported constants)', () => {
  const q = src('src/data/queries.js')
  assert.equal(rejects(sharedGuard, q), false, 'control: the guard accepts the real source')
  // mutant: OfficePage calls useLive(ctx, enabled) without an interval, so this default IS the /live poll (<= 1 / 5 s)
  const m = mutate(q, 'export function useLive(ctx, enabled, intervalMs = PAGE_POLL_MS)', 'export function useLive(ctx, enabled, intervalMs = 1_000)')
  assert.ok(rejects(sharedGuard, m), 'the guard accepts /live polled every 1 s')
})

test('rejects a /history polled every 10 min (/history <= 60 s; only « >= 5 s » is checked)', () => {
  const q = src('src/data/queries.js')
  const m = mutate(q, 'export const HISTORY_POLL_MS = 60_000', 'export const HISTORY_POLL_MS = 600_000')
  assert.ok(rejects(sharedGuard, m), 'the guard accepts a /history read every 10 minutes')
})

// The logic of the « sober » flag and of the panel's focus lives in src/core/page.js, not in the component, and is checked
// by VALUE (a mutant that forces `sober`, or loses the focus in the wide layout, fails a test; an equivalent rewrite does not).
test('a page whose game layer can never show (sober forced to true) is rejected by value', () => {
  const full = { mode: 'full', agents: [], boards: [] }
  assert.equal(soberOf(true, { ok: true }, full), false, 'game on, /history ok, /live read: the game shows')
  const page = src('src/ui/OfficePage.jsx')
  assert.doesNotMatch(page, /sober\s*=[^\n]*\|\|\s*true/, 'no forced sober in the page')
  assert.match(page, /pageModel\(/, 'the page takes sober from pageModel')
})

test('a closePanel that gives the focus back in the narrow layout only is rejected by value', () => {
  assert.equal(panelCloseEffects({ narrow: false }).focusToggle, true, 'wide layout keeps the keyboard')
  assert.equal(panelCloseEffects({ narrow: true }).focusToggle, true)
  assert.match(src('src/ui/OfficePage.jsx'), /if \(fx\.focusToggle\) toggleRef\.current\?\.focus\(\)/, 'and the page obeys it, unconditionally on the layout')
})

test('a rewrite that keeps the behaviour is accepted (the rule is pinned, not the spelling)', () => {
  const grid = [true, false, undefined]
  const hist = [null, undefined, { ok: false }, { ok: true }]
  const office = [{ mode: 'full' }, { mode: 'roster' }, null]
  for (const g of grid) for (const h of hist) for (const o of office) {
    const rewrite = gameShown(g, h, o) === false   // same truth table, other spelling
    assert.equal(soberOf(g, h, o), rewrite, `${g} ${JSON.stringify(h)} ${JSON.stringify(o)}`)
  }
})

// --- dead code ------------------------------------------------------------------------------------------------------------
// src/ui/styles.js is imported as a namespace (`import * as s`) by OfficePage.jsx and SettingsForm.jsx; three of its exports
// (`grid`, `desk`, `zone`: an earlier card-grid layout) are read by nobody (esbuild drops them from the bundle).
test('every style exported by src/ui/styles.js is used by a component', () => {
  const styles = src('src/ui/styles.js')
  const users = ['src/ui/OfficePage.jsx', 'src/ui/SettingsForm.jsx'].map(src).join('\n')
  const code = styles.replace(/\/\/.*$/gm, '').replace(/'[^'\n]*'|`[^`]*`/g, "''")   // identifiers only: no comments, no strings
  const unused = [...styles.matchAll(/^export (?:const|function) ([A-Za-z_$][\w$]*)/gm)]
    .map(m => m[1])
    .filter(name => !new RegExp(`\\bs\\.${name}\\b`).test(users) && code.split(new RegExp(`\\b${name}\\b`)).length <= 2)
  assert.deepEqual(unused, [], `styles nobody reads: ${unused.join(', ')}`)
})

// tests/js/i18n.test.mjs refuses a key missing from (or extra in) fr/es, never a key that no code asks for: 6 keys of en
// (x3 languages) are translated and shipped but never displayed.
test('every i18n key of en.js is asked for by the code', () => {
  const keys = []
  const walk = (o, p) => { for (const [k, v] of Object.entries(o)) (v && typeof v === 'object' && !Array.isArray(v) ? walk(v, `${p}${k}.`) : keys.push(`${p}${k}`)) }
  walk(en, '')
  // every source file except the dictionaries themselves
  const files = readdirSync(new URL('../../src/', import.meta.url), { recursive: true })
    .filter(f => /\.jsx?$/.test(f) && !f.startsWith('i18n'))
  assert.ok(files.length > 40, `source files found: ${files.length}`)
  const code = files.map(f => src(`src/${f}`)).join('\n')
  // dynamic keys: `prefix${…}` templates and 'prefix.' + x concatenations
  const prefixes = [...code.matchAll(/`([a-zA-Z][\w.]*)\$\{/g), ...code.matchAll(/'([a-zA-Z][\w.]*\.)'\s*\+/g)].map(m => m[1])
  const unused = keys.filter(k => !new RegExp(`['"\`]${k.replace(/\./g, '\\.')}['"\`]`).test(code) && !prefixes.some(p => k.startsWith(p)))
  assert.deepEqual(unused, [], `keys no code asks for: ${unused.join(', ')}`)
})
}
