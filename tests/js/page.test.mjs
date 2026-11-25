import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DRAWER_BELOW, bannerOf, bodyOf, drawerKeyCloses, pageModel, panelCloseEffects, partialSources, partialView, soberOf, staleOf, FIT_MARGIN, foldKey, foldPlan, foldStep, sceneFitsAlone, sceneFitsBeside, MAIN_GAP, STAGE_EDGE, forcedStep, panelToggle, panelWidthOf, readingCurrent, panelPlan } from '../../src/core/page.js'
import { toHistory, toPartial } from '../../src/core/history.js'
import { messages } from '../../src/i18n/index.js'
import { fitScale } from '../../src/scene/fit.js'
import { readFileSync } from 'node:fs'
import { taskTag } from '../../src/core/hud.js'
import { labelOf } from '../../src/scene/labels.js'
import { PAGE_CSS } from '../../src/ui/pageStyles.js'

// ===== page =====
{
// The page's decisions as pure functions (src/core/page.js), tested by value under node.
// One discreet `role="status"` banner when /live keeps failing (errorUpdatedAt > dataUpdatedAt) and when a source is partial.
const OFFICE = { mode: 'full', agents: [], boards: [], ops: null }
const HIST = { ok: true, profiles: {}, boards: [] }

/* ---------- soberOf ---------- */
test('soberOf: the game shows only when it is on AND /history answered AND the office is complete', () => {
  assert.equal(soberOf(true, HIST, OFFICE), false)
  assert.equal(soberOf(false, HIST, OFFICE), true, 'game off')
  assert.equal(soberOf(true, null, OFFICE), true, 'no /history')
  assert.equal(soberOf(true, { ok: false }, OFFICE), true, 'history failed')
  assert.equal(soberOf(true, HIST, { ...OFFICE, mode: 'roster' }), true, 'roster-only office')
  assert.equal(soberOf(true, undefined, OFFICE), true)
})

/* ---------- panelCloseEffects ---------- */
test('panelCloseEffects: the focus always goes back to the toggle; narrow closes the drawer, wide folds the panel', () => {
  assert.deepEqual(panelCloseEffects({ narrow: true }), { closeDrawer: true, foldPanel: false, focusToggle: true })
  assert.deepEqual(panelCloseEffects({ narrow: false }), { closeDrawer: false, foldPanel: true, focusToggle: true })
})
test('drawerKeyCloses: only Escape, only while a narrow drawer is open', () => {
  assert.equal(drawerKeyCloses({ narrow: true, drawerOpen: true }, 'Escape'), true)
  assert.equal(drawerKeyCloses({ narrow: true, drawerOpen: true }, 'Enter'), false)
  assert.equal(drawerKeyCloses({ narrow: true, drawerOpen: false }, 'Escape'), false)
  assert.equal(drawerKeyCloses({ narrow: false, drawerOpen: true }, 'Escape'), false)
})

/* ---------- bodyOf / pageModel ---------- */
const base = { width: 1200, drawerOpen: false, wideOpen: true, roster: { isLoading: false, isError: false, hasData: true }, deskCount: 3, gameOn: true, history: HIST, office: OFFICE, live: { data: { ok: true }, dataUpdatedAt: 1000, errorUpdatedAt: 0 } }
test('bodyOf: loading, unreachable (no reading at all), empty, office — a failure after a good read keeps the office', () => {
  assert.equal(bodyOf({ isLoading: true, isError: false, hasData: false, deskCount: 0 }), 'loading')
  assert.equal(bodyOf({ isLoading: true, isError: false, hasData: true, deskCount: 2 }), 'office', 'refetching with data is not loading')
  assert.equal(bodyOf({ isLoading: false, isError: true, hasData: false, deskCount: 0 }), 'unreachable')
  assert.equal(bodyOf({ isLoading: false, isError: true, hasData: true, deskCount: 2 }), 'office', 'an error after a good read keeps the office')
  assert.equal(bodyOf({ isLoading: false, isError: false, hasData: true, deskCount: 0 }), 'empty')
  assert.equal(bodyOf({ isLoading: false, isError: false, hasData: true, deskCount: 5 }), 'office')
})
test('pageModel: narrow below DRAWER_BELOW, the panel follows the drawer (narrow) or the preference (wide), nothing before the first measure', () => {
  assert.equal(DRAWER_BELOW, 701, 'one view at a time up to 700 px of pane (NARROW_AT + 1); it was 900 px and a drawer')
  assert.deepEqual([pageModel(base).narrow, pageModel(base).panelOpen], [false, true])
  assert.deepEqual([pageModel({ ...base, wideOpen: false }).panelOpen], [false])
  const n = pageModel({ ...base, width: 700, drawerOpen: false })
  assert.deepEqual([n.narrow, n.panelOpen], [true, false], 'a narrow pane ignores the wide preference')
  assert.equal(pageModel({ ...base, width: 700, drawerOpen: true }).panelOpen, true)
  assert.equal(pageModel({ ...base, width: 701 }).narrow, false)
  const unmeasured = pageModel({ ...base, width: 0 })
  assert.deepEqual([unmeasured.narrow, unmeasured.panelOpen], [false, false])
})
test('pageModel: sober, game bar and body are decided together', () => {
  const m = pageModel(base)
  assert.deepEqual([m.sober, m.showGameBar, m.body], [false, true, 'office'])
  const sober = pageModel({ ...base, gameOn: false })
  assert.deepEqual([sober.sober, sober.showGameBar], [true, false])
  assert.equal(pageModel({ ...base, deskCount: 0 }).showGameBar, false, 'no desk, no game bar')
})

/* ---------- staleness ---------- */
test('staleOf: stale once a failure is newer than the last good reading, and only if there is a reading', () => {
  assert.equal(staleOf({ dataUpdatedAt: 1000, errorUpdatedAt: 2000 }), 1000, 'the banner says the time of the data')
  assert.equal(staleOf({ dataUpdatedAt: 2000, errorUpdatedAt: 1000 }), null, 'a later good reading clears it')
  assert.equal(staleOf({ dataUpdatedAt: 1000, errorUpdatedAt: 1000 }), null, 'strictly newer')
  assert.equal(staleOf({ dataUpdatedAt: 0, errorUpdatedAt: 5000 }), null, 'never read: nothing to call stale')
  assert.equal(staleOf({}), null)
  assert.equal(staleOf(null), null)
})

/* ---------- partial ---------- */
test('toPartial: the form of « partial » in the data contract — closed reasons, bounded, no text of an exception', () => {
  assert.deepEqual(toPartial([{ source: 'kanban:alpha', reason: 'locked' }, { source: 'profiles', reason: 'unreadable' }]), [{ source: 'kanban:alpha', reason: 'locked' }, { source: 'profiles', reason: 'unreadable' }])
  assert.deepEqual(toPartial([{ source: 'cron', reason: 'Traceback: /home/x/secret.db is not a database' }]), [{ source: 'cron', reason: 'unreadable' }], 'a reason outside the list is not repeated')
  assert.deepEqual(toPartial([{ source: '/home/x/secret.db', reason: 'missing' }, { source: '', reason: 'missing' }, null, 'x', { reason: 'missing' }]), [], 'a source that is not a name of the contract is dropped')
  assert.deepEqual(toPartial([{ source: 'ops', reason: 'missing' }, { source: 'ops', reason: 'missing' }]), [{ source: 'ops', reason: 'missing' }], 'no duplicate')
  assert.equal(toPartial(Array.from({ length: 100 }, (_, i) => ({ source: `kanban:b${i}`, reason: 'schema' }))).length, 60)
  assert.equal(toPartial(undefined), null, 'absent (older agent): no field, no chip')
  assert.equal(toPartial('x'), null)
  assert.deepEqual(toPartial([]), [])
})
test('toHistory keeps `partial` when the agent serves it, and has no such key when it does not', () => {
  const body = { ok: true, profiles: [], boards: [] }
  assert.equal('partial' in toHistory(body), false)
  assert.deepEqual(toHistory({ ...body, partial: [{ source: 'sessions:bot', reason: 'locked' }] }).partial, [{ source: 'sessions:bot', reason: 'locked' }])
})
test('partialSources: /live and /history are merged, one entry per source, sorted; absent field = nothing', () => {
  assert.deepEqual(partialSources(null, null), [])
  assert.deepEqual(partialSources({ ok: true }, { ok: true }), [])
  const live = { ok: true, partial: [{ source: 'kanban:beta', reason: 'locked' }] }
  const history = { ok: true, partial: [{ source: 'kanban:beta', reason: 'locked' }, { source: 'cron', reason: 'unreadable' }] }
  assert.deepEqual(partialSources(live, history).map(p => p.source), ['cron', 'kanban:beta'])
})
test('partialView: a source is split into its kind and name; an unknown kind is said as « a source »; a long list is cut', () => {
  const v = partialView([{ source: 'kanban:alpha', reason: 'locked' }, { source: 'gateway', reason: 'missing' }, { source: 'weird:thing', reason: 'schema' }], 5)
  assert.deepEqual(v.labels, [{ kind: 'kanban', name: 'alpha' }, { kind: 'gateway', name: '' }, { kind: 'unknown', name: '' }])
  assert.equal(v.more, 0)
  const many = partialView(Array.from({ length: 9 }, (_, i) => ({ source: `kanban:b${i}`, reason: 'locked' })), 4)
  assert.deepEqual([many.labels.length, many.more], [4, 5])
})

/* ---------- the banner ---------- */
test('bannerOf: one banner for both causes, none when everything is fine', () => {
  assert.equal(bannerOf({ live: { data: { ok: true }, dataUpdatedAt: 5, errorUpdatedAt: 0 }, history: HIST }), null)
  assert.deepEqual(bannerOf({ live: { data: { ok: true }, dataUpdatedAt: 5, errorUpdatedAt: 9 }, history: HIST }), { staleMs: 5, partial: { labels: [], more: 0 } })
  const both = bannerOf({ live: { data: { ok: true, partial: [{ source: 'ops', reason: 'unreadable' }] }, dataUpdatedAt: 5, errorUpdatedAt: 9 }, history: HIST })
  assert.deepEqual([both.staleMs, both.partial.labels.length], [5, 1])
  const partialOnly = bannerOf({ live: { data: { ok: true }, dataUpdatedAt: 5, errorUpdatedAt: 0 }, history: { ...HIST, partial: [{ source: 'profiles', reason: 'unreadable' }] } })
  assert.deepEqual([partialOnly.staleMs, partialOnly.partial.labels[0].kind], [null, 'profiles'])
  assert.equal(pageModel({ ...base, live: { data: { ok: true }, dataUpdatedAt: 5, errorUpdatedAt: 9 } }).banner.staleMs, 5)
  assert.equal(pageModel(base).banner, null)
})
test('the banner sentences exist in EN, FR, ES and carry the time / the sources', () => {
  for (const lang of ['en', 'fr', 'es']) {
    const b = messages[lang].banner
    assert.match(b.stale('14:32'), /14:32/, lang)
    assert.match(b.partial('x, y'), /x, y/, lang)
    for (const kind of ['kanban', 'profiles', 'sessions', 'gateway', 'ops', 'cron', 'unknown']) {
      assert.ok(typeof (typeof b.source[kind] === 'function' ? b.source[kind]('n') : b.source[kind]) === 'string', `${lang} ${kind}`)
    }
    assert.match(b.more(3), /3/)
  }
  assert.equal(messages.fr.banner.stale('14:32'), 'Données de 14:32 : l’actualisation échoue.')
})
}

// ===== page =====
{
// The panel fold must not oscillate (React #185, 7 agents / 2 projects, 380 -> 1024 px with an agent selected).
// Cause: src/core/page.js foldStep predicts « fits beside the panel » from one reading; the scene then measures the OTHER panel state
// differently (list beside, scene alone), so folded -> unfold -> list -> fold ... every render. foldPlan breaks the cycle by construction.
const ART = { W: 520, H: 400, availH: 700, dpr: 1, people: 12, mode: 'scene' }
// a pane where the prediction says « fits beside with room to spare » (so a folded panel is told to come back)
let ROOMY = 700
while (!sceneFitsBeside(ROOMY, ART, FIT_MARGIN)) ROOMY++

/** What the scene reports for a panel state: `contradicts` = the reading beside the panel is a list although the prediction said it fits. */
const measure = (folded, paneW, contradicts) => ({ ...ART, mode: folded || !contradicts ? 'scene' : 'list', availH: folded ? 700 : 640 })

function run(step, { paneW, contradicts, turns = 40 }) {
  let st = { folded: false, refused: '' }
  let flips = 0
  for (let i = 0; i < turns; i++) {
    const art = measure(st.folded, paneW, contradicts)
    const next = step({ ...st, wideOpen: true, paneW, art })
    if (next.folded !== st.folded) flips++
    st = next
  }
  return { flips, st }
}

test('cause: foldStep alone, fed by a scene that contradicts its prediction, flips on every turn (the render loop)', () => {
  const alone = a => ({ folded: foldStep(a), refused: '' })
  const { flips } = run(alone, { paneW: ROOMY, contradicts: true })
  assert.ok(flips >= 30, `foldStep alone oscillates (${flips} flips in 40 turns)`)
})

test('foldPlan: the same contradicting scene settles after one fold', () => {
  const { flips, st } = run(foldPlan, { paneW: ROOMY, contradicts: true })
  assert.ok(flips <= 1, `${flips} flips`)
  assert.equal(st.folded, true, 'ends folded (the office is drawn, the panel waits)')
})

test('foldPlan: no oscillation for any pane width, with or without a contradiction', () => {
  for (const contradicts of [false, true]) for (let w = 320; w <= 1920; w += 7) {
    const { flips } = run(foldPlan, { paneW: w, contradicts, turns: 30 })
    assert.ok(flips <= 1, `pane ${w} contradicts=${contradicts}: ${flips} flips`)
  }
})

test('foldPlan: a fold is undone once an input changed (resize, roster), and not before', () => {
  const folded = { folded: true, wideOpen: true, art: ART }
  const key = foldKey(ROOMY, ART)
  assert.equal(foldPlan({ ...folded, refused: key, paneW: ROOMY }).folded, true, 'same inputs: stays folded')
  assert.equal(foldPlan({ ...folded, refused: key, paneW: ROOMY + 40 }).folded, false, 'wider pane: comes back')
  assert.equal(foldPlan({ ...folded, refused: key, paneW: ROOMY, art: { ...ART, people: 13 } }).folded, false, 'another roster: comes back')
  assert.equal(foldPlan({ ...folded, refused: '', paneW: ROOMY }).folded, false, 'a fold nobody took on these inputs (nothing refused): ordinary rule')
})

test('foldPlan keeps foldStep\'s own rules (fold on a real list, nothing without wish or measure)', () => {
  const list = { ...ART, mode: 'list' }
  let p = 700
  while (sceneFitsBeside(p, ART)) p++
  assert.ok(sceneFitsAlone(p, ART))
  const r = foldPlan({ folded: false, wideOpen: true, paneW: p, art: list })
  assert.equal(r.folded, true)
  assert.equal(r.refused, foldKey(p, list))
  assert.deepEqual(foldPlan({ folded: true, refused: 'x', wideOpen: false, paneW: p, art: list }), { folded: false, refused: '' })
  assert.deepEqual(foldPlan({ folded: true, refused: 'x', wideOpen: true, paneW: p, art: null }), { folded: false, refused: '' })
})
}

// ===== page =====
{
// The panel must not fold on a STALE reading (380 -> 1024 px: the scene still reports the narrow list), and the user's
// button always opens it. The guarantee of foldPlan (no loop by construction) stays: see above.
const ART = { W: 520, H: 400, dpr: 1, people: 7 }
const PANE = 1024
const BESIDE = PANE - panelWidthOf(PANE) - MAIN_GAP - STAGE_EDGE
const ALONE = PANE - STAGE_EDGE
// what the scene reports: at the width it was measured, with the mode it chose there
const read = (availW, mode, availH = 700) => ({ ...ART, availW, availH, mode })
const STALE = read(378, 'list')   // the 380 px list, still reported while the pane is already 1024 px

test('readingCurrent: a reading is current at the width of its panel state, stale at another', () => {
  assert.equal(readingCurrent({ paneW: PANE, panelShown: true, art: read(BESIDE, 'scene') }), true)
  assert.equal(readingCurrent({ paneW: PANE, panelShown: false, art: read(ALONE, 'scene') }), true)
  assert.equal(readingCurrent({ paneW: PANE, panelShown: true, art: STALE }), false)
  assert.equal(readingCurrent({ paneW: PANE, panelShown: true, art: read(ALONE, 'scene') }), false, 'read alone is not read beside the panel')
  assert.equal(readingCurrent({ paneW: PANE, panelShown: true, art: { ...ART, availH: 700, mode: 'list' } }), true, 'no availW: older caller, current')
})

test('380 -> 1024 px: the stale list reading does not fold the panel, nor remember the new width; the fresh reading keeps it open', () => {
  let st = { folded: false, refused: '' }
  st = foldPlan({ ...st, wideOpen: true, paneW: PANE, art: STALE })
  assert.deepEqual(st, { folded: false, refused: '' }, 'stale: nothing decided')
  // the scene catches up: the office fits beside the panel at 1024 px (7 agents)
  const fresh = read(BESIDE, 'scene')
  assert.ok(sceneFitsBeside(PANE, fresh))
  st = foldPlan({ ...st, wideOpen: true, paneW: PANE, art: fresh })
  assert.equal(st.folded, false, 'the panel stays open')
})

test('a really listed office read at the current width still folds the panel (one fold, then it settles)', () => {
  const list = read(BESIDE, 'list', 400)
  let st = { folded: false, refused: '' }
  let flips = 0
  for (let i = 0; i < 20; i++) {
    const art = st.folded ? read(ALONE, 'scene', 400) : list
    const next = foldPlan({ ...st, wideOpen: true, paneW: PANE, art })
    if (next.folded !== st.folded) flips++
    st = next
  }
  assert.ok(flips <= 1, `${flips} flips`)
})

test('readings measured live are current, at 1024 px with the list scrollbar and on a wide pane (1920 px, 400 px panel)', () => {
  // values read in the real webapp: pane 732 (1024 px window) list beside the panel = 358; pane 1628 (1920 px
  // window, .ux-main 400 px column from 1500 px of container) scene beside the panel = 1214
  assert.equal(readingCurrent({ paneW: 732, panelShown: true, art: read(358, 'list', 229) }), true, 'list with its scrollbar at 1024 px')
  assert.equal(readingCurrent({ paneW: 1628, panelShown: true, art: read(1214, 'scene') }), true, 'scene beside the 400 px panel')
  // a list beside the wide panel (scrollbar: 32 px less) must still be able to fold it
  assert.equal(foldPlan({ folded: false, refused: '', wideOpen: true, paneW: 1628, art: read(1214 - 32, 'list') }).folded, true)
  assert.equal(panelWidthOf(1500), 400)
  assert.equal(panelWidthOf(1499), 360)
})

test('the button opens: a click clears the refusal, a held panel is not folded again at that width, and a stale reading does not end `forced`', () => {
  // folded by the page, refused on these inputs
  const folded = { folded: true, refused: 'k', wideOpen: true, paneW: PANE, art: read(ALONE, 'scene') }
  const tg = panelToggle({ shown: false, forced: false, folded: true, wideOpen: true, fits: false })
  assert.deepEqual(tg, { wideOpen: undefined, forced: true })
  // the page: refused cleared, held = PANE; the panel is now shown (forced), the scene has not re-measured yet
  assert.equal(forcedStep({ forced: true, paneW: PANE, art: read(ALONE, 'scene') }), true, 'the reading taken alone does not release it')
  assert.equal(forcedStep({ forced: true, paneW: PANE, art: STALE }), true, 'nor the stale one')
  // fresh list reading beside the panel: stays forced (the office says it is a list), and no fold at this width
  const beside = read(BESIDE, 'list', 400)
  assert.equal(forcedStep({ forced: true, paneW: PANE, art: beside }), true)
  assert.equal(foldPlan({ folded: false, refused: '', wideOpen: true, paneW: PANE, art: beside, held: PANE }).folded, false, 'held: no fold at this width')
  assert.equal(foldPlan({ folded: false, refused: '', wideOpen: true, paneW: PANE, art: beside, held: null }).folded, true, 'without the gesture it would fold')
  // once the scene is drawn beside the panel, forced is released
  assert.equal(forcedStep({ forced: true, paneW: PANE, art: read(BESIDE, 'scene') }), false)
  // the refusal no longer holds a folded panel once cleared
  assert.equal(foldPlan({ ...folded, refused: '' }).folded, false)
})
}

// ===== page =====
{
// The panel yields to the office. The threshold is the scene's own (fitScale), applied to the width beside the panel.
const ART = { W: 520, H: 400, availH: 700, dpr: 1, people: 12, mode: 'scene' }
const base = { width: 1000, drawerOpen: false, wideOpen: true, roster: [], deskCount: 0, gameOn: false, history: null, office: null, live: null }

test('the width of the panel: 328 px up to 1320 px, 360 beyond, 400 from 1500 px (pageStyles.js container queries)', () => {
  assert.equal(panelWidthOf(1024), 328)
  assert.equal(panelWidthOf(1320), 328)
  assert.equal(panelWidthOf(1321), 360)
  assert.equal(panelWidthOf(1499), 360)
  assert.equal(panelWidthOf(1500), 400)
})

test('sceneFitsBeside asks the scene\'s own rule of the width the panel leaves, and nothing is measured -> fits', () => {
  assert.equal(sceneFitsBeside(1000, null), true)
  // the boundary is where fitScale itself flips, not a number of the page
  let flip = null
  for (let w = 700; w < 1400; w++) {
    const mode = fitScale({ availW: w - panelWidthOf(w) - 12 - 2, availH: ART.availH, W: ART.W, H: ART.H, dpr: 1, people: ART.people }).mode
    assert.equal(sceneFitsBeside(w, ART), mode === 'scene', `pane ${w}`)
    if (mode === 'scene' && flip === null) flip = w
  }
  assert.ok(flip > 700 && flip < 1400, `the flip is inside the range (${flip})`)
  assert.equal(sceneFitsBeside(flip - 1, ART), false)
  assert.equal(sceneFitsBeside(flip, ART), true)
  assert.equal(sceneFitsAlone(flip - 1, ART), true, 'the whole pane still draws it: folding the panel helps')
})

test('foldStep: folds when the scene really fell to a list, unfolds only with room to spare (no flicker)', () => {
  const list = { ...ART, mode: 'list' }
  let flip = 700
  while (!sceneFitsBeside(flip, ART)) flip++
  const short = flip - 1
  assert.equal(foldStep({ folded: false, wideOpen: true, paneW: short, art: list }), true)
  assert.equal(foldStep({ folded: false, wideOpen: true, paneW: short, art: ART }), false, 'a scene still drawn: nothing folds')
  assert.equal(foldStep({ folded: false, wideOpen: false, paneW: short, art: list }), false, 'a panel nobody wants is not folded')
  assert.equal(foldStep({ folded: false, wideOpen: true, paneW: short, art: null }), false, 'nothing measured: no fold')
  // folded: stays folded at the flip itself, comes back when FIT_MARGIN more room is there
  assert.equal(foldStep({ folded: true, wideOpen: true, paneW: flip, art: ART }), true, 'at the flip: stays folded')
  let back = flip
  while (!sceneFitsBeside(back, ART, FIT_MARGIN)) back++
  assert.ok(back > flip)
  assert.equal(foldStep({ folded: true, wideOpen: true, paneW: back - 1, art: ART }), true)
  assert.equal(foldStep({ folded: true, wideOpen: true, paneW: back, art: ART }), false)
})

test('foldStep: when even the whole pane would give a list, the panel does not fold for nothing', () => {
  const list = { ...ART, mode: 'list' }
  assert.equal(foldStep({ folded: false, wideOpen: true, paneW: 300, art: list }), false)
})

test('panelPlan: the page folds a wished panel; the user forcing it open shows it and says the scene is a list', () => {
  assert.deepEqual(panelPlan({ wideOpen: true, forced: false, folded: false, listed: false }), { open: true, autoFolded: false, listBeside: false })
  assert.deepEqual(panelPlan({ wideOpen: true, forced: false, folded: true, listed: false }), { open: false, autoFolded: true, listBeside: false })
  assert.deepEqual(panelPlan({ wideOpen: true, forced: true, folded: true, listed: true }), { open: true, autoFolded: false, listBeside: true })
  assert.deepEqual(panelPlan({ wideOpen: false, forced: false, folded: false, listed: false }), { open: false, autoFolded: false, listBeside: false })
})

test('panelToggle: closing a forced panel leaves the wish alone; opening a page-folded one forces it; closing a plain one is a wish', () => {
  assert.deepEqual(panelToggle({ shown: true, forced: true, folded: true, wideOpen: true, fits: false }), { wideOpen: undefined, forced: false })
  assert.deepEqual(panelToggle({ shown: true, forced: false, folded: false, wideOpen: true, fits: true }), { wideOpen: false, forced: false })
  assert.deepEqual(panelToggle({ shown: false, forced: false, folded: true, wideOpen: true, fits: false }), { wideOpen: undefined, forced: true })
  assert.deepEqual(panelToggle({ shown: false, forced: false, folded: false, wideOpen: false, fits: true }), { wideOpen: true, forced: false })
  assert.deepEqual(panelToggle({ shown: false, forced: false, folded: false, wideOpen: false, fits: false }), { wideOpen: true, forced: true })
})

test('pageModel: a folded panel is closed and said (autoFolded); a forced one is open beside a list (listBeside)', () => {
  const folded = pageModel({ ...base, folded: true, art: { ...ART, mode: 'list' } })
  assert.equal(folded.panelOpen, false)
  assert.equal(folded.autoFolded, true)
  const forced = pageModel({ ...base, folded: true, forced: true, art: { ...ART, mode: 'list' } })
  assert.equal(forced.panelOpen, true)
  assert.equal(forced.listBeside, true)
  const plain = pageModel({ ...base, art: ART })
  assert.equal(plain.panelOpen, true)
  assert.equal(plain.listBeside, false)
})
}

// ===== page =====
{
// Defects seen in the real webapp and by mutation, each guarded here.
const ART = { W: 520, H: 400, availH: 700, dpr: 1, people: 12, mode: 'scene' }
const NOW = 1_800_000_000_000

// 1024 px window, host sidebar open: the page folded the panel and the office is drawn at the full width. The user opens the panel: the
// reading the scene sent BEFORE the panel was laid out still says « scene ». That reading must not undo the user's gesture.
test('a forced panel is not dropped on a reading taken before it opened (the panel opens at 1024 px)', () => {
  let short = 1400
  while (sceneFitsBeside(short, ART)) short--
  assert.equal(forcedStep({ forced: true, paneW: short, art: ART }), true, 'the office does not fit beside the panel: the panel stays forced')
  assert.equal(forcedStep({ forced: true, paneW: short, art: { ...ART, mode: 'list' } }), true, 'beside the panel, a list that says so')
  assert.equal(forcedStep({ forced: true, paneW: short + 1, art: ART }), false, 'the window grew: drawn beside the panel, an ordinary open panel')
  assert.equal(forcedStep({ forced: false, paneW: short, art: ART }), false)
  const page = readFileSync(new URL('../../src/ui/OfficePage.jsx', import.meta.url), 'utf8')
  assert.match(page, /forcedStep\(\{ forced, paneW: width, art \}\)/, 'the page asks forcedStep, not the bare mode of the last reading')
  assert.doesNotMatch(page, /if \(forced && art\?\.mode === 'scene'\) setForced\(false\)/)
})

// the code of the card that went silent is guarded too
test('a silent agent\'s label says its name and the code of the card that went silent', () => {
  const quiet = { state: 'stale', name: 'qa', silentMs: 3_600_000, running: [{ title: 'TEST5 — matrix', startedMs: NOW - 7_200_000 }] }
  assert.deepEqual(labelOf(quiet, taskTag(quiet, NOW)), { name: 'qa', code: 'TEST5' })
  const bare = { state: 'stale', name: 'qa', silentMs: 3_600_000, running: [] }
  assert.deepEqual(labelOf(bare, taskTag(bare, NOW)), { name: 'qa', code: '' })
})

// the real webapp, host sidebar open: header 732 px (1024 window) and 988 px (1280 window); its content needed 764 and 1007 px, the gear was cut.
// Measured with the streak segment folded: the actions end on the header's edge at 1024, 1280 (EN, ES) and nothing changes at 1440 (1148 px).
test('the streak leaves the header before the actions run past it (container of 988 px folds it, 1148 px keeps it)', async () => {
  const { PAGE_CSS } = await import('../../src/ui/pageStyles.js')
  const rules = [...PAGE_CSS.matchAll(/@container ux \(max-width: (\d+)px\)\{([^}]*\.ux-gs\[data-streak\]\{display:none\}[^}]*)\}/g)]
  assert.ok(rules.length, 'a container rule folds the streak segment')
  const at = Math.max(...rules.map(m => Number(m[1])))
  assert.ok(at >= 988 && at < 1148, `folds at ${at}: the 1280 px window with the sidebar (988) folds it, the 1440 one (1148) keeps it`)
})

// AX tree of the real webapp: under 1180 px of pane the word « All » is hidden by the container query, the button kept no name
test('the « All » filter of the dock keeps an accessible name when its word is folded', () => {
  const dock = readFileSync(new URL('../../src/ui/ProjectDock.jsx', import.meta.url), 'utf8')
  assert.match(dock, /className="ux-pj all"[^>]*aria-label=\{t\('ux\.dock\.all'\)\}/)
})
}

// ===== page =====
{
// Bugs reproduced in the real webapp, each kept as a test that fails without its fix.
//    (1)  1024 px window, panel open, an agent selected: the stage is 390 px wide (the scene falls back to the list) but the dock only wraps
//         under 700 px of PAGE width. The selected-agent bar (313 px, never shrinks) took the row and squeezed the project chips to
//         45 px: every project name was clipped to nothing (measured: name width 0 on all, `scrollWidth > clientWidth`). With 30 agents
//         and 8 boards the bar also sat on top of a chip. The dock now wraps by itself, whatever the page width.
/** The declarations of the FIRST top-level rule of `selector` (the base rule, not the ones inside a container query). */
const base = selector => {
  const re = new RegExp(`(?:^|\\n)${selector.replace(/[.[\]]/g, '\\$&')}\\{([^}]*)\\}`)
  const m = PAGE_CSS.match(re)
  assert.ok(m, `a base rule for ${selector}`)
  return m[1]
}

// The dock used to wrap (the selected-agent block took a second row and the room above lost 40 px at the click). It is now one row of a
// fixed height whatever the selection: the chips scroll, the selection is a block that never wraps.
test('the dock has a fixed height and never wraps: selecting an agent cannot move the room', () => {
  const dock = base('.ux-dock')
  assert.match(dock, /flex-wrap:nowrap/, 'one row')
  assert.match(dock, /height:48px/, 'a fixed height (a 32 px button + 2 x 8 px of padding; the rule is an inset shadow)')
  const chips = base('.ux-dk-l')
  assert.match(chips, /flex:1 1 0/, 'the chips take what the selection leaves')
  assert.match(chips, /flex-wrap:nowrap;[^}]*overflow-x:auto/, 'and scroll when they are too many')
  assert.match(base('.ux-pj'), /flex:0 0 auto/, 'a chip never shrinks (its name is cut by nothing: the row scrolls)')
  assert.match(base('.ux-sel'), /flex-wrap:nowrap/, 'the selection block stays on the row')
  assert.match(PAGE_CSS, /\.ux-dk-l\[data-compact\] \.ux-pj \.n\{display:none\}/, 'the count goes first')
  assert.match(PAGE_CSS, /\.ux-dk-l\[data-over\]\{[^}]*mask-image/, 'then the row scrolls and fades')
  const narrow = PAGE_CSS.match(/@container ux \(max-width: 700px\)\{([\s\S]*?)\n\}/)[1]
  assert.match(narrow, /\.ux-dock\{[^}]*height:80px/, 'a narrow pane: two rows of 28 px, always')
})

test('the dock keeps its row: the selected agent is described once (only with the panel hidden), the legend is a named button', () => {
  const dock = readFileSync(new URL('../../src/ui/ProjectDock.jsx', import.meta.url), 'utf8')
  assert.match(dock, /\{picked && showSel \? \(/, 'the block of the selected agent shows with the panel hidden only')
  assert.match(dock, /\{t\('insp\.open'\)\}/, 'its button says « Open session », like the sheet')
  assert.doesNotMatch(dock, /ux\.dock\.hint/, 'no hint line that comes and goes')
  const page = readFileSync(new URL('../../src/ui/OfficePage.jsx', import.meta.url), 'utf8')
  assert.match(page, /showSel=\{!panelOpen\}/)
  const legend = readFileSync(new URL('../../src/ui/Legend.jsx', import.meta.url), 'utf8')
  assert.match(legend, /<span>\{t\('legend\.button'\)\}<\/span><\/button>/, 'the legend button carries its word')
  assert.doesNotMatch(legend, />\?<\/button>/, 'the « ? » is the sign of a field help, not of the scene')
  for (const code of ['en', 'fr', 'es']) assert.ok(messages[code].legend.button.length > 3, code)
  assert.equal(messages.fr.insp.open, 'Ouvrir la session')
})

//    (2)  Agent tab, 380 px, a board with a long name (names are never short): the row « [project] [card code] [Decide] » did not wrap and
//         its box clips (`overflow:hidden`): measured 235 px of content in 222, the « Decide » link, the ACTION of the row, was cut off.
test('the waiting-decisions row of the Agent tab never clips its « Decide » button: the text beside it gives way (project chip and title are cut with an ellipsis)', () => {
  const tab = readFileSync(new URL('../../src/ui/AgentTab.jsx', import.meta.url), 'utf8')
  assert.ok(tab.split('\n').some(l => l.includes('key={`${w.board}/${w.id}`}') && l.includes('ux-ag-wr')), 'the row of a waiting decision')
  const css = PAGE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\.ux-ag-wr\{display:flex;[^}]*\}/)
  assert.match(css, /\.ux-ag-wr \.tx\{[^}]*flex:1 1 auto;min-width:0/, 'the text column shrinks')
  assert.match(css, /\.ux-ag-wt\{[^}]*overflow:hidden;text-overflow:ellipsis;white-space:nowrap/, 'the title is one line with an ellipsis')
  assert.match(css, /\.ux-b\{[^}]*flex:0 0 auto/, 'a button keeps its size')
})

//    (3)  Settings → General → Motion « Reduced »: the scene and the dialogs stop moving, but the page of the redesign only answered to the
//         OS `prefers-reduced-motion`. Measured in the real webapp with the setting on « Reduced »: the working-pill dot (`ux-pulse`, an
//         infinite 2 s animation) kept running, and so did every transition of the header, tabs and dock.
test('the Motion setting « Reduced » stops the animations of the page, not only the OS preference', async () => {
  const page = readFileSync(new URL('../../src/ui/OfficePage.jsx', import.meta.url), 'utf8')
  assert.match(page, /className="ux"[^>]*data-motion=\{motionPref\}/, 'the page root carries the motion preference')
  const rule = PAGE_CSS.match(/\.ux\[data-motion="reduced"\] \*[^{]*\{([^}]*)\}/)
  assert.ok(rule, 'a rule for the page under the Reduced setting')
  assert.match(rule[1], /animation:none!important/)
  assert.match(rule[1], /transition:none!important/)
})
}
