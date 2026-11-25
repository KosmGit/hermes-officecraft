/* Under a finger (pointer: coarse) every target is 40 px at least with 8 px between two of them, and nothing changes under a mouse; at 380 px the
   settings tabs fit the strip, the decisions panel has no second frame and the sort shares a line, the working count is on the bar.
   The rules are read in the style modules that ship (no browser): the measures on the real page are in the card's report. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { DIALOG_CSS } from '../../src/ui/dialogStyles.js'
import { PAGE_CSS } from '../../src/ui/pageStyles.js'
import { PANEL_CSS } from '../../src/ui/panelStyles.js'
import { SETTINGS_CSS } from '../../src/ui/settingsStyles.js'

const src = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the first `@media (pointer:coarse){…}` block of a sheet (braces balanced), and where it starts. */
function coarse(css) {
  const clean = strip(css)
  const at = clean.indexOf('@media (pointer:coarse){')
  assert.ok(at >= 0, 'a pointer:coarse block')
  let depth = 0
  for (let i = at + '@media (pointer:coarse)'.length; i < clean.length; i++) {
    if (clean[i] === '{') depth++
    else if (clean[i] === '}' && --depth === 0) return { body: clean.slice(at + '@media (pointer:coarse){'.length, i), at, clean }
  }
  throw new Error('unbalanced block')
}
/** The declarations of a selector in a piece of CSS (all the rules that name it, in order; the last value of a property wins). */
function decls(css, selector) {
  const out = {}
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map(s => s.trim()).includes(selector)) continue
    for (const d of m[2].split(';')) { const [k, ...v] = d.split(':'); if (v.length) out[k.trim()] = v.join(':').trim() }
  }
  return out
}

test('the page: buttons, pills, tabs, segments, links at 40 px; the menu rows at 44; the small « ? » and « open » icon reach 40 by a ::after', () => {
  const { body, at, clean } = coarse(PAGE_CSS)
  for (const sel of ['.ux-b', '.ux-b.sm']) assert.equal(decls(body, sel).height, '40px', sel)
  assert.equal(decls(body, '.ux-b')['min-width'], '40px')
  for (const sel of ['.ux-b.ico', '.ux-b.sm.ico']) assert.equal(decls(body, sel).width, '40px', sel)
  for (const sel of ['.ux-lvp', '.ux-al', '.ux-game', '.ux-pj', '.ux-prjx']) assert.equal(decls(body, sel).height, '40px', sel)
  assert.equal(decls(body, '.ux-tab').height, '44px')
  assert.equal(decls(body, '.ux-seg button').height, '40px')
  assert.equal(decls(body, '.ux-lnk')['min-height'], '40px')
  assert.equal(decls(body, '.ux-pop.menu button').height, '44px', 'the rows of the « More » menu')
  assert.equal(decls(body, '.ux-roster').gap, '8px')
  assert.equal(decls(body, '.ux-acts').gap, '8px')
  // the « ? » (24 px) and the « open » icon (28 px): same look, a bigger hit area, 8 px and 6 px beyond
  assert.equal(decls(body, '.ux-help::after').inset, '-8px')
  assert.equal(decls(body, '.ux-b.sm.ico.ghost.op::after').inset, '-6px')
  assert.equal(decls(body, '.ux-b.sm.ico.ghost.op').width, '28px', 'the open icon keeps its look: only its hit area grows')
  // it comes after the container rules it must win over (a narrow pane sets 28 px for the dock's chips)
  assert.ok(at > clean.indexOf('@container ux (max-width: 700px)'), 'the coarse block follows the narrow-pane rules')
  assert.ok(at > clean.indexOf('@container ux (max-width: 1320px)'))
  // nothing changes under a mouse: the base sizes are the ones they were
  const base = clean.replace(body, '')
  assert.equal(decls(base, '.ux-b').height, '32px')
  assert.equal(decls(base, '.ux-b.sm').height, '28px')
  assert.equal(decls(base, '.ux-pop.menu button').height, '36px')
  assert.equal(decls(base, '.ux-help').width, '24px')
})

test('the settings: the switch is 48 x 28 (48 x 40 to the finger), segments, buttons, fields, tabs and « ? » at 40, 16 px around a « ? »', () => {
  const { body, clean } = coarse(SETTINGS_CSS)
  assert.equal(decls(body, '.oc-sx-sw').width, '48px')
  assert.equal(decls(body, '.oc-sx-sw').height, '28px')
  assert.equal(decls(body, '.oc-sx-sw::before').top, '-6px', 'the hit area of the switch reaches 40 px in height')
  assert.equal(decls(body, '.oc-sx-sw::before').bottom, '-6px')
  assert.equal(decls(body, '.oc-sx-sw:checked::after').transform, 'translateX(20px)', 'the knob travels the longer track')
  assert.equal(decls(body, '.oc-sx-seg span').height, '40px')
  assert.equal(decls(body, '.oc-sx-btn')['min-height'], '40px')
  assert.equal(decls(body, '.oc-sf-tab').height, '40px')
  assert.equal(decls(body, '.oc-sd-x').width, '40px')
  assert.equal(decls(body, '.oc-sx-help::after').inset, '-8px')
  assert.equal(decls(body, '.oc-sx-ctl').gap, '16px', 'two targets 8 px apart: the « ? » reaches 8 px beyond itself')
  assert.match(decls(body, '.oc-fc').height, /^40px/, 'the selects (their height is inline: !important)')
  const base = clean.replace(body, '')
  assert.equal(decls(base, '.oc-sx-sw').width, '40px')
  assert.equal(decls(base, '.oc-sx-sw').height, '24px')
  assert.equal(decls(base, '.oc-sx-seg span').height, '28px')
})

test('the gear, the legend « ? », the dialogs: the same rule, in their own sheets', () => {
  const p = coarse(PANEL_CSS).body
  assert.equal(decls(p, '.oc-gear').width, '40px')
  assert.equal(decls(p, '.oc-gear').height, '40px')
  assert.equal(decls(p, '.oc-legend-btn::after').inset, '-8px')
  const d = coarse(DIALOG_CSS).body
  assert.equal(decls(d, '.oc-dg-x').height, '40px')
  assert.equal(decls(d, '.oc-dg-help::after').inset, '-8px')
  assert.equal(decls(d, '.oc-dg-seg button')?.height, '40px')
  assert.equal(decls(d, '.oc-dg .oc-btn')['min-height'], '40px')
  assert.equal(decls(strip(PANEL_CSS).replace(p, ''), '.oc-gear').width, '28px', 'a mouse keeps the 28 px gear')
})

test('at 380 px the three settings tabs share the strip (no icon, no tab pushed out), and the window keeps ONE size whatever the tab', () => {
  const css = strip(SETTINGS_CSS)
  const block = css.slice(css.indexOf('@container (max-width:420px){'))
  assert.match(block.slice(0, block.indexOf('@container (max-width:340px)')), /\.oc-sf-tab svg\{display:none\}/)
  assert.match(block, /\.oc-sf-tab\{flex:1 1 auto;justify-content:center\}/)
  assert.doesNotMatch(css, /:has\(\[data-llm\]\)/, 'no rule resizes the window for one tab')
  assert.match(css, /\.oc-sd\{[^}]*width:min\(860px,calc\(100vw - 16px\)\)/)
  assert.match(css, /\.oc-sd \.oc-sf-in\{[^}]*height:min\(600px,calc\(100dvh - 160px\)\)/)
})

test('a narrow pane: the decisions panel has no second frame, the sort shares the first project\'s line, « Cancel » is short under 1320 px', () => {
  const css = strip(PAGE_CSS)
  const narrow = css.slice(css.indexOf('@container ux (max-width: 700px){'), css.indexOf('@container ux (max-width: 420px)'))
  assert.match(narrow, /\.ux-panel\{border:0;border-radius:0;background:transparent\}/)
  assert.match(narrow, /\.ux-pbody\{padding:0 0 12px;/)
  assert.match(narrow, /\[data-inbox\]\{display:flex;flex-wrap:wrap;/)
  assert.match(narrow, /\[data-inbox\] > \.ux-pbar:not\(\.flt\) \+ div\{display:contents\}/, 'the first group sits in the same flex line as the sort')
  assert.match(narrow, /\.ux-pbar:not\(\.flt\) \+ div > \.ux-grp\{order:0;flex:1 1 120px;/, 'and wraps below it when there is no room for both')
  assert.match(narrow, /\.ux-seg \.short\{display:inline\}/, 'the sort says « Project / Oldest » there')
  const tail = css.slice(css.indexOf('@container ux (max-width: 1320px){'), css.indexOf('@container ux (max-width: 1180px)'))
  assert.match(tail, /\.ux-dc-o \.ux-b\.cx \.short\{display:inline\}/, 'the 1024 px panel (328 px) gets « Cancel »')
  const tab = src('ui/DecisionsTab.jsx')
  assert.match(tab, /aria-label=\{t\('ux\.dec\.byProject'\)\}/, 'the short word never replaces the accessible name')
})

test('the count of agents at work sits on the « Office » entry of the bottom bar, like the decisions on theirs', () => {
  const bar = src('ui/TabBar.jsx')
  assert.match(bar, /k === 'office' && working > 0/)
  assert.match(bar, /data-working-count/)
  assert.match(bar, /t\('ux\.pill\.workingLabel', working\)/, 'a screen reader hears « n at work », not a bare number')
  assert.match(src('ui/OfficePage.jsx'), /<TabBar [^>]*working=\{counts\.working\}/)
  assert.match(strip(PAGE_CSS), /\.ux-bar \.ux-n\.work\{background:/)
})
