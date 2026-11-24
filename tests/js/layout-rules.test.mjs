import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { railFit } from '../../src/core/alerts.js'
import { POP_EDGE, placePopover, scrollCloses } from '../../src/core/popover.js'
import { PAGE_CSS } from '../../src/ui/pageStyles.js'
import { SCENE_CSS } from '../../src/ui/sceneStyles.js'
import { USAGE_CSS } from '../../src/ui/usageStyles.js'
import { LM_CSS } from '../../src/ui/dialogStyles.js'
import { PANEL_CSS } from '../../src/ui/panelStyles.js'

const src = f => readFileSync(new URL(`../../src/ui/${f}`, import.meta.url), 'utf8')
/** The declarations of the first rule whose selector list contains `selector` exactly (written as in the stylesheet). */
function rule(css, selector) {
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (const m of css.matchAll(re)) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(s => s.trim())
    if (sels.includes(selector)) return m[2].replace(/\/\*[\s\S]*?\*\//g, '')
  }
  return null
}
const has = (decls, prop, value) => new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*${value}\\s*(?:;|!important|$)`).test(decls ?? '')

test('team list: the name gives way with an ellipsis, the project chip first, the state never', () => {
  const nm = rule(PAGE_CSS, '.ux-rosterb .nm')
  assert.ok(has(nm, 'flex', '0 1 auto'), 'the name may shrink')
  assert.ok(has(nm, 'text-overflow', 'ellipsis') && has(nm, 'overflow', 'hidden') && has(nm, 'white-space', 'nowrap'))
  const chip = rule(PAGE_CSS, '.ux-rosterb .ux-prj')
  assert.match(chip, /flex:\s*0 100 auto/, 'the chip shrinks 100 times faster than the name')
  assert.ok(has(rule(PAGE_CSS, '.ux-rosterb .ux-st'), 'flex', '0 0 auto'), 'the state keeps its width')
  assert.match(src('AgentTab.jsx'), /className="nm" title=\{a\.label \|\| a\.name\}/, 'the whole name is also on the row')
})

test('scene label: the name has a ceiling and an ellipsis; the whole name stays in the accessible name', () => {
  const nm = rule(SCENE_CSS, '.oc-station .oc-chip .oc-nm')
  assert.match(nm, /max-width:\s*\d+px/)
  assert.ok(has(nm, 'text-overflow', 'ellipsis') && has(nm, 'overflow', 'hidden'))
  assert.match(src('OfficeScene.jsx'), /aria-label=\{f\.label\}/)
  assert.match(readFileSync(new URL('../../src/core/hud.js', import.meta.url), 'utf8'), /foldOverlaps/)
})

test('30 days: every day is a target of at least 24 px; the row scrolls, the page and the window do not', () => {
  const r = rule(USAGE_CSS, '.oc-us-days[data-n="30"],.oc-us-days[data-n="31"]') ?? USAGE_CSS.match(/\.oc-us-days\[data-n="30"\],\.oc-us-days\[data-n="31"\]\{([^}]*)\}/)?.[1]
  assert.ok(r, 'a rule for the 30 and 31 day rows')
  assert.match(r, /grid-template-columns:\s*repeat\(var\(--n\),\s*minmax\(24px,\s*1fr\)\)/)
  assert.ok(has(r, 'overflow-x', 'auto') && has(r, 'overscroll-behavior-x', 'contain'))
  assert.ok(!/@media[^{]*\{[^@]*\.oc-us-day\{[^}]*width:\s*(?:1\d|2[0-3])px/.test(USAGE_CSS), 'no narrower day under a media query')
})

test('the tooltip of the scene can be reached with the pointer, and Escape closes it wherever the focus is', () => {
  assert.ok(has(rule(SCENE_CSS, '.oc-tip'), 'pointer-events', 'auto'))
  const s = src('OfficeScene.jsx')
  assert.match(s, /document\.addEventListener\('keydown', onKey, true\)/)
  assert.ok(!/onKeyDown=\{e => \{ if \(e\.key === 'Escape' && tip\)/.test(s), 'Escape is no longer handled only inside the stage')
  assert.match(s, /onMouseEnter=\{keepTip\}/)
  assert.match(s, /TIP_LEAVE_MS/)
})

test('small targets and the floating bar', () => {
  const mk = rule(LM_CSS, '.oc-lm-mk')
  assert.match(mk, /min-height:\s*24px/)
  assert.match(mk, /min-width:\s*24px/)
  const body = rule(PANEL_CSS, '.ux-main:has(.oc-ordbar) .ux-pbody')
  assert.match(body, /padding-bottom:\s*\d+px/)
  assert.match(body, /scroll-padding-bottom:\s*\d+px/, 'a focused row scrolls above the floating bar')
  assert.equal(body.match(/padding-bottom:\s*(\d+)px/)[1], body.match(/scroll-padding-bottom:\s*(\d+)px/)[1])
  // the rule must name classes the page really draws (a selector nobody renders reserves nothing)
  assert.match(src('OfficePage.jsx'), /className=\{`ux-main/)
  assert.match(src('SidePanel.jsx'), /className="ux-pbody"/)
  assert.match(src('Orders.jsx'), /className="oc-ordbar"/)
})

test('help popover: capped, scrolls inside itself, and a scroll of the card does not close it', () => {
  const pop = rule(PAGE_CSS, '.ux-pop')
  assert.match(pop, /max-height:\s*calc\(100vh - 16px\)/)
  assert.ok(has(pop, 'overflow-y', 'auto'))
  assert.ok(scrollCloses({ insideCard: false }) && !scrollCloses({ insideCard: true }))
  const s = src('Popover.jsx')
  assert.match(s, /scrollCloses\(\{ insideCard/)
  assert.ok(!/addEventListener\('scroll', close, true\)/.test(s))
  // placement: below when it fits, else on the side with more room, capped to that room
  const view = { w: 800, h: 600 }
  const small = placePopover({ anchor: { top: 100, bottom: 124, left: 400, width: 24 }, card: { w: 200, h: 100 }, view })
  assert.deepEqual([small.top, small.maxH], [132, 600 - 124 - 16])
  const low = placePopover({ anchor: { top: 500, bottom: 524, left: 400, width: 24 }, card: { w: 200, h: 300 }, view })
  assert.equal(low.top, 500 - 300 - 8, 'flips above when it does not fit below')
  const long = placePopover({ anchor: { top: 500, bottom: 524, left: 400, width: 24 }, card: { w: 200, h: 900 }, view })
  assert.equal(long.maxH, 500 - 16, 'a card taller than any room is capped to the larger side')
  assert.ok(long.top >= POP_EDGE && long.top + long.maxH <= view.h - POP_EDGE)
  assert.equal(placePopover({ anchor: { top: 10, bottom: 30, left: 790, width: 10 }, card: { w: 300, h: 50 }, view }).left, 800 - 300 - 8, 'kept inside the window')
})

test('the rail of alerts folds what does not fit into « +N » instead of clipping it', () => {
  assert.ok(!/overflow:\s*hidden/.test(rule(PAGE_CSS, '.ux-alerts')), 'the rail no longer clips (the focus ring of a chip shows)')
  assert.equal(railFit([100, 100, 100], 400), 3, 'all fit')
  assert.equal(railFit([100, 100, 100], 316), 3, 'exactly: 3 chips and 2 gaps')
  assert.equal(railFit([100, 100, 100], 280), 2, 'one chip folds, the « +N » chip (56) must fit too: 100 + 8 + 100 + 8 + 56 = 272')
  assert.equal(railFit([100, 100, 100], 200), 1)
  assert.equal(railFit([300, 100], 120), 1, 'the worst chip always stays')
  assert.equal(railFit([0, 0, 0], 50), 3, 'unmeasured: everything is drawn once so it can be measured')
  assert.equal(railFit([], 500), 0)
  const rail = src('AlertRail.jsx')
  assert.match(rail, /railFit\(/)
  assert.match(rail, /t\('ux\.alert\.rest'/, 'the folded chip names how many alerts hide behind it')
})

test('what was only in a title reaches the keyboard and the finger', () => {
  const dc = src('DecisionCard.jsx')
  assert.match(dc, /aria-expanded=\{whole\}/)
  assert.match(dc, /data-dc-more/)
  assert.ok(has(rule(PAGE_CSS, '.ux-dc-t.whole'), 'overflow', 'visible'))
  const pj = src('ProjectsTab.jsx')
  assert.match(pj, /data-queue-toggle[^>]*aria-expanded=\{listed\}/)
  assert.match(pj, /statusText\(t, q\.status\)/, 'the status of a card is written in the list')
  // the status of a pip is also a shape: running, blocked and to do each have one that is not a colour
  assert.match(PAGE_CSS, /\.ux-pips i\.running[^{]*\{[^}]*clip-path/)
  assert.match(PAGE_CSS, /\.ux-pips i\.blocked[^{]*\{[^}]*repeating-linear-gradient/)
  // a button that cannot be used says why when it is pressed, and with its name
  for (const f of ['AgentTab.jsx', 'ProjectDock.jsx', 'PageHeader.jsx']) assert.match(src(f), /<WhyButton/, f)
  const why = src('Why.jsx')
  assert.match(why, /aria-describedby=\{why\.describedBy\}/)
  assert.match(why, /role="status"/)
  assert.ok(!/aria-disabled=\{!canOpen\}/.test(src('AgentTab.jsx') + src('ProjectDock.jsx')))
  // the command of an approval is never a title nor a name (the existing test of the approvals holds it for the card itself)
  for (const f of ['DecisionCard.jsx', 'ProjectsTab.jsx', 'Why.jsx']) assert.ok(!/title=\{[^}]*command/i.test(src(f)), `${f}: a command in a title`)
})

/** The text of a block opened by `head` (an at-rule line), braces balanced. */
function block(css, head) {
  const at = css.indexOf(head)
  if (at < 0) return null
  let depth = 0
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', at) + 1, i)
  }
  return null
}

test('header: words from 1500 px of pane, never a clipped gear: the title and the word of the decisions pill give way first', () => {
  const wide = block(PAGE_CSS, '@container ux (min-width: 1500px)')
  assert.match(wide, /\.ux-acts \.ux-b \.lb\{display:inline\}/, 'the words of the buttons come back from 1500 px')
  assert.ok(!/\.lb/.test(block(PAGE_CSS, '@container ux (max-width: 1320px)')), 'they no longer fold at 1320 px: French and Spanish need about 1445 px')
  assert.ok(has(rule(PAGE_CSS, '.ux-acts .ux-b .lb'), 'display', 'none'), 'icons are the default')
  // what may not shrink, and what may
  assert.ok(has(rule(PAGE_CSS, '.ux-acts'), 'flex', '0 0 auto'), 'the actions and the gear keep their width')
  assert.ok(has(rule(PAGE_CSS, '.ux-brand'), 'flex', '0 1 auto') && has(rule(PAGE_CSS, '.ux-live'), 'flex', '0 1 auto'))
  assert.ok(has(rule(PAGE_CSS, '.ux-lvp.dec .w'), 'text-overflow', 'ellipsis'))
  assert.match(src('PageHeader.jsx'), /<span className="w">\{t\('ux\.pill\.decisions'/, 'the word of the decisions pill is its own element (it keeps its accessible name when cut)')
  for (const sel of ['.ux-top', '.ux-acts', '.ux-live', '.ux-brand']) assert.ok(!/overflow:\s*hidden/.test(rule(PAGE_CSS, sel)), `${sel} does not clip`)
  // the thresholds were moved, not multiplied
  assert.ok((PAGE_CSS.match(/@container ux \(/g) ?? []).length <= 7, 'at most the seven container queries the page already had')
})

test('the project filter dims by edge and weight, not by opacity (the text keeps its contrast)', () => {
  for (const head of ['.oc-station[data-dim]', '.oc-zone[data-dim]', '.oc-lzone[data-dim]', '.oc-lrow[data-dim]']) {
    for (const m of SCENE_CSS.matchAll(/([^{}\n]+)\{([^{}]*)\}/g)) {
      if (m[1].includes(head) && !/\.oc-face/.test(m[1])) assert.ok(!/opacity/.test(m[2]), `${m[1].trim()} dims with opacity`)
    }
  }
  assert.ok(!/\.ux-pjc\.dim\{[^}]*opacity/.test(PAGE_CSS), 'no opacity on a dimmed project card')
  assert.match(SCENE_CSS, /\.oc-station\[data-dim\][^{]*\.oc-chip\{[^}]*border-style:dashed/)
  assert.match(SCENE_CSS, /\.oc-lrow\[data-dim\][^{]*\.oc-chip\{[^}]*border-style:dashed/)
  assert.ok(has(rule(PAGE_CSS, '.ux-pjc.dim'), 'border-style', 'dashed'))
})
