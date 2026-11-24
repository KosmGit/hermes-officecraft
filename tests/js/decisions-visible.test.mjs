// Who waits for a decision, and on what: the sign on a bot at work that also has a blocked card (scene label, team list, legend, names for
// the screen reader), the title instead of the id, the reason a bot gave, and the decision card that shows it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { taskTag, waitBearers, waitSign } from '../../src/core/hud.js'
import { buildOffice } from '../../src/core/office.js'
import { PAGE_CSS } from '../../src/ui/pageStyles.js'
import { translate } from '../../src/core/translate.js'
import { messages } from '../../src/i18n/index.js'
import { labelOf } from '../../src/scene/labels.js'
import { STATE_ICONS } from '../../src/scene/stateicons.js'

const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const NOW = 1_800_000_000_000
const s = ms => ms / 1000
const tr = lang => (key, ...args) => translate(messages, lang, key, args)

const desk = (name, state) => ({ name, label: name, state, model: 'example/model-fast' })
const card = (id, status, assignee, extra = {}) => ({ id, title: `${id} title`, status, assignee, createdAt: s(NOW - 7_200_000), startedAt: s(NOW - 3_600_000), heartbeatAt: status === 'running' ? s(NOW - 20_000) : null, ...extra })
const office = (desks, boards) => buildOffice(desks, { ok: true, boards }, NOW)
const by = (o, name) => o.agents.find(a => a.name === name)

// ===== the sign =====

test('waitSign: a bot at work with a blocked card carries it; 0, 1 or several cards; a bot already waiting says it by its state', () => {
  const o = office(
    [desk('alpha', 'working'), desk('beta', 'working'), desk('gamma', 'working'), desk('delta', 'idle'), desk('lone', 'active'), desk('quiet', 'working')],
    [{ slug: 'website', tasks: [
      card('a1', 'running', 'alpha'), card('a2', 'blocked', 'alpha'),                                  // at work + 1 blocked
      card('b1', 'running', 'beta'), card('b2', 'blocked', 'beta'), card('b3', 'blocked', 'beta'),     // at work + 2 blocked
      card('g1', 'running', 'gamma'),                                                                   // at work, nothing blocked
      card('d1', 'blocked', 'delta'),                                                                   // not at work: the state itself is « waiting »
      // `quiet` runs a card that went silent AND has a blocked one: both signs
      card('q1', 'running', 'quiet', { heartbeatAt: s(NOW - 40 * 60_000) }), card('q3', 'running', 'quiet'), card('q2', 'blocked', 'quiet')
    ] }]
  )
  assert.equal(by(o, 'alpha').state, 'working')
  assert.equal(waitSign(by(o, 'alpha')), true, '1 blocked card')
  assert.equal(waitSign(by(o, 'beta')), true, 'several blocked cards')
  assert.equal(waitSign(by(o, 'gamma')), false, '0 blocked card')
  assert.equal(by(o, 'delta').state, 'waiting')
  assert.equal(waitSign(by(o, 'delta')), false, 'a waiting bot has its state, not the sign on top of it')
  assert.equal(waitSign(by(o, 'lone')), false, 'a bot with no card at all (no project)')
  assert.equal(by(o, 'lone').home, null)
  assert.equal(waitSign(by(o, 'quiet')), true, 'a bot with a silent card still carries the sign')
  assert.equal(by(o, 'quiet').quiet.length, 1)
  for (const bad of [null, undefined, {}, { state: 'working' }, { state: 'working', blocked: [] }, { state: 'working', blocked: 'x' }]) assert.equal(waitSign(bad), false)
})

test('waitBearers: the bots that say « a decision waits » on screen are exactly the bots with a blocked card', () => {
  const o = office(
    [desk('alpha', 'working'), desk('beta', 'working'), desk('gamma', 'idle'), desk('delta', 'idle'), desk('lone', 'new')],
    [{ slug: 'website', tasks: [card('a1', 'running', 'alpha'), card('a2', 'blocked', 'alpha'), card('b1', 'running', 'beta'), card('g1', 'blocked', 'gamma'), card('g2', 'blocked', 'gamma'), card('d1', 'done', 'delta')] },
      { slug: 'docs', tasks: [card('x1', 'blocked', null)] }]   // a blocked card nobody owns (a campaign's guard): no bot carries it
  )
  const withBlocked = o.agents.filter(a => a.blocked.length > 0).map(a => a.name)
  assert.deepEqual(withBlocked, ['alpha', 'gamma'])
  assert.deepEqual(waitBearers(o.agents).map(a => a.name), withBlocked, 'sign + waiting state = every bot that has a blocked card')
  assert.deepEqual(waitBearers([]), [])
  assert.deepEqual(waitBearers(null), [])
})

test('the tag and the label: only a bot at work carries `wait`; the label keeps its name and code; the state stays the main one', () => {
  const o = office([desk('alpha', 'working'), desk('beta', 'idle')], [{ slug: 'website', tasks: [card('a1', 'running', 'alpha', { title: 'WEB4 — Redesign' }), card('a2', 'blocked', 'alpha'), card('b1', 'blocked', 'beta')] }])
  const alpha = by(o, 'alpha')
  const tag = taskTag(alpha, NOW)
  assert.equal(tag.kind, 'working')
  assert.equal(tag.wait, 1)
  assert.deepEqual(labelOf(alpha, tag), { name: 'alpha', code: 'WEB4', wait: true })
  assert.equal(alpha.state, 'working', 'the state, so the outline, the ring on the floor and the selection hue, is still « working »')
  const beta = by(o, 'beta')
  assert.equal(taskTag(beta, NOW).kind, 'waiting')
  assert.equal(taskTag(beta, NOW).wait, undefined)
  assert.equal(labelOf(beta, taskTag(beta, NOW)).wait, undefined)
  // nothing blocked: the tag is what it was, key for key
  const plain = office([desk('g', 'working')], [{ slug: 'website', tasks: [card('g1', 'running', 'g')] }]).agents[0]
  assert.deepEqual(Object.keys(taskTag(plain, NOW)).sort(), ['kind', 'ref', 'span'])
})

test('the sign is drawn with the state icons of the scene (no character), the state colours stay the main state\'s', () => {
  const scene = src('src/ui/OfficeScene.jsx')
  assert.equal([...scene.matchAll(/<span className="oc-wait" data-wait aria-hidden="true"><StateIcon state="waiting" \/><\/span>/g)].length, 2, 'the label of the scene and the row of the list')
  assert.match(src('src/ui/AgentTab.jsx'), /className="ux-wait"[^>]*><StateIcon state="waiting" \/>/, 'the row of the team list')
  assert.ok(STATE_ICONS.waiting.some(r => r.includes('#')), 'the « ! » is a pixel icon')
  const css = src('src/ui/sceneStyles.js')
  const rule = css.match(/\.oc-wait\{[^}]*\}/)[0]
  assert.match(rule, /color:\$\{ink\(ORANGE\)\}/)
  const waitRules = css.split('\n').filter(l => l.includes('.oc-wait'))
  assert.ok(waitRules.length >= 2)
  for (const l of waitRules) assert.doesNotMatch(l, /oc-s-|--sel|border-color|outline/, 'the sign never touches the outline, the ring or the selection hue of the main state')
  assert.doesNotMatch(rule, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no colour literal')
})

test('the accessible name says it, in the three languages; the legend has the entry', () => {
  const scene = src('src/ui/OfficeScene.jsx')
  assert.match(scene, /const said = wait \? `\$\{state\}, \$\{wait\}` : state/)
  assert.match(scene, /label: `\$\{a\.label \|\| a\.name\} — \$\{said\}\./)
  assert.match(src('src/ui/Legend.jsx'), /data-legend-sign="wait"/)
  const one = { en: 'a decision is waiting for you', fr: 'une décision vous attend', es: 'una decisión te espera' }
  for (const lang of ['en', 'fr', 'es']) {
    assert.equal(tr(lang)('waitTip', 1), one[lang])
    assert.match(tr(lang)('waitTip', 3), /3/)
    for (const k of ['legend.waitName', 'legend.waitSign']) assert.ok(tr(lang)(k).length > 8, `${lang} ${k}`)
  }
  assert.equal(`${tr('fr')('state.working')}, ${tr('fr')('waitTip', 1)}`, 'Au travail, une décision vous attend')
})

// ===== the title instead of the id =====

import { eventsView, inspectorOf } from '../../src/core/panel.js'
import { toHistory } from '../../src/core/history.js'

const hist = events => toHistory({ ok: true, profiles: [], boards: [{ slug: 'website', runs: [], events }] })

test('journal: a known card is named by its title, an unknown (archived) one by its id; a hostile title is cleaned and never HTML', () => {
  const hostile = '<img src=x onerror=alert(1)>\u202e Fix\u200b the\nlogin\u2066 [x](javascript:alert(1))'
  const o = office([desk('alpha', 'idle')], [{ slug: 'website', tasks: [
    card('t_known', 'blocked', 'alpha', { title: 'Choose the hero photo' }),
    card('t_code', 'blocked', 'alpha', { title: 'WEB4 — Redesign the footer' }),
    card('t_evil', 'blocked', 'alpha', { title: hostile }),
    card('t_empty', 'blocked', 'alpha', { title: '' })
  ] }])
  const ev = eventsView(hist([
    { task: 't_known', kind: 'blocked', ts: s(NOW - 1000) }, { task: 't_code', kind: 'blocked', ts: s(NOW - 2000) },
    { task: 't_evil', kind: 'blocked', ts: s(NOW - 3000) }, { task: 't_gone', kind: 'blocked', ts: s(NOW - 4000) }, { task: 't_empty', kind: 'blocked', ts: s(NOW - 5000) }
  ]), o)
  const row = id => ev.find(e => e.code === id || e.title.includes(id))
  assert.equal(ev.length, 5)
  assert.equal(ev[0].title, 'Choose the hero photo')
  assert.equal(ev[1].title, 'WEB4 — Redesign the footer', 'the title as the board has it, code included')
  assert.equal(ev[1].code, 'WEB4')
  assert.equal(ev[2].title, '<img src=x onerror=alert(1)> Fix the login [x](javascript:alert(1))', 'bidi and zero-width gone, one line; the markup is kept as the plain text it is')
  assert.equal(ev[3].title, '', 'a card the board no longer has: no title…')
  assert.equal(ev[3].code, 't_gone', '…its id stays')
  assert.equal(ev[4].title, '', 'a known card without a title falls back on the id too')
  assert.equal(ev[4].code, 't_empty')
  assert.equal(row('t_gone').title || row('t_gone').code, 't_gone')
  // the page draws it as text: no HTML anywhere on this path
  for (const f of ['src/ui/JournalTab.jsx', 'src/ui/AgentTab.jsx', 'src/ui/DecisionCard.jsx']) assert.doesNotMatch(src(f), /dangerouslySetInnerHTML|innerHTML/, f)
  assert.match(src('src/ui/JournalTab.jsx'), /\$\{e\.title \|\| e\.code\}/)
})

test('inspector: the « waits for you » block names a card by its title, keeps the id for the tooltip, falls back on the id when there is no title', () => {
  const o = office([desk('alpha', 'idle')], [{ slug: 'website', tasks: [
    card('t_plain', 'blocked', 'alpha', { title: 'Pick the push provider', createdAt: s(NOW - 9_000_000) }),
    card('t_coded', 'blocked', 'alpha', { title: 'S3.2 — Inspector', createdAt: s(NOW - 8_000_000) }),
    card('t_bare', 'blocked', 'alpha', { title: '', createdAt: s(NOW - 7_000_000) }),
    card('t_evil', 'blocked', 'alpha', { title: 'Ship it\u202e\u200b\nnow <b>x</b>', createdAt: s(NOW - 6_000_000) })
  ] }])
  const w = inspectorOf(by(o, 'alpha'), { nowMs: NOW }).waiting
  assert.deepEqual(w.map(x => x.title), ['Pick the push provider', 'Inspector', 't_bare', 'Ship it now <b>x</b>'])
  assert.deepEqual(w.map(x => x.id), ['t_plain', 't_coded', 't_bare', 't_evil'])
  assert.deepEqual(w.map(x => x.named), [false, true, false, false], 'only a real code (S3.2) is shown in front of the title')
  assert.equal(w[1].code, 'S3.2')
  assert.equal(w[0].code, 't_plain', 'the code field keeps meaning « code, else id » (the tests of the panel and the notifier read it)')
  const tab = src('src/ui/AgentTab.jsx')
  assert.match(tab, /className="one ux-ag-wt" title=\{w\.id\}>\{w\.title\}</, 'one line, the id in the tooltip')
  assert.match(src('src/ui/pageStyles.js'), /\.ux-ag-wt\{[^}]*text-overflow:ellipsis;white-space:nowrap/)
})

// ===== the sheet of a bot that waits: the action first =====

test('agent sheet: « waits for you » comes first under the header, « Decide » is the filled button, « Open the session » the secondary one, and no session is said in clear', () => {
  const tab = src('src/ui/AgentTab.jsx')
  const at = s => tab.indexOf(s)
  assert.ok(at('data-insp-waiting') > at('ux-ag-h') && at('data-insp-waiting') < at('<dl className="ux-kv">'), 'the block sits between the header and the facts')
  assert.match(tab, /className="ux-b sm pri" data-decide/)
  assert.match(tab, /className=\{`ux-b\$\{i\.waiting\.length \? '' : ' pri'\}`\}/, 'secondary when a decision waits (primary when there is nothing else to do)')
  assert.match(tab, /\{canOpen \? null : <small className="ux-ag-nos" data-insp-nosession>\{why\}<\/small>\}/, 'no session: said in words, not only dimmed')
  for (const lang of ['en', 'fr', 'es']) {
    assert.match(tr(lang)('ux.agent.decide'), /^[A-ZÀ-Ý]/, `${lang}: a button label starts with a capital`)
    assert.ok(tr(lang)('ux.agent.decideCard', 'Pick one').includes('Pick one'))
    assert.ok(tr(lang)('ux.agent.decideCard', 'Pick one').startsWith(tr(lang)('ux.agent.decide')), `${lang}: the name of the button starts with its visible label`)
  }
})

// ===== the reason the bot gave =====

import { toBoard, BLOCK_REASON_MAX } from '../../src/core/office.js'
import { inboxItems } from '../../src/core/panel.js'
import { cutWords, oneLine } from '../../src/core/util.js'

const rawBoard = tasks => ({ slug: 'website', tasks })
const rawCard = (id, status, extra = {}) => ({ id, title: `${id} title`, status, assignee: 'alpha', createdAt: s(NOW - 3_600_000), ...extra })

test('reason: a blocked card carries it to the decision list; no reason → no key (nothing to draw, not even an empty line)', () => {
  const board = toBoard(rawBoard([
    rawCard('a', 'blocked', { blockReason: 'Which provider should we pick?' }),
    rawCard('b', 'blocked'),                                   // an older agent half, or none given
    rawCard('c', 'blocked', { blockReason: null }),
    rawCard('d', 'blocked', { blockReason: '   \n\u202e  ' }), // nothing left once cleaned
    rawCard('e', 'running', { blockReason: 'not blocked: ignored' })
  ]))
  const by_ = id => board.tasks.find(t => t.id === id)
  assert.equal(by_('a').blockReason, 'Which provider should we pick?')
  for (const id of ['b', 'c', 'd', 'e']) assert.equal('blockReason' in by_(id), false, id)
  const items = inboxItems({ boards: [board], agents: [] })
  assert.equal(items.find(i => i.id === 'a').reason, 'Which provider should we pick?')
  for (const id of ['b', 'c', 'd']) assert.equal('reason' in items.find(i => i.id === id), false, id)
})

test('reason: hostile text is one clean line, bounded to 280 characters, cut on a word; markup and links stay inert text', () => {
  const hostile = '<script>alert(1)</script> [open](javascript:alert(1)) **bold** https://example.com/x\u202eevil\u200b\nline two\u2028line three\u0007'
  const t = toBoard(rawBoard([rawCard('a', 'blocked', { blockReason: hostile })])).tasks[0]
  assert.equal(t.blockReason, '<script>alert(1)</script> [open](javascript:alert(1)) **bold** https://example.com/xevil line two line three')
  const long = toBoard(rawBoard([rawCard('a', 'blocked', { blockReason: 'word '.repeat(1000) })])).tasks[0].blockReason
  assert.ok([...long].length <= BLOCK_REASON_MAX && long.endsWith('word…'), long.slice(-12))
  assert.equal(BLOCK_REASON_MAX, 280)
  const solid = toBoard(rawBoard([rawCard('a', 'blocked', { blockReason: 'x'.repeat(5000) })])).tasks[0].blockReason
  assert.equal([...solid].length, 280)
  assert.equal(cutWords('short', 280), 'short')
  assert.equal(cutWords('alpha, beta, gamma', 12), 'alpha…', 'a word is cut whole, and no dangling comma stays before the ellipsis')
  assert.equal(oneLine(null), '')
  assert.equal(oneLine(42), '')
})

test('reason: drawn as text only, with its own unfolding; never a title, a link or a button name', () => {
  const card = src('src/ui/DecisionCard.jsx')
  const tab = src('src/ui/DecisionsTab.jsx')
  assert.match(card, /<Clamped text=\{reason\} className="ux-dc-r"/, 'two lines, unfolded like the title')
  assert.match(card, /<p ref=\{ref\} id=\{id\} className=\{`\$\{className\}\$\{whole \? ' whole' : ''\}`\} title=\{tip\}>\{children\}\{text\}<\/p>/, 'the text is a child of a paragraph')
  assert.doesNotMatch(card.slice(card.indexOf('{reason ? ('), card.indexOf('<div className="ux-dc-who">')), /tip=|title=/, 'no tooltip on the reason')
  assert.doesNotMatch(card, /dangerouslySetInnerHTML|innerHTML|<a\s|href=/)
  assert.match(tab, /reason=\{guard \? null : c\.reason \?\? null\}/)
  // the names of the buttons that open it never contain it
  for (const lang of ['en', 'fr', 'es']) for (const k of ['reason', 'reasonMore', 'reasonLess']) assert.equal(tr(lang)(`ux.dec.${k}`, 'LEAK'), tr(lang)(`ux.dec.${k}`), `${lang} ${k} takes no argument`)
  for (const f of ['src/ui/Orders.jsx', 'src/ui/DecisionsTab.jsx', 'src/ui/DecisionCard.jsx']) assert.doesNotMatch(src(f), /aria-label=\{[^}]*(reason|blockReason)/, f)
  // the reason stays on the decision card: no other screen of the page reads it
  const readers = ['src/ui/AgentTab.jsx', 'src/ui/JournalTab.jsx', 'src/ui/OfficeScene.jsx', 'src/ui/ProjectDock.jsx', 'src/ui/ProjectsTab.jsx', 'src/core/notify.js', 'src/core/notifyFormat.js', 'src/core/hud.js', 'src/core/llm.js', 'src/core/llmAssist.js']
  for (const f of readers) assert.doesNotMatch(src(f), /blockReason/, `${f} does not read the reason of a blocked card`)
})

// ===== the first line of a decision card =====

test('decision card: the age sits on the line of the agent, the « open » icons at the right of the title, the first line only exists when it has something to say', () => {
  const card = src('src/ui/DecisionCard.jsx')
  const top = card.slice(card.indexOf('<div className="ux-dc-top">'), card.indexOf('<div className="ux-dc-th">'))
  assert.doesNotMatch(top, /ux-age|\{open\}/, 'the first line holds neither the age nor the icons')
  assert.match(card, /\{chip \|\| mark \? \(\n\s+<div className="ux-dc-top">/, 'no project chip and no code: no first line at all')
  const th = card.slice(card.indexOf('<div className="ux-dc-th">'), card.indexOf('{summary ?'))
  assert.match(th, /<Clamped text=\{title\}[\s\S]*\{open\}/, 'icons after the title')
  const who = card.slice(card.indexOf('<div className="ux-dc-who">'), card.lastIndexOf('{children}'))
  assert.match(who, /className=\{`ux-age\$\{old \? ' old' : ''\}`\} title=\{ageTip\} data-age/, 'the age ends the line of the agent')
  const css = PAGE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\.ux-dc-th\{display:flex;align-items:flex-start/)
  assert.match(css, /\.ux-dc-tt\{flex:1 1 auto;min-width:0/, 'the title column gives way to the icons')
  assert.match(css, /\.ux-age\{[^}]*margin-left:auto/, 'the age is pushed to the end of the line of the agent')
})

test('decision card: « open in the kanban » is named by the card (code and title), never by an id alone, in the three languages', () => {
  const orders = src('src/ui/Orders.jsx')
  assert.match(orders, /t\('ux\.dec\.openKanban', \[item\.code, item\.title\]\.filter\(Boolean\)\.join\(' '\) \|\| item\.id\)/)
  for (const lang of ['en', 'fr', 'es']) {
    const name = tr(lang)('ux.dec.openKanban', 'WEB4 Redesign the footer')
    assert.ok(name.includes('WEB4 Redesign the footer') && /kanban/.test(name), `${lang}: ${name}`)
    assert.doesNotMatch(name, /\(t_|t_[0-9a-f]{6}/)
  }
})

// ===== « Cancel the campaign » and the filter line =====

test('« Cancel the campaign » is the discreet secondary button at the right, « Cancel » when room is short, the full words as its name; the risk and the confirmation are untouched', () => {
  const orders = src('src/ui/Orders.jsx')
  assert.match(orders, /verb === 'cancel_campaign' \? ' ghost cx' : ''/)
  assert.match(orders, /<span className="full">\{t\(`orders\.verb\.\$\{verb\}`\)\}<\/span><span className="short" aria-hidden="true">/)
  assert.match(orders, /primary=\{v === 'unblock' \|\| v === 'launch'\}/, '« Launch » stays the only filled one')
  assert.match(orders, /<RiskDot risk=\{ORDERS\[verb\]\.risk\}/)
  const css = PAGE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\.ux-dc-o \.ux-b\.cx\{margin-left:auto/)
  assert.match(css, /@container ux \(max-width: 700px\)\{\s*\.ux-dc-o \.ux-b\.cx \.full\{position:absolute/)
  for (const lang of ['en', 'fr', 'es']) {
    const full = tr(lang)('orders.verb.cancel_campaign'), short = tr(lang)('orders.verbShort.cancel_campaign')
    assert.ok(short.length < full.length && full.startsWith(short.slice(0, 4)), `${lang}: ${short} / ${full}`)
  }
})

test('journal: the text column keeps fixed columns but shows up to two lines, so a card title is readable in a narrow side pane', () => {
  const css = PAGE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\.ux-jl li\{display:grid;grid-template-columns:52px 20px minmax\(0,112px\) minmax\(0,1fr\)/, 'the columns stay fixed')
  const rule = css.match(/\.ux-jl \.tx \.t\{[^}]*\}/)?.[0] ?? ''
  assert.match(rule, /-webkit-line-clamp:2/, 'two lines at most (one line left « blocked · Ap… » in a 300 px pane)')
  assert.match(rule, /overflow:hidden/)
  assert.doesNotMatch(rule, /white-space:nowrap/)
  assert.match(src('src/ui/JournalTab.jsx'), /<span className="t" title=\{r\.text\}>/, 'the whole text stays the tooltip')
})

test('under a project filter the chip is on the sort line (one « ? ») and the cards do not repeat it', () => {
  const tab = src('src/ui/DecisionsTab.jsx')
  assert.equal((tab.match(/<ListHelp t=\{t\} \/>/g) || []).length, 1, 'one « ? »')
  assert.match(tab, /\{project \? <FilterChip slug=\{project\}/)
  assert.match(tab, /className=\{project \? 'lbl ux-vh' : 'lbl'\} id="ux-sort-l"/, 'the word stays for the screen reader')
  const css = PAGE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  // the chip says which project is filtered: it shares the sort line when there is room and moves under it otherwise, never squeezed
  // below its own name (in a 300 px side pane a squeezed chip read « d… »)
  assert.doesNotMatch(css, /\.ux-pbar\.flt\{[^}]*flex-wrap:nowrap/, 'the sort line may wrap under a filter')
  assert.match(css, /\.ux-pbar\.flt \.ux-prjx\{flex:0 1 auto;min-width:0;max-width:100%\}/, 'the chip never overflows the pane')
  // the chip and the « ? » are one group that wraps together: the « ? » is never left alone on a line of its own
  assert.match(tab, /<span className=\{project \? 'ux-fltg' : 'grow'\}>\{project \? <FilterChip slug=\{project\}[^}]*\} t=\{t\} \/> : null\}<ListHelp t=\{t\} \/><\/span>/)
  assert.match(css, /\.ux-pbar \.ux-fltg\{display:inline-flex;align-items:center;gap:8px;margin-left:auto;min-width:0;max-width:100%\}/)
  const frame = src('src/ui/DecisionCard.jsx')
  assert.match(frame, /const chip = !grouped && !filtered/)
})
