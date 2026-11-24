import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { splitShares } from '../../src/core/usage.js'
import { messages } from '../../src/i18n/index.js'

// The plugin's windows share ONE frame (DialogKit): header (icon, title, risk, close), body that alone scrolls, foot with
// the actions; Escape and focus are the frame's; the help is behind a « ? », not in paragraphs. This freezes that structure.

const src = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')
const LANGS = ['en', 'fr', 'es']
const WINDOWS = ['HireDialog', 'DecorDialog', 'SeatingDialog', 'UsageDialog']

test('the four windows are built on the shared frame: no bare <dialog>, each reads Escape itself and closes through the frame', () => {
  for (const f of WINDOWS) {
    const s = src(`ui/${f}.jsx`)
    assert.match(s, /import \{[^}]*\bDlg\b[^}]*\} from '\.\/DialogKit\.jsx'/, `${f} uses the frame`)
    assert.doesNotMatch(s, /<dialog\b/, `${f} has no frame of its own`)
    assert.match(s, /import \{ escapeCloses \} from '\.\/dialogKeys\.js'/, f)
    assert.match(s, /onKeyDown=\{e => \{ if \(escapeCloses\(e\)\)/, `${f} reads Escape itself`)
  }
})

test('the frame: a modal <dialog>, header / body / foot, a labelled close button, a full sheet under 560 px, no animation in reduced motion', () => {
  const kit = src('ui/DialogKit.jsx')
  assert.match(kit, /<dialog\b/)
  assert.match(kit, /showModal\(\)/, 'modal: focus trapped, page inert')
  assert.match(kit, /aria-labelledby=\{`\$\{id\}-t`\}/, 'named by its title')
  assert.match(kit, /<header className="oc-dg-h">/)
  assert.match(kit, /className="oc-dg-b"/)
  assert.match(kit, /<footer className="oc-dg-f">/)
  assert.match(kit, /aria-label=\{t\('dlg\.close'\)\}/)
  // a click on the backdrop closes only a read-only window (a form could lose its text to a drag that ends outside)
  assert.match(kit, /backdrop \? e =>/)
  assert.match(src('ui/UsageDialog.jsx'), /\bbackdrop\b/)
  for (const f of ['HireDialog', 'DecorDialog', 'SeatingDialog']) assert.doesNotMatch(src(`ui/${f}.jsx`), /\bbackdrop\b/, `${f} keeps its form on a stray click`)
  const css = src('ui/dialogStyles.js')
  assert.match(css, /@media \(max-width:560px\)/)
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /data-motion="reduced"/)
  assert.match(css, /\.oc-dg-b\{[^}]*overflow-y:auto/, 'the body alone scrolls')
})

test('theme variables only: no colour literal in the frame, its styles or the Resources styles', () => {
  for (const f of ['ui/DialogKit.jsx', 'ui/dialogStyles.js', 'ui/usageStyles.js', 'ui/UsageDialog.jsx']) {
    assert.doesNotMatch(src(f), /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, f)
  }
})

test('the 4 px grid: paddings, gaps, margins and control heights of the frame are multiples of 4 (hairlines and 2 px insets excepted)', () => {
  const css = src('ui/dialogStyles.js')
  const bad = []
  for (const m of css.matchAll(/(?:^|[;{])(padding|gap|margin|min-height|height|width)(?:-[a-z]+)?:([^;}]+)/g)) {
    const value = m[2].replace(/(?:calc|min|max|minmax)\([^)]*\)/g, '').replace(/\$\{[^}]*\}/g, '')
    for (const px of value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
      const n = Math.abs(Number(px[1]))
      if (n > 2 && n % 4 !== 0) bad.push(`${m[1]}:${m[2].trim()}`)
    }
  }
  assert.deepEqual([...new Set(bad)], [])
})

test('a few words: the explanation of a field sits behind a « ? », except the description, whose purpose is said in clear (the kanban routes cards on it)', () => {
  for (const lang of LANGS) {
    const r = messages[lang].recruit
    for (const k of ['titlePh', 'namePh']) assert.ok(r[k].length <= 40, `${lang} recruit.${k}`)
    assert.ok(r.descriptionPh.length <= 100, `${lang} an example, not a paragraph`)
    assert.ok(r.descriptionHelp.length > r.descriptionPh.length / 2 && r.descriptionHelp.length <= 140, `${lang} the visible help of the description`)
    assert.ok(r.free.length <= 10, lang)
    for (const k of ['step1', 'step2', 'step3']) assert.ok(r[k].length <= 40, `${lang} recruit.${k}`)
    assert.equal(r.descriptionTip, undefined, 'the description says what it is for in clear, no « ? » to open')
    assert.ok(messages[lang].dlg.close.length > 2)
    assert.match(messages[lang].dlg.helpFor('X'), /X/)
  }
  // recruitment: 3 steps, a tip on the identifier, the description and the starting point; the three starting points are one word or two
  const hire = src('ui/HireDialog.jsx')
  assert.equal((hire.match(/<Step n=\{/g) || []).length, 2)
  assert.match(hire, /recruit\.step3/)
  assert.match(hire, /<DlgTip name=\{t\('recruit\.name'\)\}>/)
  assert.doesNotMatch(hire, /<DlgTip name=\{t\('recruit\.description'\)\}>/, 'the purpose of the description is written under its label')
  assert.doesNotMatch(hire, /<DlgTip name=\{t\('recruit\.submit'\)\}>/, 'the risk of « Recruit » is written next to the button, not behind a « ? »')
  assert.doesNotMatch(hire, /<fieldset|<legend/, 'no box of boxes')
})

test('recruitment keeps its contract: names the bot in the action, the model step is folded unless set, errors in an alert, the requests on demand', () => {
  const hire = src('ui/HireDialog.jsx')
  assert.match(hire, /recruit\.submitNamed/)
  assert.match(hire, /open=\{modelSet\}/)
  assert.match(hire, /role="alert" data-hire-errors/)
  assert.match(hire, /reqOpen \? <pre/)
  assert.match(hire, /aria-expanded=\{reqOpen\}/)
  // a window with an order in flight closes; Escape on the confirmation steps back instead of closing
  assert.match(hire, /if \(confirming\) orders\.act\('cancel'\); else close\(\)/)
  assert.match(hire, /data-hire-ok/)
  assert.match(hire, /data-hire-preview/)
})

test('the skills box of recruitment ends inside a row: the next row peeks out, so a longer list reads as scrollable', () => {
  // the box scrolls (a bot may have 30 skills); cut exactly between two rows, half the list was hidden without any sign (14 listed, 7 seen)
  const css = src('ui/dialogStyles.js')
  const box = Number(/\.oc-dg-skills\{max-height:(\d+)px;overflow-y:auto/.exec(css)?.[1])
  const pill = Number(/\.oc-dg-pill\{[^}]*min-height:(\d+)px/.exec(css)?.[1])
  const gap = Number(/\.oc-dg-chips\{[^}]*gap:(\d+)px/.exec(css)?.[1])
  assert.ok(box > 0 && pill > 0 && gap > 0, 'box, pill and gap found')
  const pitch = pill + gap
  const into = box % pitch   // how far the box's bottom edge goes into the row it cuts
  assert.ok(into >= 8 && into <= pill - 8, `the box shows ${into}px of the next row (pitch ${pitch}px): neither none nor almost all`)
})

test('the « ? »: a real button next to a real note, Escape closes the note alone', () => {
  const kit = src('ui/DialogKit.jsx')
  assert.match(kit, /aria-expanded=\{open\}/)
  assert.match(kit, /role="note"/)
  assert.match(kit, /e\.stopPropagation\(\)/)
  assert.match(kit, /aria-label=\{t\('dlg\.helpFor', name\)\}/)
})

test('Resources: the split of the tokens is a ring from recorded parts only; a part not recorded is absent, never 0 %', () => {
  assert.deepEqual(splitShares(null), [])
  assert.deepEqual(splitShares({ input: null, output: null, cache: null }), [])
  assert.deepEqual(splitShares({ input: 0, output: 0, cache: 0 }), [])
  const s = splitShares({ input: 200, output: 800, cache: null })
  assert.deepEqual(s.map(x => [x.key, x.pct]), [['in', 20], ['out', 80]], 'input then output, no cache row')
  assert.equal(s.reduce((n, x) => n + x.share, 0), 1)
  // a part recorded as 0 is absent from the ring and its legend, never « 0 % »
  assert.deepEqual(splitShares({ input: 0, output: 5, cache: null }).map(x => [x.key, x.pct]), [['out', 100]])
  assert.deepEqual(splitShares({ input: 3, output: 1, cache: 0 }).map(x => x.key), ['in', 'out'])
  const all = splitShares({ input: 1, output: 1, cache: 2 })
  assert.deepEqual(all.map(x => x.key), ['in', 'out', 'cache'])
  assert.deepEqual(all.map(x => x.pct), [25, 25, 50])
  const ui = src('ui/UsageDialog.jsx')
  assert.match(ui, /splitShares\(parts\)/)
  assert.match(ui, /oc-us-ring/, 'the quota windows are rings, still announced as images with their percentage')
  assert.match(ui, /role="img" aria-label=\{t\('usage\.quota\.gauge'/)
  // paragraphs of notes are behind « ? » and the sources are folded
  assert.match(ui, /<DlgTip name=\{t\('usage\.models\.title'\)\}>\{t\('usage\.models\.note'\)\}/)
  assert.match(ui, /<details className="oc-us-src"/)
})

test('Resources and replay: read-only, nothing animated but the frame (which has its own reduced-motion rule)', () => {
  assert.doesNotMatch(src('ui/UsageDialog.jsx'), /useOrders|requestRecruit|method:\s*'POST'/)
  assert.match(src('ui/UsageDialog.jsx'), /\bstill\b/, 'the Resources window opens without an animation')
  assert.match(src('ui/dialogStyles.js'), /\.oc-dg\[data-still\]\[open\]/)
  for (const f of ['ui/ReplayBar.jsx', 'ui/ReplayPanel.jsx']) assert.match(src(f), /DlgTip/, `${f}: the long note is a « ? »`)
  assert.doesNotMatch(src('ui/ReplayBar.jsx'), /oc-rp-help">\{t\(/, 'no loose paragraph of keyboard help under the cursor')
})

test('Decorator and Seating keep their rules: the call is a button, never an effect; the choice is a pressed-button group', () => {
  const seat = src('ui/SeatingDialog.jsx')
  assert.match(seat, /data-seat-choice|attr="data-seat-choice"/)
  assert.match(seat, /<Seg /)
  assert.match(seat, /\['model', t\('llm\.seating\.useModel'\), !kept\]/, 'the model order is chosen only once one is kept')
  const kit = src('ui/DialogKit.jsx')
  assert.match(kit, /aria-pressed=\{value === code\}/)
  const decor = src('ui/DecorDialog.jsx')
  assert.match(decor, /oc-dg-busy/)
  assert.match(decor, /Notice tone="bad"[^>]*data-decor-failure/)
})
