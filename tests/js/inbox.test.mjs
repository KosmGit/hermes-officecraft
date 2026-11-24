import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { alertsOf, foldAlerts } from '../../src/core/alerts.js'
import { OLD_AFTER_MS, SORTS, byAge, decisionRows, groupRows, isOld, isSort, onlyProject, shortAge } from '../../src/core/decisions.js'
import { BAR, NARROW_AT, TABS, barOf, isNarrow, isTab, tabForKey } from '../../src/core/tabs.js'
import { messages } from '../../src/i18n/index.js'
import { PROJECT_HUES, hueOfSlug, layoutScene, projectColor, projectRanks, toSceneModel } from '../../src/scene/index.js'
import { PAGE_CSS } from '../../src/ui/pageStyles.js'
import { INBOX_MAX, inboxView } from '../../src/core/panel.js'
import { en } from '../../src/i18n/en.js'
import { es } from '../../src/i18n/es.js'
import { fr } from '../../src/i18n/fr.js'

// ===== inbox =====
{
// The pure modules of the page — project colours, decision rows, alert chips, tabs — and the contracts of the page's sources.
const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

/* ---------- project colours ---------- */
const board = (slug, createdMs) => ({ slug, createdMs, tasks: [], counts: {}, total: 0, blocked: [], open: [] })

test('a project colour is its CREATION rank, not the order it is listed in, and is stable between polls', () => {
  const a = [board('zeta', 1000), board('alpha', 3000), board('mid', 2000)]
  const b = [board('mid', 2000), board('alpha', 3000), board('zeta', 1000)]
  for (const boards of [a, b]) {
    const r = projectRanks(boards)
    assert.deepEqual([r.get('zeta'), r.get('mid'), r.get('alpha')], [0, 1, 2])
    assert.equal(hueOfSlug('zeta', r), PROJECT_HUES[0])
    assert.equal(hueOfSlug('alpha', r), PROJECT_HUES[2])
  }
  // the same creation time: the name decides (not the listing)
  const tie = projectRanks([board('b', 5), board('a', 5)])
  assert.deepEqual([tie.get('a'), tie.get('b')], [0, 1])
})

test('eight fixed hues, all different; the ninth board starts over (the name stays the real identity)', () => {
  assert.equal(PROJECT_HUES.length, 8)
  assert.equal(new Set(PROJECT_HUES).size, 8)
  const boards = Array.from({ length: 10 }, (_, i) => board(`p${i}`, i))
  const r = projectRanks(boards)
  assert.equal(hueOfSlug('p8', r), PROJECT_HUES[0])
  assert.equal(hueOfSlug('p9', r), PROJECT_HUES[1])
})

test('the island of the scene and the chip of the page have the same hue', () => {
  const boards = [board('first', 10), board('second', 20), board('third', 30)]
  const model = toSceneModel({ agents: [{ name: 'a', state: 'idle', home: 'second' }], boards, ops: null }, { nowMs: 1e12 })
  const layout = layoutScene(model)
  const r = projectRanks(boards)
  for (const p of layout.pods) assert.equal(p.hue, hueOfSlug(p.b.slug, r), `${p.b.slug}: rug = chip`)
})

/* ---------- decisions ---------- */
const view = {
  approvals: [{ key: 'ap1', profile: 'ann', firstSeenMs: 500 }],
  cards: [
    { board: 'p', id: 't1', blockedMs: 100 },
    { board: 'p', id: 't2', blockedMs: 300 },
    { board: 'q', id: 't3', createdMs: 200 },
    { board: 'r', id: 't4' }
  ]
}
const office = { agents: [{ name: 'ann', home: 'q' }, { name: 'bob', home: null }] }

test('decision rows: an approval belongs to its agent\'s project; a card to its board; the age is the blocked date, else the creation date', () => {
  const rows = decisionRows(view, office)
  assert.deepEqual(rows.map(r => [r.kind, r.board]), [['approval', 'q'], ['card', 'p'], ['card', 'p'], ['card', 'q'], ['card', 'r']])
  assert.deepEqual(rows.map(r => r.sinceMs), [500, 100, 300, 200, null])
  assert.equal(decisionRows({ approvals: [{ key: 'x', profile: 'bob' }], cards: [] }, office)[0].board, null, 'an agent of the common room: no project')
  assert.deepEqual(decisionRows({ approvals: [], cards: [] }, office), [])
})

test('grouped by project: the busiest project first, the longest waiting first inside it, « no project » last; nothing is lost', () => {
  const rows = decisionRows(view, office)
  const g = groupRows(rows)
  assert.deepEqual(g.map(x => [x.slug, x.count]), [['p', 2], ['q', 2], ['r', 1]])
  assert.deepEqual(g[0].rows.map(r => r.card.id), ['t1', 't2'], 'oldest (smallest) date first')
  assert.equal(g.reduce((n, x) => n + x.count, 0), rows.length)
  const none = groupRows([...rows, { key: 'n', kind: 'approval', board: null, sinceMs: 1 }])
  assert.equal(none.at(-1).slug, null)
  assert.deepEqual(groupRows([]), [])
  assert.deepEqual(byAge(rows).map(r => r.sinceMs), [100, 200, 300, 500, null], 'no date last, never invented')
})

test('filter by project, sort values, old after 24 h (orange age), short ages', () => {
  const rows = decisionRows(view, office)
  assert.equal(onlyProject(rows, 'p').length, 2)
  assert.equal(onlyProject(rows, null), rows)
  assert.equal(onlyProject(rows, 'nope').length, 0)
  assert.deepEqual([...SORTS], ['project', 'age'])
  assert.deepEqual([isSort('project'), isSort('age'), isSort('x'), isSort(undefined)], [true, true, false, false])
  assert.equal(OLD_AFTER_MS, 24 * 3_600_000)
  assert.equal(isOld({ sinceMs: 0 }, OLD_AFTER_MS), false)
  assert.equal(isOld({ sinceMs: 0 }, OLD_AFTER_MS + 1), true)
  assert.equal(isOld({ sinceMs: null }, 1e15), false, 'no date: not judged old')
  assert.equal(shortAge(5 * 60_000), '5 min')
  assert.match(shortAge(5 * 3_600_000), /^5 h/)
  assert.match(shortAge(27 * 3_600_000), /^1 d/)
})

/* ---------- alerts ---------- */
test('alerts: one chip per warning, in a fixed order, tone by gravity; none when all is well', () => {
  assert.deepEqual(alertsOf(), [])
  const all = alertsOf({ incidentBoards: ['p'], incidentFails: 3, gatewayDown: true, failingCrons: 2, banner: { staleMs: 1000, partial: { labels: [{ kind: 'x', name: 'y' }], more: 0 } }, rosterOnly: true })
  assert.deepEqual(all.map(a => a.id), ['incident', 'gateway', 'crons', 'stale', 'partial', 'roster'])
  assert.deepEqual(all.map(a => a.tone), ['crit', 'crit', 'warn', 'warn', 'info', 'info'])
  assert.deepEqual(alertsOf({ gatewayDown: true, gatewayDegraded: true }).map(a => a.id), ['gateway'], 'down says more than degraded')
  assert.deepEqual(alertsOf({ gatewayDegraded: true }).map(a => a.id), ['degraded'])
  assert.deepEqual(alertsOf({ banner: { staleMs: null, partial: { labels: [], more: 0 } } }), [], 'an empty banner says nothing')
})

test('alerts: a narrow pane folds them into the worst one + a count', () => {
  assert.equal(foldAlerts([]), null)
  const f = foldAlerts(alertsOf({ rosterOnly: true, failingCrons: 1, gatewayDown: true }))
  assert.equal(f.worst.id, 'gateway')
  assert.equal(f.more, 2)
})

/* ---------- tabs ---------- */
test('tabs: four in the panel (Decisions first), four in the bar of a narrow pane (the Agent view is reached from an agent)', () => {
  assert.deepEqual([...TABS], ['decisions', 'agent', 'projects', 'journal'])
  assert.deepEqual([...BAR], ['office', 'decisions', 'projects', 'journal'])
  assert.equal(NARROW_AT, 700)
  assert.deepEqual([isNarrow(0), isNarrow(700), isNarrow(701)], [false, true, false], 'unmeasured is not narrow')
  assert.equal(isTab('agent'), true)
  assert.equal(isTab('office'), false)
  assert.equal(barOf('agent'), 'office')
  assert.equal(barOf('journal'), 'journal')
})

test('tabs keyboard (WAI-ARIA): arrows wrap, Home / End jump, other keys are not taken', () => {
  assert.equal(tabForKey(TABS, 'decisions', 'ArrowRight'), 'agent')
  assert.equal(tabForKey(TABS, 'journal', 'ArrowRight'), 'decisions')
  assert.equal(tabForKey(TABS, 'decisions', 'ArrowLeft'), 'journal')
  assert.equal(tabForKey(TABS, 'agent', 'Home'), 'decisions')
  assert.equal(tabForKey(TABS, 'agent', 'End'), 'journal')
  assert.equal(tabForKey(TABS, 'agent', 'a'), null)
  assert.equal(tabForKey(TABS, 'agent', 'Enter'), null)
})

/* ---------- the page's sources and styles ---------- */
test('the new stylesheet and components hold no colour literal: theme variables only', () => {
  for (const f of ['pageStyles.js', 'PageHeader.jsx', 'AlertRail.jsx', 'ProjectDock.jsx', 'DecisionCard.jsx', 'DecisionsTab.jsx', 'AgentTab.jsx', 'ProjectsTab.jsx', 'JournalTab.jsx', 'TabBar.jsx', 'Popover.jsx', 'icons.jsx']) {
    const text = src(`src/ui/${f}`)
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, `${f}: no hex colour`)
    assert.doesNotMatch(text, /\brgba?\(|\bhsla?\(|\boklch\(\s*[\d.]/, `${f}: no colour function with a literal`)
  }
})

test('4 px grid: every margin, gap, padding and control height of the new stylesheet is a multiple of 4 (hairlines excepted)', () => {
  const bad = []
  for (const m of PAGE_CSS.matchAll(/(?:^|[;{ ])(gap|margin(?:-\w+)?|padding(?:-\w+)?|height|min-height):([^;}]+)/g)) {
    for (const n of m[2].matchAll(/(?<![\w.#-])(-?\d+(?:\.\d+)?)px/g)) {
      const v = Math.abs(Number(n[1]))
      if (v % 4 !== 0 && v > 2) bad.push(`${m[1]}:${m[2].trim()}`)
    }
  }
  assert.deepEqual([...new Set(bad)], [])
})

test('every card of the decision list names its project: a stripe + a chip (a group header says it once for the group)', () => {
  const frame = src('src/ui/DecisionCard.jsx')
  assert.match(frame, /useProjectStyle\(board\)/, 'the stripe carries the project colour')
  assert.match(frame, /<ProjectChip slug=\{board\}/, 'the chip is on the card when no group says it')
  assert.match(frame, /\(grouped \|\| filtered\) && board \? <span className="ux-vh">\{board\}<\/span> : null/, 'a grouped card keeps the name for the screen reader')
  const tab = src('src/ui/DecisionsTab.jsx')
  assert.match(tab, /<GroupHead slug=\{g\.slug\}/)
  assert.match(tab, /const grouped = sort === 'project' && !project/)
  assert.equal((tab.match(/filtered=\{Boolean\(project\)\}/g) || []).length, 2, 'under a filter the cards (and the approvals) do not repeat the project chip: the filter chip says it once')
  assert.match(tab, /ux-pbar\$\{project \? ' flt' : ''\}/, 'the filter chip lives on the sort line')
})

test('orders: the risk class is on every order button as a pip with a word for assistive tech, never a triangle or a tick', () => {
  const orders = src('src/ui/Orders.jsx')
  assert.match(orders, /<RiskDot risk=\{ORDERS\[verb\]\.risk\}/)
  assert.match(orders, /ux-vh">\(\{t\(`orders\.risk\.\$\{risk\}`\)\}\)/)
  assert.match(src('src/ui/Approvals.jsx'), /<RiskDot risk=\{choiceRisk\(c\)\}/)
  assert.doesNotMatch((PAGE_CSS.match(/\.ux-rk[^{]*\{[^}]*\}/g) ?? []).join(''), /content:\s*["'](?:!|✓|✔|⚠)/)
})

test('the logic of the orders is unchanged: the same machine, the 6 s window, the confirmation of final orders', () => {
  const orders = src('src/ui/Orders.jsx')
  assert.match(orders, /orders\.request\(v, item\)/)
  assert.match(orders, /act\('confirm'\)/)
  assert.match(orders, /UNDO_SECONDS/)
  assert.match(orders, /keyCancels\(state, e\.key\)/)
  assert.match(src('src/ui/Approvals.jsx'), /orders\.requestApproval\(req, c\)/)
})

test('i18n: the new block exists in en, fr and es with the same keys', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]))
  const en = keys(messages.en.ux).sort()
  assert.ok(en.length > 60)
  assert.deepEqual(keys(messages.fr.ux).sort(), en)
  assert.deepEqual(keys(messages.es.ux).sort(), en)
})

test('every path of the header icons stays inside the 24 x 24 view box and fills it (a glyph drawn on another grid shows up small and off centre)', () => {
  const src = readFileSync(new URL('../../src/ui/icons.jsx', import.meta.url), 'utf8')
  const house = src.match(/house: <path d="([^"]+)"/)[1]
  // absolute M/V/H and relative l/v/h only: walk the outline
  let x = 0; let y = 0; const xs = []; const ys = []
  for (const [, c, args] of house.matchAll(/([MVvHhlLz])([^MVvHhlLz]*)/g)) {
    const n = (args.match(/-?\d*\.?\d+/g) || []).map(Number)
    if (c === 'M' || c === 'L') { x = n[0]; y = n[1] } else if (c === 'l') { x += n[0]; y += n[1] } else if (c === 'V') y = n[0]; else if (c === 'v') y += n[0]; else if (c === 'H') x = n[0]; else if (c === 'h') x += n[0]
    xs.push(x); ys.push(y)
  }
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  assert.ok(x0 >= 2 && x1 <= 22 && y0 >= 2 && y1 <= 22, `inside: ${x0} ${x1} ${y0} ${y1}`)
  assert.ok(x1 - x0 >= 16 && y1 - y0 >= 16, `fills the box: ${x1 - x0} x ${y1 - y0}`)
  assert.ok(Math.abs((x0 + x1) / 2 - 12) <= 0.5 && Math.abs((y0 + y1) / 2 - 12) <= 0.5, 'centred')
})
}

// ===== inbox =====
{
// The decision box does not draw every blocked card (2 000 cards -> 2 000 rows): about 50 rows (approvals + cards), then « N more ».
const cards = n => Array.from({ length: n }, (_, i) => ({ board: 'b', id: `t_${i}` }))
const approvals = n => Array.from({ length: n }, (_, i) => ({ key: `a${i}` }))

test('the box shows at most INBOX_MAX rows in all (approvals first), the rest is counted', () => {
  assert.equal(INBOX_MAX, 50)
  const small = inboxView(cards(3), approvals(2))
  assert.deepEqual([small.approvals.length, small.cards.length, small.more, small.total], [2, 3, 0, 5])
  const big = inboxView(cards(2000), approvals(4))
  assert.deepEqual([big.approvals.length, big.cards.length, big.more, big.total], [4, 46, 1954, 2004])
  assert.equal(big.cards[0].id, 't_0', 'the longest waiting stay (the list arrives sorted)')
  const edge = inboxView(cards(50), [])
  assert.deepEqual([edge.cards.length, edge.more], [50, 0])
  assert.equal(inboxView(cards(51), []).more, 1)
  const flood = inboxView(cards(10), approvals(80))
  assert.deepEqual([flood.approvals.length, flood.cards.length, flood.more], [50, 0, 40], 'approvals alone are capped too')
})
test('« N more » is said in EN, FR, ES', () => {
  assert.equal(messages.en.inbox.more(1954), '1954 more')
  assert.equal(messages.fr.inbox.more(1954), '1954 autres')
  assert.equal(messages.es.inbox.more(1954), '1954 más')
})
}

// ===== inbox =====
{
// « N more » must be said whenever rows are left out, including when only approvals wait (no blocked card).
// inboxView caps approvals alone (« flood » above), so SidePanel.jsx must draw the « N more » line outside
// the `items.length ?` branch: 0 cards + 60 approvals draw 50 rows, a count of 60 and « 10 more ». No React under node
// (the bundle takes it from the host), so the branch is checked in the source, like the other JSX guards.
test('approvals alone over the cap leave rows out (the view counts them)', () => {
  const v = inboxView([], Array.from({ length: 60 }, (_, i) => ({ key: `a${i}` })))
  assert.deepEqual([v.approvals.length, v.cards.length, v.more], [50, 0, 10])
})

test('the box says « N more » in the branch with no blocked card too', () => {
  // the Decisions tab draws the « N more » line once, after the empty / grouped / flat branches: it does not depend on a card being there
  const panel = readFileSync(new URL('../../src/ui/DecisionsTab.jsx', import.meta.url), 'utf8')
  const tab = panel.slice(panel.indexOf('function DecisionsTab'), panel.indexOf('export function FilterChip'))
  const start = tab.indexOf('{view.more ?')
  assert.ok(start > 0, 'the « N more » line exists')
  assert.ok(start > tab.indexOf('data-empty'), 'it comes after the empty-state branch, outside of it')
  assert.match(tab.slice(start), /^\{view\.more \? <p[^>]*data-inbox-more/, 'and it is drawn whatever the rows are (cards or approvals only)')
})
}

// ===== inbox =====
{
// Finish defects seen in the real webapp, each kept as a test that fails without its fix.
const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

//  1.  FR, 1440 px: every decision card and every Journal row older than a day read « 21 d 12 h ». « d » is not French
//      (« 1 j 0 h » is, and the header already says « 11 j » for the streak). The day unit is a translated string.
test('the age of a card says the day in the language of the page (« 1 j 3 h » in French)', () => {
  const H = 3_600_000
  assert.equal(shortAge(27 * H, messages.fr.ux.dec.day), '1 j 3 h')
  assert.equal(shortAge(27 * H, messages.en.ux.dec.day), '1 d 3 h')
  assert.equal(shortAge(27 * H, messages.es.ux.dec.day), '1 d 3 h')
  assert.equal(shortAge(5 * H, messages.fr.ux.dec.day), '5 h', 'under a day nothing changes')
  for (const f of ['src/ui/DecisionCard.jsx', 'src/ui/JournalTab.jsx']) {
    const calls = src(f).match(/shortAge\([^)]*\)[^)]*\)/g) || []
    assert.ok(calls.length, `${f} formats an age`)
    for (const c of calls) assert.match(c, /t\('ux\.dec\.day'\)/, `${f}: ${c} passes the translated day`)
  }
})

//  2.  380 px (and any window where the office falls to a list without the panel): the note said « It comes back when you widen the
//      panel ». « Panel » is the Details panel (one word per thing), and widening it makes the office narrower.
test('the narrow-window note does not send the user to the Details panel', () => {
  for (const [lang, word] of [['en', /panel/i], ['fr', /panneau/i], ['es', /panel/i]]) {
    assert.doesNotMatch(messages[lang].narrowNote, word, `${lang}: ${messages[lang].narrowNote}`)
  }
})

//  3.  380 px list of the office: every group carries its project colour (the square on every group, card, island and dock chip)
//      and no row carries a two-letter grade chip « St », « Sr », « Cf » (cryptic).
//      The square is drawn; the grade goes to the row's tooltip, like in the scene.
test('the list view: a colour square per project group, no grade chip on the rows (the grade is in the tooltip)', () => {
  const scene = src('src/ui/OfficeScene.jsx')
  const list = scene.slice(scene.indexOf("view.mode === 'list'"))
  assert.match(list, /<h2>\s*\{z\.board \? <ListDot slug=\{z\.board\.slug\} \/> : null\}/, 'the group heading starts with the project square')
  assert.match(scene, /function ListDot\(\{ slug \}\)[^}]*className="oc-pdot"[^}]*useProjectStyle\(slug\)/, 'the square is the island one, coloured by project')
  assert.doesNotMatch(scene, /oc-gr\b|gradeShort/, 'no two-letter grade chip anywhere in the office')
  assert.match(list, /title=\{\[f\.tag, grades\?\.\[a\.name\] \? t\('game\.gradeTip'/, 'the grade stays readable in the row tooltip')
})

//  4.  Resources, Seating and the replay bar, every size: the segmented choices sat 2 px from the edge of their frame (4 px is the rule) and
//      measured 34 px high (2 + 1 px border twice around 28 px: off the 28 / 32 / 36 / 40 grid), unlike the page's own (Sort, Journal
//      filter: 4 px inset, a drawn 1 px edge). Same look everywhere now: 4 px inset, the edge drawn inside, 36 px high.
test('the segmented choices of the dialogs and of the replay bar have the page look: 4 px inset, no border box', async () => {
  const { DIALOG_CSS } = await import('../../src/ui/dialogStyles.js')
  const { REPLAY_CSS } = await import('../../src/ui/replayStyles.js')
  for (const [css, sel] of [[DIALOG_CSS, '.oc-dg-seg'], [REPLAY_CSS, '.oc-rp-win']]) {
    const rule = css.match(new RegExp(`\\n\\${sel}\\{([^}]*)\\}`))
    assert.ok(rule, `a base rule for ${sel}`)
    assert.match(rule[1], /padding:4px/, `${sel}: 4 px from the edge`)
    assert.match(rule[1], /border:0/, `${sel}: the edge is drawn inside (inset shadow), so 28 + 2 × 4 = 36 px`)
    assert.match(rule[1], /box-shadow:inset 0 0 0 1px/, `${sel}: the edge is still drawn`)
  }
})
}

// ===== inbox =====
{
// Wording of empty states.
test('without any board the empty states say how to create one, and never claim the boards run by themselves', () => {
  for (const [code, L] of Object.entries({ en, fr, es })) {
    assert.match(L.chains.empty, /hermes kanban boards create/, `${code}: chains.empty`)
    assert.match(L.inbox.noBoard, /hermes kanban boards create/, `${code}: inbox.noBoard`)
    assert.notEqual(L.inbox.noBoard, L.inbox.empty)
  }
  const panel = readFileSync(new URL('../../src/ui/DecisionsTab.jsx', import.meta.url), 'utf8')
  assert.match(panel, /office\.boards\.length \? 'inbox\.empty' : 'inbox\.noBoard'/, 'the inbox picks the no-board text when there is no board')
})
}
