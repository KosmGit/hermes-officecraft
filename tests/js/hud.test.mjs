import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildOffice, STALE_AFTER_MS } from '../../src/core/office.js'
import { chooseView, codeRef, countPeople, formatSpan, listZones, rectsIntersect, taskTag, unclutter, foldCovering, foldOverlaps, foldRank, sceneFacts, legendRows, tagSaysState } from '../../src/core/hud.js'
import { FRAME_MS, createTicker, shouldAnimate } from '../../src/core/ticker.js'
import { anchors, boardAnchors, layoutScene, toSceneModel, LIST_BELOW } from '../../src/scene/index.js'
import { messages } from '../../src/i18n/index.js'
import { translate } from '../../src/core/translate.js'
import { readFileSync } from 'node:fs'
import { panelOpenOf, recallSelection, rememberSelection, rememberedSelection } from '../../src/core/uistate.js'
import { buildRoster, RECENT_WINDOW_MS, WORKER_LIVE_WINDOW_MS } from '../../src/core/roster.js'
import { detectRole } from '../../src/scene/wardrobe.js'
import { kitOf, kitsOf } from '../../src/scene/kits.js'
import { HALO } from '../../src/scene/furniture.js'
import { plainTitle } from '../../src/core/panel.js'

// ===== hud =====
{
const NOW = 1_800_000_000_000
const card = (title, extra = {}) => ({ id: 'c', title, status: 'running', startedMs: NOW - 12 * 60_000, ...extra })

test('codeRef keeps only the leading card code, never the title', () => {
  assert.equal(codeRef('S3.2 Wire the thing'), 'S3.2')
  assert.equal(codeRef('S1.2 — The page'), 'S1.2')
  assert.equal(codeRef('B12a fix'), 'B12a')
  assert.equal(codeRef('write the docs'), '')
  assert.equal(codeRef(null), '')
})

test('formatSpan: minutes under an hour, then hours and padded minutes', () => {
  assert.equal(formatSpan(30_000), '1 min')
  assert.equal(formatSpan(12 * 60_000), '12 min')
  assert.equal(formatSpan(3600_000 + 5 * 60_000), '1 h 05')
  assert.equal(formatSpan(0), '1 min')
})

test('taskTag: working = card code + time on it, as data', () => {
  const tag = taskTag({ state: 'working', running: [card('S3.2 Secret body title')] }, NOW)
  assert.deepEqual(tag, { kind: 'working', ref: 'S3.2', span: '12 min' })
  assert.ok(!JSON.stringify(tag).includes('Secret'), 'the title never leaves')
})

test('taskTag: the main card (the one started FIRST) is named, with « +N » for the others; no card = empty fields (page says "running")', () => {
  const tag = taskTag({ state: 'working', running: [card('A1 old', { startedMs: NOW - 3600_000, heartbeatMs: NOW - 1000 }), card('A2 new', { startedMs: NOW - 60_000 })] }, NOW)
  assert.deepEqual(tag, { kind: 'working', ref: 'A1', span: '60 min'.replace('60 min', '1 h 00'), more: 1, cards: [{ ref: 'A1', span: '1 h 00' }, { ref: 'A2', span: '1 min' }], cardsMore: 0 })
  assert.deepEqual(taskTag({ state: 'working', running: [] }, NOW), { kind: 'working', ref: '', span: '' })
})

test('taskTag: stale = silent for, waiting = the blocked card', () => {
  assert.deepEqual(taskTag({ state: 'stale', silentMs: 12 * 60_000 }, NOW), { kind: 'stale', span: '12 min' })
  assert.deepEqual(taskTag({ state: 'waiting', blocked: [{ title: 'S3.2 x' }, { title: 'S4 y' }] }, NOW), { kind: 'waiting', ref: 'S3.2', n: 2 })
  assert.deepEqual(taskTag({ state: 'waiting', blocked: [{ title: 'no code' }] }, NOW), { kind: 'waiting', ref: '', n: 1 })
  for (const state of ['active', 'idle', 'new', 'unknown']) assert.equal(taskTag({ state }, NOW), null, state)
  assert.equal(taskTag(null, NOW), null)
})

test('taskTag strings exist and translate in en, fr, es', () => {
  for (const lang of ['en', 'fr', 'es']) {
    for (const [k, args] of [['tagRunning', []], ['tagSilent', ['12 min']], ['tagWaitsRef', ['S3.2']], ['tagWaitsN', [1]], ['tagWaitsN', [3]], ['tagWaits', []], ['narrowNote', []], ['selectHint', []], ['sceneLabel', []], ['selected', ['x']]]) {
      const out = translate(messages, lang, k, args)
      assert.ok(out && !out.includes('undefined'), `${lang}.${k}`)
    }
  }
  assert.match(translate(messages, 'fr', 'tagSilent', ['12 min']), /silencieux · 12 min/)
  assert.match(translate(messages, 'fr', 'tagWaitsRef', ['S3.2']), /attend · S3\.2/)
})

test('unclutter: a label overlapping an agent label slides down until free', () => {
  const taken = [{ left: 0, top: 40, right: 100, bottom: 60 }]
  const labels = [{ left: 10, top: 45, right: 90, bottom: 70 }]
  const [dy] = unclutter(labels, taken, { top: 0, bottom: 400 })
  assert.equal(dy, 60 - 45 + 2)
  const moved = { ...labels[0], top: labels[0].top + dy, bottom: labels[0].bottom + dy }
  assert.ok(!rectsIntersect(moved, taken[0]))
})

test('unclutter: a free label stays; with no room below it slides up; boxed in it stays put', () => {
  const free = unclutter([{ left: 0, top: 200, right: 50, bottom: 220 }], [{ left: 0, top: 0, right: 50, bottom: 20 }], { top: 0, bottom: 400 })
  assert.deepEqual(free, [0])
  // an agent label sits right under the stage's bottom edge: going down would leave the stage, so it goes up
  const up = unclutter([{ left: 0, top: 380, right: 50, bottom: 395 }], [{ left: 0, top: 385, right: 50, bottom: 399 }], { top: 0, bottom: 400 })
  assert.ok(up[0] < 0)
  const moved = { left: 0, top: 380 + up[0], right: 50, bottom: 395 + up[0] }
  assert.ok(!rectsIntersect(moved, { left: 0, top: 385, right: 50, bottom: 399 }))
  const boxed = unclutter([{ left: 0, top: 10, right: 50, bottom: 30 }], [{ left: 0, top: 0, right: 50, bottom: 40 }], { top: 0, bottom: 40 })
  assert.deepEqual(boxed, [0])
})

test('unclutter: labels already placed are obstacles for the next ones', () => {
  const a = { left: 0, top: 100, right: 60, bottom: 120 }
  const b = { left: 20, top: 105, right: 80, bottom: 125 }
  const [da, db] = unclutter([a, b], [], { top: 0, bottom: 500 })
  assert.equal(da, 0)
  const ra = { ...a }
  const rb = { left: b.left, right: b.right, top: b.top + db, bottom: b.bottom + db }
  assert.ok(!rectsIntersect(ra, rb))
})

test('unclutter: no agent label is ever covered, over many random placements', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let run = 0; run < 300; run++) {
    const taken = Array.from({ length: 12 }, () => { const l = rnd() * 600; const t = rnd() * 400; return { left: l, top: t, right: l + 40 + rnd() * 60, bottom: t + 14 } })
    const labels = Array.from({ length: 4 }, () => { const l = rnd() * 600; const t = rnd() * 400; return { left: l, top: t, right: l + 80, bottom: t + 18 } })
    const dys = unclutter(labels, taken, { top: 0, bottom: 440 })
    // when a free spot was found (dy !== 0) it really is free; labels that did not move are the "nowhere free" case
    labels.forEach((l, i) => {
      if (dys[i] === 0) return
      const r = { left: l.left, right: l.right, top: l.top + dys[i], bottom: l.bottom + dys[i] }
      assert.ok(!taken.some(o => rectsIntersect(o, r)), `run ${run} label ${i}`)
    })
  }
})

test('chooseView: pending until measured, list under LIST_BELOW, scene above; dense with many agents', () => {
  const art = { W: 735, H: 493, dpr: 1 }
  assert.equal(chooseView({ availW: 0, availH: 0, ...art }).mode, 'pending')
  assert.equal(chooseView({ availW: 364, availH: 700, ...art }).mode, 'list')
  assert.equal(chooseView({ availW: 735 * LIST_BELOW - 1, availH: 900, ...art }).mode, 'list')
  const wide = chooseView({ availW: 1400, availH: 800, ...art })
  assert.equal(wide.mode, 'scene')
  assert.ok(wide.scale >= 1)
  const tall = chooseView({ availW: 1400, availH: 300, ...art })   // height binds too (300 / 493 < 0.75)
  assert.equal(tall.mode, 'list')
  assert.equal(chooseView({ availW: 1400, availH: 800, ...art, people: 15 }).dense, true)
  assert.equal(chooseView({ availW: 1400, availH: 800, ...art, people: 3 }).dense, false)
  // widening brings the scene back
  assert.equal(chooseView({ availW: 380, availH: 800, ...art }).mode, 'list')
  assert.equal(chooseView({ availW: 1000, availH: 800, ...art }).mode, 'scene')
})

const desk = (name, extra = {}) => ({ name, label: name, state: 'idle', lastSession: null, workerSession: null, ...extra })
const live = {
  ok: true,
  boards: [
    { slug: 'alpha', tasks: [{ id: 't1', title: 'S1 a', status: 'running', assignee: 'ann', startedAt: (NOW - 600_000) / 1000 }, { id: 't2', title: 'S2 b', status: 'done', assignee: 'bob' }] },
    { slug: 'beta', tasks: [] }
  ]
}

test('list zones and scene anchors list the same agents (same facts, same clicks), boards then the common room', () => {
  const office = buildOffice([desk('ann'), desk('bob'), desk('cy'), desk('dee')], live, NOW)
  const layout = layoutScene(toSceneModel(office, { nowMs: NOW }))
  const zones = listZones(layout)
  const inList = zones.flatMap(z => z.agents.map(a => a.name)).sort()
  const inScene = anchors(layout).map(a => a.name).sort()
  assert.deepEqual(inList, inScene)
  assert.deepEqual(inList, ['ann', 'bob', 'cy', 'dee'])
  assert.equal(countPeople(layout), 4)
  assert.deepEqual(zones.map(z => z.key), ['b:alpha', 'b:beta', 'hall'])
  assert.equal(boardAnchors(layout).length, 2)
})

test('roster-only office: everyone is in the common room, no island', () => {
  const office = buildOffice([desk('ann'), desk('bob')], null, NOW)
  const layout = layoutScene(toSceneModel(office, { nowMs: NOW }))
  assert.deepEqual(listZones(layout).map(z => z.key), ['hall'])
  assert.equal(boardAnchors(layout).length, 0)
  assert.ok(anchors(layout).every(a => a.pod === null))
})

test('0 agents and 30 agents lay out and list without loss', () => {
  for (const n of [0, 1, 30]) {
    const desks = Array.from({ length: n }, (_, i) => desk(`agent${String(i).padStart(2, '0')}`))
    const office = buildOffice(desks, n ? live : null, NOW)
    const layout = layoutScene(toSceneModel(office, { nowMs: NOW }))
    assert.equal(countPeople(layout), n)
    assert.equal(listZones(layout).flatMap(z => z.agents).length, n)
  }
})

test('ticker: starts only when asked, paints on its period, skips hidden frames, leaves no timer after stop', () => {
  const live = new Set()
  let n = 0
  const timers = {
    setInterval: (fn, ms) => { const id = ++n; live.add(id); timers.fns[id] = fn; timers.ms = ms; return id },
    clearInterval: id => live.delete(id),
    fns: {}
  }
  const frames = []
  let hidden = false
  const ticker = createTicker({ paint: f => frames.push(f), hidden: () => hidden, timers })
  assert.equal(live.size, 0, 'nothing runs before start')
  ticker.start()
  ticker.start()
  assert.equal(live.size, 1, 'start is idempotent')
  assert.equal(timers.ms, FRAME_MS)
  assert.ok(FRAME_MS >= 240 && FRAME_MS <= 280)
  const id = [...live][0]
  timers.fns[id](); timers.fns[id]()
  assert.deepEqual(frames, [1, 2])
  hidden = true
  timers.fns[id](); timers.fns[id]()
  assert.deepEqual(frames, [1, 2], 'no frame painted while the page is hidden')
  assert.equal(ticker.painted, 2)
  ticker.stop()
  assert.equal(live.size, 0, 'no timer left after unmount')
  assert.equal(ticker.running, false)
})

test('ticker frame wraps at 840', () => {
  const t = createTicker({ paint() {}, startFrame: 839, timers: { setInterval: () => 1, clearInterval() {} } })
  t.tick()
  assert.equal(t.frame, 0)
})

test('shouldAnimate: needs motion AND visible AND no reduced-motion request', () => {
  assert.equal(shouldAnimate({ needs: true, visible: true, reducedMotion: false }), true)
  assert.equal(shouldAnimate({ needs: false, visible: true, reducedMotion: false }), false)
  assert.equal(shouldAnimate({ needs: true, visible: false, reducedMotion: false }), false)
  assert.equal(shouldAnimate({ needs: true, visible: true, reducedMotion: true }), false)
})
}

// ===== hud =====
{
// Label folding, local state, dead code, idle repaint, legend.
const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

// Exports with no user left are gone, so they do not look like API.
test('dead exports deskRow, srOnly, zoneHead, DESK_STATES are removed and nothing uses them', () => {
  const styles = src('src/ui/styles.js')
  for (const name of ['deskRow', 'srOnly', 'zoneHead']) assert.doesNotMatch(styles, new RegExp(`export const ${name}\\b`), name)
  assert.doesNotMatch(src('src/core/roster.js'), /DESK_STATES/)
  for (const f of ['src/ui/OfficePage.jsx', 'src/ui/OfficeScene.jsx', 'src/ui/SidePanel.jsx', 'src/ui/GameBar.jsx', 'src/ui/SettingsPage.jsx'])
    assert.doesNotMatch(src(f), /\b(deskRow|srOnly|zoneHead|DESK_STATES)\b/, f)
})

// Two FULL agent labels that overlap -> the less important folds into its dot. Priority: selected > waiting >
// stale (silent) > working > active > the rest; ties by name.
const box = (left, top, w = 60, h = 16) => ({ left, top, right: left + w, bottom: top + h })

test('priority order selected > waiting > stale > working > active > idle', () => {
  const order = ['waiting', 'stale', 'working', 'active', 'idle'].map(state => foldRank({ state }))
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
  assert.equal(new Set(order).size, 5)
  assert.ok(foldRank({ state: 'idle', selected: true }) < foldRank({ state: 'waiting' }), 'selected beats everything')
})

test('of two overlapping full labels the less important folds, whatever the order of the input', () => {
  const a = { id: 'a', rect: box(0, 0), state: 'working', name: 'a' }
  const b = { id: 'b', rect: box(30, 4), state: 'waiting', name: 'b' }
  assert.deepEqual(foldOverlaps([a, b]), ['a'])
  assert.deepEqual(foldOverlaps([b, a]), ['a'])
})

test('the selected label never folds; ties fold the later name (stable)', () => {
  const sel = { id: 1, rect: box(0, 0), state: 'idle', selected: true, name: 'zed' }
  const wait = { id: 2, rect: box(20, 0), state: 'waiting', name: 'amy' }
  assert.deepEqual(foldOverlaps([wait, sel]), [2])
  const x = { id: 3, rect: box(0, 0), state: 'working', name: 'ann' }
  const y = { id: 4, rect: box(10, 0), state: 'working', name: 'bob' }
  assert.deepEqual(foldOverlaps([y, x]), [4])
  assert.deepEqual(foldOverlaps([x, y]), [4])
})

test('no pair of kept labels touches, on a crowd (chains, clusters, nothing to fold apart)', () => {
  const states = ['working', 'idle', 'waiting', 'stale', 'active']
  const items = Array.from({ length: 40 }, (_, i) => ({ id: i, rect: box((i * 23) % 200, ((i * 7) % 5) * 9), state: states[i % 5], name: `n${i}` }))
  const folded = new Set(foldOverlaps(items))
  const kept = items.filter(i => !folded.has(i.id))
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) assert.equal(rectsIntersect(kept[i].rect, kept[j].rect), false, `${kept[i].id}/${kept[j].id}`)
  assert.ok(folded.size > 0 && kept.length > 0, 'something folds, something stays')
  assert.deepEqual(foldOverlaps(kept), [], 'idempotent')
  assert.deepEqual(foldOverlaps([{ id: 1, rect: box(0, 0), state: 'idle', name: 'a' }, { id: 2, rect: box(60, 0), state: 'idle', name: 'b' }]), [], 'touching edges are not an overlap')
})

test('a full label still covering another agent\'s dot folds (the least important first, never the selected)', () => {
  const dot = { id: 'd', rect: box(25, 4, 13, 13), state: 'working', name: 'd' }
  const f1 = { id: 'f1', rect: box(0, 0), state: 'working', name: 'a' }
  const f2 = { id: 'f2', rect: box(100, 0), state: 'working', name: 'b' }
  assert.deepEqual(foldCovering([f1, f2], [dot]), ['f1'])
  assert.deepEqual(foldCovering([{ ...f1, selected: true }], [dot]), [])
  assert.deepEqual(foldCovering([f2], [dot]), [])
  assert.deepEqual(foldCovering([f1, { ...f1, id: 'f3', state: 'idle', name: 'c' }], [dot]), ['f3'])
})

// The only working agent must not fold because its label covers the
// dot of an idle neighbour that foldOverlaps has just folded for it: the less important yields.
test('a label never folds for the dot of a less important agent (working over idle stays full)', () => {
  const idleDot = { id: 'i', rect: box(25, 4, 13, 13), state: 'idle', name: 'default' }
  const working = { id: 'w', rect: box(0, 0), state: 'working', name: 'reviewer' }
  assert.deepEqual(foldCovering([working], [idleDot]), [], 'working label kept over an idle dot')
  assert.deepEqual(foldCovering([{ ...working, state: 'idle' }], [idleDot]), ['w'], 'same priority: the covering label folds')
  assert.deepEqual(foldCovering([working], [{ ...idleDot, state: 'waiting' }]), ['w'], 'a waiting dot is more important: the working label folds')
  // the round trip of the page: two overlapping full labels -> the idle one folds, and the working one then stays full
  const idleFull = { id: 'i', rect: box(20, 2), state: 'idle', name: 'default' }
  assert.deepEqual(foldOverlaps([working, idleFull]), ['i'])
  assert.deepEqual(foldCovering([working], [idleDot]), [])
})

// the page wires it: folded station = dot only (colour kept), reopened by hover / focus / selection, label text untouched
test('OfficeScene folds through the placement of src/scene/labels.js and the stylesheet opens a folded label on hover, focus and selection', () => {
  const scene = readFileSync(new URL('../../src/ui/OfficeScene.jsx', import.meta.url), 'utf8')
  assert.match(scene, /placeLabels\(/)
  assert.match(scene, /r\.folded/)
  assert.match(scene, /setAttribute\('data-fold', ''\)/)
  const css = readFileSync(new URL('../../src/ui/sceneStyles.js', import.meta.url), 'utf8')
  assert.match(css, /\.oc-station\[data-fold\]:not\(:hover\):not\(:focus-visible\):not\(\[aria-pressed="true"\]\) \.oc-chip > :not\(\.oc-dot\)\{display:none!important\}/)
  assert.match(css, /\.oc-station\[data-fold\]:hover,\.oc-station\[data-fold\]:focus-visible\{z-index:8\}/)
  assert.doesNotMatch(scene, /aria-label=\{[^}]*fold/i, 'the accessible name is never shortened')
})

// Leaving #/officecraft unmounts the page; the selection and the side panel are kept outside it (a useState would come back reset).
test('the selection survives in module memory, and is forgotten once its agent no longer exists', () => {
  rememberSelection(null)
  assert.equal(rememberedSelection(), null, 'nothing remembered at first')
  assert.equal(recallSelection(['ann', 'bob']), null)
  rememberSelection('bob')
  assert.equal(rememberedSelection(), 'bob', 'what a remounted page reads')
  assert.equal(recallSelection(['ann', 'bob']), 'bob')
  assert.equal(recallSelection(['ann']), null, 'bob left the roster')
  assert.equal(rememberedSelection(), null, '… and is no longer remembered if he comes back')
  rememberSelection('ann'); rememberSelection(''); assert.equal(rememberedSelection(), null, 'an empty name clears')
  rememberSelection(42); assert.equal(rememberedSelection(), null, 'only a name is kept')
})

test('the panel preference is explicit true / false, open unless stored false', () => {
  assert.equal(panelOpenOf(false), false)
  assert.equal(panelOpenOf(true), true)
  for (const junk of [undefined, null, 'false', 0, '']) assert.equal(panelOpenOf(junk), true, String(junk))
})

test('the page reads the memory at mount and writes it on select; the wide panel is the $panelOpen pref, written explicitly', () => {
  const page = src('src/ui/OfficePage.jsx')
  assert.match(page, /useState\(\(\) => rememberedSelection\(\)\)/)
  assert.match(page, /rememberSelection\(name\)/)
  assert.match(page, /onSelect=\{selectAgent\}/)
  assert.match(page, /const selectAgent = name => \{\n    setSelected\(name\)/)
  assert.match(page, /const wideOpen = useValue\(\$panelOpen\)/)
  assert.doesNotMatch(page, /setWideOpen/, 'no local useState for the wide panel any more')
  assert.match(page, /recallSelection\(desks\.map/, 'a vanished agent is forgotten')
  const prefs = src('src/data/prefs.js')
  assert.match(prefs, /export const \$panelOpen = atom\(true\)/)
  assert.match(prefs, /\$panelOpen\.set\(panelOpenOf\(storage\?\.get\?\.\('panel', true\)\)\)/, 'read at start-up')
  assert.match(prefs, /export function setPanelOpen\(open\)[\s\S]*storage\?\.set\?\.\('panel', next\)/, 'written as an explicit value')
  assert.doesNotMatch(prefs, /storage\??\.(remove|delete)/, 'never removed')
})

// A /live read identical to the previous one must not repaint the canvas, although
// every read builds a new office object: the scene model is kept while the facts it draws are identical.
const T0 = Date.UTC(2026, 10, 9, 10, 0, 0)
const idleRoster = () => buildRoster({
  profiles: Array.from({ length: 13 }, (_, i) => ({ name: `bot${i}`, description: 'Research and design', last_session: { id: `s${i}`, last_active: (T0 - 3 * 86_400_000) / 1000 } }))
}, T0)
const liveBody = extra => ({ ok: true, generatedAt: T0 / 1000, boards: [{ slug: 'shop', tasks: [{ id: 't1', title: 'T1', status: 'done', assignee: 'bot0', createdAt: T0 / 1000 - 99999 }, ...extra] }] })
const modelAt = (live, nowMs, desks = idleRoster()) => toSceneModel(buildOffice(desks, live, nowMs), { nowMs, night: false })

test('an identical /live read (and the seconds that passed) gives the same scene facts; a real variation gives another', () => {
  const a = sceneFacts(modelAt(liveBody([]), T0))
  assert.equal(sceneFacts(modelAt(liveBody([]), T0 + 5_000)), a, 'same read 5 s later: nothing to repaint')
  assert.equal(sceneFacts(modelAt(liveBody([]), T0 + 10_000)), a)
  assert.notEqual(sceneFacts(modelAt(liveBody([]), T0 + 61_000)), a, 'the wall clock moved a minute: one repaint')
  const blocked = [{ id: 't2', title: 'T2', status: 'blocked', assignee: 'bot3', createdAt: T0 / 1000 - 10 }]
  assert.notEqual(sceneFacts(modelAt(liveBody(blocked), T0 + 5_000)), a, 'a card became blocked: a bot waits for you')
  const running = [{ id: 't3', title: 'T3', status: 'running', assignee: 'bot4', startedAt: T0 / 1000 - 30, heartbeatAt: T0 / 1000 - 5, createdAt: T0 / 1000 - 40 }]
  assert.notEqual(sceneFacts(modelAt(liveBody(running), T0 + 5_000)), a, 'a card started running')
  assert.notEqual(sceneFacts({ ...modelAt(liveBody([]), T0), night: true }), a, 'night falls')
  assert.equal(sceneFacts({ ...modelAt(liveBody([]), T0), selected: 'bot1' }), a, 'the selection is painted separately, not a model fact')
})

test('detectRole and kitOf are memoised by (name, description, skills) and give the same answers', () => {
  const agent = { name: 'designer', description: 'Interface design', skills: [{ name: 'figma-export', category: 'design', tags: ['ui'] }] }
  const first = detectRole(agent)
  assert.equal(detectRole({ ...agent, skills: [{ name: 'figma-export', category: 'design', tags: ['ui'] }] }), first, 'same inputs: the cached answer')
  assert.notEqual(detectRole({ ...agent, description: 'Backend APIs, databases and deployment' }), first, 'another description is scored again')
  assert.notEqual(detectRole({ ...agent, name: 'zzz', description: '', skills: [] }), first)
  const sk = { name: 'github', category: 'software-development', tags: [] }
  assert.equal(kitOf(sk), kitOf({ ...sk }))
  assert.deepEqual(kitsOf({ name: 'x', skills: [sk] }), kitsOf({ name: 'y', skills: [sk] }))
})

test('the scene keeps its model while the fingerprint is unchanged (no layout, no repaint)', () => {
  const scene = src('src/ui/OfficeScene.jsx')
  assert.match(scene, /const factsKey = useMemo\(\(\) => sceneFacts\(fresh\), \[fresh\]\)/)
  assert.match(scene, /if \(kept\.current\.key !== factsKey\) kept\.current = \{ key: factsKey, model: fresh \}/)
  assert.match(scene, /const layout = useMemo\(\(\) => layoutScene\(model\), \[model\]\)/)
  assert.match(src('src/scene/wardrobe.js'), /ROLE_MEMO/)
  assert.match(src('src/scene/kits.js'), /KIT_MEMO/)
})

// The legend of the halos. Colours are the scene's own (HALO), words translated.
test('the legend lists the six states with the colours the scene draws, and the windows of the real rules', () => {
  const rows = legendRows(HALO, { workingMs: WORKER_LIVE_WINDOW_MS, staleMs: STALE_AFTER_MS, activeMs: RECENT_WINDOW_MS })
  assert.deepEqual(rows.map(r => r.state), ['working', 'waiting', 'stale', 'active', 'queued', 'idle'])
  for (const r of rows.filter(r => r.state !== 'idle')) assert.deepEqual(r.rgb, HALO[r.state], `${r.state} uses the scene's own halo colour`)
  assert.equal(rows.find(r => r.state === 'idle').rgb, null, 'a resting agent has no halo')
  assert.deepEqual(rows.map(r => r.arg), [2, null, 5, 10, null, null])
  assert.equal(new Set(rows.filter(r => r.rgb).map(r => r.rgb.join())).size, 5, 'five distinct colours')
})

test('legend words exist in en, fr and es, with the minutes interpolated', () => {
  for (const lang of ['en', 'fr', 'es']) {
    for (const k of ['button', 'title', 'waiting', 'rest', 'queued']) assert.ok(translate(messages, lang, `legend.${k}`, []).length > 3, `${lang} legend.${k}`)
    for (const k of ['working', 'stale', 'active']) assert.match(translate(messages, lang, `legend.${k}`, [7]), /7/, `${lang} legend.${k}`)
    for (const s of ['working', 'waiting', 'stale', 'active', 'queued', 'idle']) assert.ok(translate(messages, lang, `state.${s}`, []).length > 2)
  }
  const page = src('src/ui/OfficePage.jsx')
  assert.match(src('src/ui/ProjectDock.jsx'), /<Legend \/>/)   // the dock under the scene holds it
  const legend = src('src/ui/Legend.jsx')
  assert.match(legend, /legendRows\(HALO,/)
  assert.doesNotMatch(legend, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no colour literal: swatches are painted from the scene RGB')
})
}

// ===== hud =====
{
// Pure HUD rules (the state word is not repeated next to a tag that already says it).
const NOW = 1_800_000_000_000

test('the state word is dropped only when the tag already says it (waits / silent)', () => {
  assert.equal(tagSaysState(taskTag({ state: 'waiting', blocked: [{ title: 'S3.2 x' }] }, NOW)), true)
  assert.equal(tagSaysState(taskTag({ state: 'stale', silentMs: 600_000 }, NOW)), true)
  assert.equal(tagSaysState(taskTag({ state: 'working', running: [{ title: 'S1 y', startedMs: NOW - 60_000 }] }, NOW)), false)
  assert.equal(tagSaysState(taskTag({ state: 'idle' }, NOW)), false)
  assert.equal(tagSaysState(null), false)
})

test('cardProgress: a clock on the running card, full after 30 minutes and late past it; nothing without a running card', async () => {
  const { cardProgress, PROGRESS_FULL_MS } = await import('../../src/core/hud.js')
  const w = ms => ({ state: 'working', running: [{ title: 'x', startedMs: NOW - ms }] })
  assert.deepEqual(cardProgress(w(PROGRESS_FULL_MS / 2), NOW), { f: 0.5, late: false })
  assert.deepEqual(cardProgress(w(PROGRESS_FULL_MS * 3), NOW), { f: 1, late: true })
  // several cards: the MAIN one, the one started first (the one the tag names)
  assert.equal(cardProgress({ state: 'working', running: [{ startedMs: NOW - PROGRESS_FULL_MS * 2 }, { startedMs: NOW - PROGRESS_FULL_MS / 4 }] }, NOW).f, 1)
  for (const a of [null, { state: 'idle' }, { state: 'working' }, { state: 'working', running: [{ title: 'x' }] }, { state: 'waiting', running: [{ startedMs: NOW - 5 }] }, w(-5000)]) assert.equal(cardProgress(a, NOW), null)
})
}

// ===== hud =====
{
// codeRef reads a code whole: it may end in letters after the point, or hold dashes.
test('codes with letters after the point or dashes are read whole', () => {
  assert.equal(codeRef('S2.F — Closing review'), 'S2.F')
  assert.equal(codeRef('R-API-A — Fixes of batch A'), 'R-API-A')
  assert.equal(codeRef('S5.1 Wire'), 'S5.1')
  assert.equal(codeRef('API-A1 — Decisions'), 'API-A1')
  assert.equal(codeRef('S1.3b — x'), 'S1.3b')
  assert.equal(plainTitle('S2.F — Review', codeRef('S2.F — Review')), 'Review')
})
test('ordinary words in capitals or with a dash are not codes', () => {
  for (const title of ['API gateway failing', 'Re-run the tests', 'E-mail digest', 'OK', 'TODO list', 'write the docs', '', null, 'Fix S2.F']) {
    assert.equal(codeRef(title), '', String(title))
  }
})
}
