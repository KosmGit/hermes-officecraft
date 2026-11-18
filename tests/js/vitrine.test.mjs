import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ALL_ACHIEVEMENT_IDS, GRADES, computeGame } from '../../src/core/game.js'
import { ALMOST_N, RECENT_MS, ratio, vitrineView } from '../../src/core/vitrine.js'
import { MEDAL_SIZE, medalArt, pipsOf, familyColor, medalColors } from '../../src/scene/index.js'
import { en } from '../../src/i18n/en.js'
import { buildOffice } from '../../src/core/office.js'
import { hx } from '../../src/scene/color.js'

// ===== vitrine =====
{
/* The showcase (vitrine) — the view model, the medal art, and the places the trophies left (strip, Journal collection, header postcard). */
const MIN = 60_000
const D = 86_400_000
const NOW = new Date(2026, 10, 13, 15).getTime()
const run = (outcome, endedMs) => ({ profile: 'ana', outcome, startedMs: endedMs - MIN, endedMs })
const card = (id, completedMs) => ({ id, title: `t${id}`, status: 'done', assignee: 'ana', createdAt: (NOW - 30 * D) / 1000, completedAt: completedMs / 1000 })
const desks = ['ana', 'bob'].map(name => ({ name, label: name, state: 'idle', lastSession: null, workerSession: null }))
const history = (nDone, runs = []) => ({ ok: true, profiles: {}, boards: [{ slug: 'b', createdAt: (NOW - 60 * D) / 1000, tasks: Array.from({ length: nDone }, (_, i) => card(`d${i}`, NOW - (i + 1) * D)), runs, events: [] }] })
const game = (nDone, runs) => { const h = history(nDone, runs); return computeGame(h, buildOffice(desks, { ok: true, boards: h.boards.map(b => ({ slug: b.slug, createdAt: b.createdAt, tasks: b.tasks })) }, NOW), NOW, {}) }
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('vitrineView: level bar fill = the text done/next (30/50 is 60 %, not the 50 % of the stretch from the floor 10), the next level is named, the top level has no next', () => {
  const g = game(30)
  const v = vitrineView(g, NOW)
  assert.deepEqual([v.level.name, v.level.nextName, v.level.floor, v.level.next, v.level.done, v.level.pct], ['open_space', 'floor', 10, 50, 30, 60])
  const big = vitrineView({ ...g, office: { ...g.office, done: 76, next: 800 } }, NOW)
  assert.equal(big.level.pct, 9.5, '76/800 is 9.5 %')
  const top = vitrineView({ ...g, office: { ...g.office, level: 5, name: 'skyscraper', done: 1200, next: null } }, NOW)
  assert.deepEqual([top.level.nextName, top.level.pct], [null, 100])
})

test('vitrineView: every achievement sits on exactly one shelf, in shelf order; counts agree with the game', () => {
  const g = game(12)
  const v = vitrineView(g, NOW)
  assert.equal(v.total, ALL_ACHIEVEMENT_IDS.length >= 28 ? g.achievements.length : 0)
  assert.deepEqual([...v.order].sort(), g.achievements.map(a => a.id).sort())
  assert.equal(new Set(v.order).size, v.order.length)
  assert.equal(v.got, g.achievements.filter(a => a.unlocked).length)
  assert.equal(v.shelves.reduce((n, f) => n + f.unlocked, 0), v.got)
  assert.equal(v.hidden, g.achievements.filter(a => a.hidden && !a.unlocked).length)
  assert.ok(v.order.includes(v.first))
})

test('« Almost there »: at most 3, locked, never a hidden one, none at zero progress, closest first', () => {
  const g = game(8)
  const v = vitrineView(g, NOW)
  assert.ok(v.almost.length <= ALMOST_N)
  for (const a of v.almost) { assert.equal(a.unlocked, false); assert.equal(a.hidden, false); assert.ok(ratio(a) > 0 && ratio(a) <= 1) }
  assert.deepEqual(v.almost.map(ratio), [...v.almost.map(ratio)].sort((x, y) => y - x))
  // a hidden locked achievement, even with progress, never shows there
  const rigged = { ...g, achievements: g.achievements.map(a => (a.hidden ? { ...a, unlocked: false, progress: [9, 10] } : a)) }
  assert.equal(vitrineView(rigged, NOW).almost.some(a => a.hidden), false)
  assert.equal(ratio({ progress: [3, 0] }), 0)
  assert.equal(ratio({ progress: [5, 4] }), 1)
})

test('« new » = unlocked and dated within the last 2 days (a date, not a guess); an undated one is never new', () => {
  const g = game(12)
  const dated = g.achievements.find(a => a.unlocked && a.dated)
  assert.ok(dated, 'fixture unlocks a dated achievement')
  const at = dated.unlockedMs
  assert.equal(vitrineView(g, at + RECENT_MS - 1).recent.has(dated.id), true)
  assert.equal(vitrineView(g, at + RECENT_MS).recent.has(dated.id), false)
  assert.equal(vitrineView(g, at - 1).recent.has(dated.id), false, 'a date in the future is not new')
  const undated = { ...g, achievements: g.achievements.map(a => (a.id === dated.id ? { ...a, dated: false, unlockedMs: null } : a)) }
  assert.equal(vitrineView(undated, at).recent.has(dated.id), false)
})

test('grades: counted per grade from the successful runs, highest first, empty grades left out', () => {
  const runs = [...Array.from({ length: 21 }, (_, i) => run('completed', NOW - (i + 1) * MIN * 10)), ...Array.from({ length: 6 }, (_, i) => ({ ...run('completed', NOW - (i + 1) * MIN * 7), profile: 'bob' }))]
  const g = game(12, runs)
  const v = vitrineView(g, NOW)
  assert.deepEqual(v.grades, [{ id: 'senior', n: 1 }, { id: 'confirme', n: 1 }])
  assert.deepEqual(vitrineView(game(0), NOW).grades, [{ id: 'stagiaire', n: 2 }])
  assert.deepEqual(GRADES.map(x => x.id), ['stagiaire', 'confirme', 'senior', 'legende'])
})

test('no achievement unlocked and nothing in progress: the window still has a selection and an empty « almost »', () => {
  const v = vitrineView(game(0), NOW)
  assert.deepEqual(v.almost.length <= ALMOST_N, true)
  assert.ok(v.first)
  assert.equal(v.got, 0)
})

test('medalArt: 28 x 28 RGBA, transparent corners, opaque centre; deterministic', () => {
  const m = { id: 'zero', family: 'reliability', tier: 'gold', unlocked: true, hidden: false }
  const a = medalArt(m)
  assert.deepEqual([a.W, a.H, a.d.length], [MEDAL_SIZE, MEDAL_SIZE, MEDAL_SIZE * MEDAL_SIZE * 4])
  assert.equal(a.d[3], 0, 'top-left corner is transparent')
  assert.equal(a.d[((MEDAL_SIZE - 1) * MEDAL_SIZE + MEDAL_SIZE - 1) * 4 + 3], 0, 'bottom-right corner is transparent')
  assert.equal(a.d[(16 * MEDAL_SIZE + 14) * 4 + 3], 255)
  assert.deepEqual(Buffer.from(medalArt(m).d), Buffer.from(a.d))
})

test('medalArt: the tier shows by metal AND by pips; a locked medal is grey; a single-level one takes its family colour with no pip', () => {
  const base = { id: 'zero', family: 'reliability', unlocked: true, hidden: false }
  const px = (m, x, y) => Array.from(medalArt(m).d.slice((y * MEDAL_SIZE + x) * 4, (y * MEDAL_SIZE + x) * 4 + 3))
  const [b, s, g] = ['bronze', 'silver', 'gold'].map(tier => medalArt({ ...base, tier }).d)
  assert.notDeepEqual(Buffer.from(b), Buffer.from(s))
  assert.notDeepEqual(Buffer.from(s), Buffer.from(g))
  assert.deepEqual(['bronze', 'silver', 'gold'].map(tier => pipsOf({ unlocked: true, tier })), [1, 2, 3])
  assert.equal(pipsOf({ unlocked: true, tier: null }), 0)
  assert.equal(pipsOf({ unlocked: false, tier: 'gold' }), 0, 'a locked medal carries no tier')
  const rimAt = [14, 6]   // top of the rim
  const lockedRim = px({ ...base, tier: null, unlocked: false }, ...rimAt)
  assert.ok(Math.max(...lockedRim) - Math.min(...lockedRim) < 24, `locked rim is grey: ${lockedRim}`)
  assert.notDeepEqual(px({ ...base, tier: null }, ...rimAt), lockedRim)
})

test('medalArt: a hidden locked achievement gives nothing away — same pixels whatever its id, family or progress', () => {
  const a = medalArt({ id: 'iron', family: 'reliability', tier: null, unlocked: false, hidden: true })
  const b = medalArt({ id: 'rescue', family: 'reliability', tier: null, unlocked: false, hidden: true })
  assert.deepEqual(Buffer.from(a.d), Buffer.from(b.d))
  const open = medalArt({ id: 'iron', family: 'reliability', tier: null, unlocked: true, hidden: true })
  assert.notDeepEqual(Buffer.from(open.d), Buffer.from(a.d), 'unlocked, it shows itself')
})

test('medalArt: every achievement of the catalogue draws in every state without throwing', () => {
  for (const id of ALL_ACHIEVEMENT_IDS) for (const unlocked of [true, false]) for (const tier of [null, 'bronze', 'silver', 'gold']) {
    const m = medalArt({ id, family: 'boards', tier, unlocked, hidden: false })
    assert.equal(m.d.some(v => v), true)
  }
  assert.doesNotThrow(() => medalArt({ id: 'nope', family: 'zzz', tier: 'bogus', unlocked: true, hidden: false }))
})

test('the trophies left the page: no strip, no Journal collection, no postcard button in the header; the badge opens the showcase', () => {
  const journal = read('src/ui/JournalTab.jsx')
  assert.doesNotMatch(journal, /Collection/)
  const header = read('src/ui/PageHeader.jsx')
  assert.doesNotMatch(header, /data-postcard|postcard.onClick|name="camera"/)
  assert.match(header, /aria-haspopup="dialog"/)
  const page = read('src/ui/OfficePage.jsx')
  assert.match(page, /onBadge=\{openVitrine\}/)
  assert.match(page, /showBadge && vitrineOpen \? <Vitrine/, 'never rendered in sober mode or in the replay')
  assert.match(page, /onPostcard=\{postcard\}/, 'the postcard moved into the showcase, it is not gone')
  const col = read('src/ui/Collection.jsx')
  assert.doesNotMatch(col, /oc-strip|oc-ttslot|onMouseEnter/)
})

test('the showcase: medals are ONE tab stop with arrows, Enter selects (aria-pressed), the detail is a live region, Escape closes', () => {
  const col = read('src/ui/Collection.jsx')
  assert.match(col, /tabIndex=\{tab \? 0 : -1\}/)
  assert.match(col, /aria-pressed=\{selected\}/)
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.ok(col.includes(`'${key}'`), key)
  assert.match(col, /aria-live="polite"/)
  assert.match(col, /escapeCloses\(e\)/)
  assert.match(col, /@media \(prefers-reduced-motion:reduce\)/, 'the shine and the bar fill stop under reduced motion')
})

test('every game element of the showcase carries data-game (sober mode counts none) and the UI holds no literal colour', () => {
  const bar = read('src/ui/GameBar.jsx')
  assert.match(bar, /<section className="oc-vh" data-game data-gamebar/)
  assert.match(bar, /data-game data-postcard/)
  assert.match(read('src/ui/Collection.jsx'), /<div data-game data-vitrine /)
  for (const f of ['src/ui/Collection.jsx', 'src/ui/GameBar.jsx', 'src/ui/PixelIcon.jsx']) assert.doesNotMatch(read(f), /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/, f)
})

test('every string the showcase shows is translated (en keys exist)', () => {
  for (const k of ['heroLabel', 'stats', 'toLevel', 'cards', 'trophies', 'hidden', 'streakDays', 'moods', 'gradesTip', 'almost', 'new', 'detail', 'tiers', 'wholeHistory', 'tierAt']) assert.ok(k in en.vit, k)
})

test('the view holds from 0 to 30 agents and 0 to 8 boards (grades add up to the agents, shelves never change)', () => {
  const names = n => Array.from({ length: n }, (_, i) => ({ name: `bot${i}`, label: `bot${i}`, state: 'idle', lastSession: null, workerSession: null }))
  for (const [agents, boards] of [[0, 0], [1, 1], [13, 3], [30, 8]]) {
    const live = { ok: true, boards: Array.from({ length: boards }, (_, i) => ({ slug: `b${i}`, createdAt: (NOW - 60 * D) / 1000, tasks: [card(`c${i}`, NOW - D)] })) }
    const g = computeGame(history(boards * 4), buildOffice(names(agents), live, NOW), NOW, {})
    const v = vitrineView(g, NOW)
    assert.equal(v.grades.reduce((n, x) => n + x.n, 0), agents, `${agents} agents`)
    assert.equal(v.order.length, g.achievements.length)
    assert.ok(v.first, 'something is selected')
    assert.ok(v.shelves.every(f => f.items.length > 0), 'no empty shelf')
  }
})

test('a sober game shows no showcase at all: the page gates it on the badge, which needs the game', () => {
  const page = read('src/ui/OfficePage.jsx')
  assert.match(page, /const showBadge = model\.showGameBar && !replayOn/)
  assert.match(page, /game=\{showBadge \? game : null\}/)
})

test('« Almost there » leaves out an achievement with no progress at all (mutation: a >= 0 let every locked one in)', () => {
  const g = game(0)
  const zeroed = { ...g, achievements: g.achievements.map((a, i) => ({ ...a, unlocked: false, hidden: false, unavailable: false, progress: [i === 3 ? 1 : 0, 10] })) }
  assert.deepEqual(vitrineView(zeroed, NOW).almost.map(a => a.id), [zeroed.achievements[3].id])
})
}

// ===== vitrine =====
{
/* The showcase's family colour key, the medal names' room, and rules no other test guards. */
const FAMILIES = ['chains', 'boards', 'reliability', 'decider', 'team', 'command']
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
// the showcase's stylesheet as written (a .jsx file does not load under node; the `${…}` theme variables stay unexpanded)
const VITRINE_CSS = (src => src.slice(src.indexOf('export const VITRINE_CSS = `') + 28, src.lastIndexOf('`')))(read('src/ui/Collection.jsx'))

test('the shelf key and the detail chip use the colour of the medal ribbon, one distinct colour per family (ribbon = family)', () => {
  // before: the key came from theme variables — chains and boards both fell back to the accent (the host has no --ui-violet), and
  // no key matched its ribbon (chains: accent blue key, teal ribbons; team: blue-green key, violet ribbons)
  const keys = FAMILIES.map(familyColor)
  assert.equal(new Set(keys).size, FAMILIES.length, `distinct: ${keys}`)
  for (const f of FAMILIES) assert.deepEqual(medalColors({ family: f, tier: null, unlocked: true }).ribbon, hx(familyColor(f)), f)
  const col = read('src/ui/Collection.jsx')
  assert.equal((col.match(/'--fc': familyColor\(/g) || []).length, 2, 'the shelf heading and the detail chip both carry the ribbon colour')
  assert.doesNotMatch(VITRINE_CSS, /\[data-family="\w+"\]\{--fc:/, 'no theme-variable key that disagrees with the ribbon')
})

/** Width left to a medal's name by the stylesheet (wide, and under 560 px), and whether 4 medals still fit a shelf at 380 px. */
function nameRoom(css) {
  const rule = (sel, src) => (src.match(new RegExp(`${sel.replace(/[.[\]]/g, '\\$&')}\\{([^}]*)\\}`)) || [])[1] || ''
  const px = (decl, prop) => { const m = decl.match(new RegExp(`(?:^|;)${prop}:([\\d.]+)px`)); return m ? Number(m[1]) : null }
  const padX = decl => { const m = decl.match(/(?:^|;)padding:([\d.]+)px ([\d.]+)px/); return m ? Number(m[2]) : 0 }
  const wide = rule('.oc-md', css)
  const narrowBlock = css.slice(css.indexOf('@media (max-width:560px)'))
  const narrow = rule('.oc-md', narrowBlock)
  const w = px(narrow, 'width') ?? px(wide, 'width')
  const name = px(rule('.oc-md-n', css), 'max-width')
  const gapN = (rule('.oc-shelf', narrowBlock).match(/gap:([\d.]+)px/) || rule('.oc-shelf', css).match(/gap:[\d.]+px ([\d.]+)px/) || [])[1]
  return { wide: Math.min(px(wide, 'width') - 2 * padX(wide), name), narrow: Math.min(w - 2 * padX(wide), name), w, gap: Number(gapN) }
}

test('a medal name has 76 px (wide and under 560 px): measured in the webapp, 72 px split « incorporación », 64 px cut « La herramienta adecuada »', () => {
  const r = nameRoom(VITRINE_CSS)
  assert.ok(r.wide >= 76, `wide name room ${r.wide}`)
  assert.ok(r.narrow >= 76, `narrow name room ${r.narrow}`)
  // 380 px: body padding 12 + shelf padding 8 on each side leave 332 px; 4 medals per row still fit
  assert.ok(4 * r.w + 3 * r.gap <= 380 - 2 * 12 - 2 * 8, `4 x ${r.w} + 3 x ${r.gap}`)
})

const NOW = new Date(2026, 10, 13, 15).getTime()
const D = 86_400_000
const card = (id, completedMs) => ({ id, title: `t${id}`, status: 'done', assignee: 'ana', createdAt: (NOW - 30 * D) / 1000, completedAt: completedMs / 1000 })
const game = n => {
  const boards = [{ slug: 'b', createdAt: (NOW - 60 * D) / 1000, tasks: Array.from({ length: n }, (_, i) => card(`d${i}`, NOW - (i + 1) * D)), runs: [], events: [] }]
  const desks = ['ana', 'bob'].map(name => ({ name, label: name, state: 'idle', lastSession: null, workerSession: null }))
  return computeGame({ ok: true, profiles: {}, boards }, buildOffice(desks, { ok: true, boards: boards.map(b => ({ slug: b.slug, createdAt: b.createdAt, tasks: b.tasks })) }, NOW), NOW, {})
}

test('« Almost there » shows 3 achievements at most (the 3 closest), and 3 when 3 or more have progress', () => {
  const g = game(0)
  const rigged = { ...g, achievements: g.achievements.map((a, i) => ({ ...a, unlocked: false, hidden: false, unavailable: false, progress: [i % 5 + 1, 10] })) }
  assert.equal(vitrineView(rigged, NOW).almost.length, 3)
})

test('the window opens on the most recently unlocked medal', () => {
  const g = game(0)
  // three unlocked on three dates, the most recent neither first nor last in the catalogue
  const ids = [g.achievements[2].id, g.achievements[9].id, g.achievements[20].id]
  const ms = new Map([[ids[0], NOW - 5 * D], [ids[1], NOW - 1 * D], [ids[2], NOW - 9 * D]])
  const rigged = { ...g, achievements: g.achievements.map(a => (ms.has(a.id) ? { ...a, unlocked: true, dated: true, unlockedMs: ms.get(a.id) } : { ...a, unlocked: false, unlockedMs: null, dated: false })) }
  assert.equal(vitrineView(rigged, NOW).first, ids[1])
})

test('a hidden achievement, once unlocked, shows its own icon (not the « ? »); locked, it shows the « ? » whatever it is', () => {
  const art = m => Buffer.from(medalArt(m).d)
  const base = { id: 'iron', family: 'reliability', tier: null }
  // same colours either way (unlocked, not hidden vs hidden): only the glyph can differ, and it must not be the « ? »
  assert.deepEqual(art({ ...base, unlocked: true, hidden: true }), art({ ...base, unlocked: true, hidden: false }))
  assert.notDeepEqual(art({ ...base, unlocked: true, hidden: true }), art({ ...base, id: 'hidden', unlocked: true, hidden: false }))
})
}
