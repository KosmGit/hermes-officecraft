import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

import { foldCards } from '../../src/core/campaignLayout.js'
import { en } from '../../src/i18n/en.js'
import { es } from '../../src/i18n/es.js'
import { fr } from '../../src/i18n/fr.js'
import { held, hold } from '../../src/ui/hold.js'
import { focusBackTarget, moreMenuTarget } from '../../src/ui/targets.js'

// Keyboard and screen reader: where the focus goes, what is announced, what a name is made of. The pure parts are tested by value;
// the markup is read from the source (the patterns that, once gone, bring the defect back).
const src = f => readFileSync(new URL(`../../src/ui/${f}`, import.meta.url), 'utf8')
const UI = readdirSync(new URL('../../src/ui/', import.meta.url)).filter(f => f.endsWith('.jsx') || f.endsWith('.js'))

/** The JSX opening tags of a file, joined on one line (an attribute may sit on the next line). */
const tagsOf = text => [...text.matchAll(/<[A-Za-z][\w.]*\b(?:[^<>]|=>|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*?>/gs)].map(m => m[0].replace(/\s+/g, ' '))
const labelBlocks = text => [...text.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g)].map(m => m[0])

/* ---------- 1 · windows opened from the « More » menu ---------- */

test('focusBackTarget: the opener when it is on screen, else the next one that is, else nothing', () => {
  const a = { id: 'opener' }
  const more = { id: 'more' }
  assert.equal(focusBackTarget([{ el: a, shown: true }, { el: more, shown: true }]), a)
  assert.equal(focusBackTarget([{ el: a, shown: false }, { el: more, shown: true }]), more, 'a hidden opener (narrow pane) hands over to « More »')
  assert.equal(focusBackTarget([{ el: null, shown: false }, { el: more, shown: true }]), more, 'an opener that is gone (the menu item) too')
  assert.equal(focusBackTarget([{ el: a, shown: false }]), null)
})

test('the windows give the focus back through one helper that falls back on the « More » button', () => {
  const page = src('OfficePage.jsx')
  assert.match(page, /focusBackTarget\(\[\.\.\.selectors\.map\(at\), at\('\[data-more-toggle\]'\)\]\)/)
  for (const [close, opener] of [['closeUsage', 'data-usage-open'], ['closeHire', 'data-recruit-open'], ['closeCampaign', 'data-campaign-open']]) {
    assert.match(page, new RegExp(`const ${close} = useCallback\\(\\(\\) => \\{[^}]*giveFocusBack\\('\\[${opener}\\]'\\)`), `${close} hands the focus to ${opener}, else « More »`)
  }
  assert.match(page, /giveFocusBack\('\[data-replay-open\]'\)/, 'leaving the replay too')
  assert.doesNotMatch(page, /usageBtnRef\.current\?\.focus\(\)/, 'the hidden button of a narrow pane takes no focus')
  assert.match(src('PageHeader.jsx'), /data-more-toggle/)
})

/* ---------- 2 · Decorator and Seating opened from the settings ---------- */

test('the Decorator and the Seating opened from the settings give the focus back to the gear, not to a button that was unmounted', () => {
  const page = src('OfficePage.jsx')
  assert.match(page, /const closeDecor = useCallback\(\(\) => \{ setDecorOpen\(false\); giveFocusBack\(decorFrom\.current\) \}/)
  assert.match(page, /const closeSeat = useCallback\(\(\) => \{ setSeatOpen\(false\); giveFocusBack\('\[data-gear\]'\) \}/)
  assert.match(page, /onDecorate: decorReady \? \(\) => \{ decorFrom\.current = '\[data-gear\]'; setDecorOpen\(true\) \}/)
  assert.match(page, /decorFrom\.current = '\[data-decor-open\]'; setDecorOpen\(true\)/, 'from the header it is the header button')
})

/* ---------- 3 · campaign, a step changes ---------- */

test('campaign: the title of the new step takes the focus (tabIndex -1), once, only when the step really changed', () => {
  const dlg = src('CampaignDialog.jsx')
  assert.match(dlg, /<span className="tl" ref=\{j === at \? titleRef : undefined\} tabIndex=\{j === at \? -1 : undefined\}/)
  assert.match(dlg, /<Stepper step=\{step\} t=\{t\} titleRef=\{stepTitle\} \/>/)
  const effect = dlg.slice(dlg.indexOf('const lastStep = useRef(win.step)'), dlg.indexOf('const created = win.created'))
  assert.match(effect, /if \(lastStep\.current === win\.step\) return/, 'no focus move on mount or on a re-render of the same step')
  assert.match(effect, /if \(open\) stepTitle\.current\?\.focus\(\)/)
  assert.match(effect, /\[win\.step, open\]/)
  assert.doesNotMatch(dlg, /<span className="n">[^\n]*<\/span>\{l\}/, 'the title is its own element (the focused text is the title alone)')
})

/* ---------- 4 · controls that were `disabled` during a save or a call ---------- */

test('hold / held: a held control keeps its place, says so, and its handler does nothing', () => {
  let n = 0
  const run = () => { n += 1; return 'ran' }
  assert.equal(hold(false, run)(), 'ran')
  assert.equal(hold(true, run)(), undefined, 'a second gesture while a call is out is dropped: nothing can be sent twice')
  assert.equal(n, 1)
  assert.equal(hold(true, run)('a', 'b'), undefined)
  assert.deepEqual(held(false), {})
  assert.deepEqual(held(false, { text: true }), {})
  assert.deepEqual(held(true), { 'aria-disabled': true })
  assert.deepEqual(held(true, { text: true }), { 'aria-disabled': true, readOnly: true }, 'a text field keeps its caret and refuses typing')
  assert.equal('disabled' in held(true), false, 'never `disabled`: a disabled control drops the focus')
})

test('the controls of the settings and of the two LLM windows are held, not disabled, while a save or a call is out', () => {
  const files = { 'SettingsFormLlm.jsx': ['saving', 'busy'], 'SettingsFormNotify.jsx': ['saving'], 'DecorDialog.jsx': ['pending', 'blocked'], 'SeatingDialog.jsx': ['pending', 'blocked'] }
  for (const [f, flags] of Object.entries(files)) {
    const text = src(f).replace(/<Seg [^\n]*\/>/g, '')   // <Seg disabled> is a prop of the shared choice, which holds (DialogKit), it is no DOM attribute
    assert.match(text, /import \{ held, hold \} from '\.\/hold\.js'/, f)
    for (const flag of flags) assert.doesNotMatch(text, new RegExp(`(?<!aria-)disabled=\\{[^}]*\\b${flag}\\b`), `${f}: no \`disabled\` on \`${flag}\``)
    assert.match(text, /\{\.\.\.held\(/, f)
    assert.match(text, /hold\(/, f)
  }
  // the shared segmented choice of the windows, and the one save at a time of the two forms
  assert.match(src('DialogKit.jsx'), /\{\.\.\.held\(disabled\)\}[^\n]*onClick=\{hold\(disabled,/)
  for (const f of ['SettingsFormLlm.jsx', 'SettingsFormNotify.jsx']) assert.match(src(f), /const apply = async change => \{\n    if \(saving\) return/, `${f}: a save in flight drops the next gesture`)
  assert.match(src('DecorDialog.jsx'), /data-decor-revert \{\.\.\.held\(pending\)\} onClick=\{hold\(pending, revert\)\}/)
  assert.match(src('SeatingDialog.jsx'), /data-seating-revert \{\.\.\.held\(pending \|\| choice === 'default'\)\}/)
})

test('a held control looks like a disabled one (aria-disabled has its own rules)', async () => {
  const { DIALOG_CSS } = await import('../../src/ui/dialogStyles.js')
  const { SETTINGS_CSS } = await import('../../src/ui/settingsStyles.js')
  for (const sel of ['.oc-dg .oc-btn[aria-disabled="true"]', '.oc-dg-seg button[aria-disabled="true"]', 'button.oc-dg-pill[aria-disabled="true"]', '.oc-dg textarea[aria-disabled="true"]']) assert.ok(DIALOG_CSS.includes(sel), sel)
  for (const sel of ['.oc-sx-sw[aria-disabled="true"]', '.oc-fc[aria-disabled="true"]', '.oc-nt-chip input[aria-disabled="true"]+span']) assert.ok(SETTINGS_CSS.includes(sel), sel)
})

/* ---------- 5 · campaign graph piles ---------- */

const card = (id, p = []) => ({ id, kind: 'card', phase: 0, parents: p, who: 'alpha', title: id })
test('campaign graph: an unfolded pile is no longer a node, so the fold button has to be drawn from the folded view', () => {
  const cards = [{ id: 'G0', kind: 'guard', phase: 0, parents: [] }, ...Array.from({ length: 30 }, (_, i) => card(`c${i}`, ['G0']))]
  const piles = foldCards(cards).filter(c => c.kind === 'group')
  assert.equal(piles.length, 1)
  const open = new Set([piles[0].id])
  assert.equal(foldCards(cards, open).filter(c => c.kind === 'group').length, 0, 'unfolded: the pile and its button are gone')
  assert.deepEqual(foldCards(cards, new Set(), new Set()).filter(c => c.kind === 'group' && open.has(c.id)).map(c => c.id), [piles[0].id], 'the unfolded pile is found again from the folded view')
  assert.equal(piles[0].members[0].id, 'c0')
  // a card that is kept out of piles (the selected one) leaves no pile to fold back
  assert.equal(foldCards(cards, new Set(), new Set(['c3'])).filter(c => c.kind === 'group').length, 0)
})

test('campaign graph: the pile button hands the focus to its first card, an expanded pile has its fold button', () => {
  const g = src('CampaignGraph.jsx')
  assert.match(g, /onClick=\{\(\) => toggle\(c\.id, m\[0\]\.id\)\}/, 'unfolding: the first card of the pile')
  assert.match(g, /data-fold=\{p\.id\} aria-expanded="true" onClick=\{\(\) => toggle\(p\.id, p\.id\)\}/, 'a fold button that says it is expanded; folding: back to the pile')
  assert.match(g, /useLayoutEffect\(\(\) => \{\n    const to = focusNext\.current/)
  assert.match(g, /\{ tabIndex: -1 \}/, 'the cards of a read-only graph can take a programmatic focus')
  assert.match(g, /aria-expanded="false"/, 'a folded pile says so')
  for (const m of [en, fr, es]) assert.equal(typeof m.campaign.groupFold, 'function')
})

/* ---------- 6 · the template choice ---------- */

test('campaign templates: aria-pressed buttons in a group, as everywhere else in the plugin (no radio role without the radio keys)', () => {
  const dlg = src('CampaignDialog.jsx')
  assert.doesNotMatch(dlg, /role="radio"|role="radiogroup"|aria-checked/)
  assert.match(dlg, /<div className="grid" role="group" aria-label=\{t\('campaign\.tpl\.title'\)\}>/)
  assert.match(dlg, /<button key=\{x\.id\} type="button" aria-pressed=\{tpl === x\.id\} className="tc"/)
})

/* ---------- 7 · aria-haspopup ---------- */

test('moreMenuTarget: arrows wrap, Home and End go to the ends, anything else is not ours', () => {
  assert.equal(moreMenuTarget('ArrowDown', -1, 4), 0)
  assert.equal(moreMenuTarget('ArrowDown', 1, 4), 2)
  assert.equal(moreMenuTarget('ArrowDown', 3, 4), 0)
  assert.equal(moreMenuTarget('ArrowUp', 0, 4), 3)
  assert.equal(moreMenuTarget('ArrowUp', -1, 4), 3)
  assert.equal(moreMenuTarget('Home', 2, 4), 0)
  assert.equal(moreMenuTarget('End', 0, 4), 3)
  assert.equal(moreMenuTarget('a', 0, 4), null)
  assert.equal(moreMenuTarget('Tab', 0, 4), null)
  assert.equal(moreMenuTarget('ArrowDown', 0, 0), null)
})

test('the « More » menu is a real menu; the other popovers announce no popup (their card is a group the focus never enters)', () => {
  const head = src('PageHeader.jsx')
  assert.match(head, /aria-haspopup="menu"/)
  assert.match(head, /<PopCard pop=\{pop\} id=\{id\} label=\{label\} className="menu" role="menu" onKeyDown=\{onKeyDown\}>/)
  assert.match(head, /role=\{it\.pressed === undefined \? 'menuitem' : 'menuitemcheckbox'\}/)
  assert.match(head, /moreMenuTarget\(e\.key, at, list\.length\)/)
  assert.match(head, /if \(pop\.open && placed\) entries\(\)\[0\]\?\.focus\(\)/, 'the focus goes into the menu once it is placed')
  assert.doesNotMatch(head, /aria-haspopup="true"/)
  assert.doesNotMatch(src('AlertRail.jsx'), /aria-haspopup/)
  assert.doesNotMatch(src('Popover.jsx'), /aria-haspopup/)
  // a popup that is announced is one the page really opens: a dialog (the showcase, the settings)
  assert.match(head, /data-badge aria-haspopup="dialog"/)
  assert.match(src('SettingsGear.jsx'), /aria-haspopup="dialog"/)
})

/* ---------- 8 · recruitment while another order runs ---------- */

test('recruitment: X, Cancel and Escape always close the window (only « Recruit » waits, and says why)', () => {
  const hire = src('HireDialog.jsx')
  assert.match(hire, /const close = \(\) => onClose\(\)/)
  assert.doesNotMatch(hire, /if \(!busy\) onClose\(\)/)
  assert.match(hire, /const notice = orders\.state\.notice === 'busy' \? t\('orders\.refused\.busy'\) : ''/, 'the reason is still said when the order is refused')
})

/* ---------- 9 · Escape in the legend during a replay ---------- */

test('the legend takes Escape ahead of the page (capture phase, stopped, prevented): the replay stays', () => {
  const legend = src('Legend.jsx')
  assert.match(legend, /document\.addEventListener\('keydown', onKey, true\)/)
  assert.match(legend, /document\.removeEventListener\('keydown', onKey, true\)/)
  assert.match(legend, /e\.preventDefault\(\); e\.stopPropagation\(\); setOpen\(false\)/)
  // the page's own listener stays a bubble listener that leaves a key somebody already used
  const page = src('OfficePage.jsx')
  assert.match(page, /document\.addEventListener\('keydown', onKey\)\n    return \(\) => document\.removeEventListener\('keydown', onKey\)\n  \}, \[replayOn, dialogOpen/)
  assert.match(page, /defaultPrevented: e\.defaultPrevented/)
})

/* ---------- 10 · the focus ring in forced-colors mode ---------- */

test('every focus ring made of a box-shadow keeps a transparent outline (forced-colors drops the shadow, keeps the outline)', async () => {
  const { RING_FOCUS, FIELD_CSS } = await import('../../src/ui/tokens.js')
  assert.match(RING_FOCUS, /outline:2px solid transparent/)
  assert.doesNotMatch(RING_FOCUS, /outline:none/)
  assert.match(FIELD_CSS, /outline:2px solid transparent/)
  const bad = []
  for (const f of UI.filter(f => /Styles\.js$|^tokens\.js$|^Collection\.jsx$/.test(f))) {
    const mod = await import(`../../src/ui/${f.replace(/\.jsx$/, '.jsx')}`).catch(() => null)
    const css = mod ? Object.values(mod).filter(v => typeof v === 'string').join('\n') : src(f)
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:not\(:focus-visible\)/g, '').matchAll(/([^{}]*:focus-visible[^{}]*)\{([^{}]*)\}/g)) {
      const body = m[2]
      if (/box-shadow/.test(body) && !/outline:\s*\d+px solid/.test(body)) bad.push(`${f}: ${m[1].trim().slice(0, 60)}`)
      if (/outline:\s*none/.test(body)) bad.push(`${f}: ${m[1].trim().slice(0, 60)} (outline:none)`)
    }
  }
  assert.deepEqual(bad, [])
})

/* ---------- 11 · the replay is announced once ---------- */

test('replay: the banner is no status region; the cursor says the moment (aria-valuetext); the counts are the one live region that changes', () => {
  const page = src('OfficePage.jsx')
  assert.match(page, /<div className="oc-rp-banner" data-replay-banner>/)
  assert.doesNotMatch(page, /oc-rp-banner" role="status"/)
  const bar = src('ReplayBar.jsx')
  assert.match(bar, /aria-valuetext=\{label\(atMs\)\}/)
  assert.equal((bar.match(/aria-live=/g) || []).length, 1, 'the counts alone')
  assert.match(bar, /<span className="oc-rp-state" aria-live="polite" data-replay-state>/)
})

/* ---------- 12 · field names ---------- */

test('a <label> holds the name alone: never the « ? », its note, a counter or a mark (the first labelable descendant would be that button)', () => {
  const bad = []
  for (const f of ['HireDialog.jsx', 'DecorDialog.jsx', 'SeatingDialog.jsx', 'CampaignDialog.jsx']) {
    for (const block of labelBlocks(src(f))) {
      if (/<DlgTip|<Mark\b|<CardMark|<small\b|<button\b/.test(block) && /className="oc-dg-fl/.test(block)) bad.push(`${f}: ${block.replace(/\s+/g, ' ').slice(0, 90)}`)
    }
  }
  assert.deepEqual(bad.filter(b => !/(^CampaignDialog\.jsx: <label className="oc-dg-fl(?: tgt| nbs)?">|HireDialog\.jsx: <label key=\{s\}>|<label className="oc-dg-pill)/.test(b) && !/<label className="oc-dg-fl"><span className="oc-dg-lab">\{t\('campaign\.(f\.(runtime|workspace)|tpl)/.test(b)), [])
  // the four windows name their fields by htmlFor and describe them by the counter / the mark
  const hire = src('HireDialog.jsx')
  for (const k of ['name', 'title', 'desc']) assert.match(hire, new RegExp(`<label htmlFor=\\{\`\\$\\{id\\}-${k}\`\\}>`), `hire ${k}`)
  assert.match(hire, /aria-describedby=\{`\$\{id\}-err \$\{id\}-free \$\{id\}-name-mk`\}/)
  assert.match(src('DecorDialog.jsx'), /<label htmlFor=\{`\$\{id\}-style`\}>[\s\S]*<small id=\{`\$\{id\}-n`\}>[\s\S]*aria-describedby=\{`\$\{id\}-n \$\{id\}-sent`\}/)
  assert.match(src('SeatingDialog.jsx'), /<label htmlFor=\{`\$\{id\}-instr`\}>[\s\S]*<small id=\{`\$\{id\}-n`\}>[\s\S]*aria-describedby=\{`\$\{id\}-n \$\{id\}-sent`\}/)
  const cg = src('CampaignDialog.jsx')
  for (const k of ['title', 'bot', 'body']) assert.match(cg, new RegExp(`<label htmlFor=\\{\`\\$\\{id\\}-${k}\`\\}>`), `campaign ${k}`)
  for (const k of ['goal', 'nbname']) assert.match(cg, new RegExp(`<label htmlFor=\\{\`\\$\\{uid\\}-${k}\`\\}>`), `campaign ${k}`)
  assert.match(cg, /aria-describedby=\{`\$\{id\}-body-n \$\{id\}-body-mk`\}/)
  // the marks can be referenced
  assert.match(src('HireAssist.jsx'), /<button type="button" id=\{id\} className="oc-lm-mk"/)
  assert.match(src('CampaignAssist.jsx'), /<button type="button" id=\{id\} className="oc-lm-mk"/)
})

test('no <label> of the four windows, their assisted panels included, wraps a counter, a note, a mark or a button', () => {
  const bad = []
  for (const f of ['HireDialog.jsx', 'DecorDialog.jsx', 'SeatingDialog.jsx', 'CampaignDialog.jsx', 'HireAssist.jsx', 'CampaignAssist.jsx']) {
    for (const block of labelBlocks(src(f))) {
      if (/<DlgTip|<Mark\b|<CardMark|<small\b|<button\b|oc-lm-count|oc-lm-mk/.test(block)) bad.push(`${f}: ${block.replace(/\s+/g, ' ').slice(0, 90)}`)
    }
  }
  assert.deepEqual(bad, [])
  assert.match(src('HireAssist.jsx'), /<label htmlFor=\{`\$\{fid\}-soul`\}>/)
  assert.match(src('CampaignAssist.jsx'), /<label htmlFor=\{`\$\{fid\}-notes`\}>[\s\S]*aria-describedby=\{`\$\{fid\}-notes-n`\}/)
  assert.match(src('CampaignAssist.jsx'), /<label htmlFor=\{`\$\{fid\}-after`\}>/)
})

test('the « ? » stays in a positioned wrapper, so its note opens under its button', async () => {
  const { DIALOG_CSS } = await import('../../src/ui/dialogStyles.js')
  assert.match(DIALOG_CSS, /\.oc-dg-tipw\{position:relative;/)
  assert.match(src('DialogKit.jsx'), /<span ref=\{wrap\} className="oc-dg-tipw" onKeyDown=\{onKeyDown\}>/)
})

/* ---------- 13 · an agent's state is said once ---------- */

test('agent state: the header pills are no live region; the dock\'s announcement (it names the agent) is the one', () => {
  assert.doesNotMatch(src('PageHeader.jsx'), /aria-live/)
  assert.match(src('PageHeader.jsx'), /<div className="ux-live" role="group" aria-label=\{t\('ux\.pill\.label'\)\}>/)
  assert.match(src('ProjectDock.jsx'), /<span className="oc-announce" data-announce aria-live="polite">\{announce\}<\/span>/)
})

/* ---------- 14 · buttons named by `title` alone ---------- */

test('icon buttons carry an aria-label from useT(); their title is a different, longer tip', () => {
  const gear = src('SettingsGear.jsx')
  assert.match(gear, /title=\{t\('settings\.gearTip'\)\} aria-label=\{t\('settings\.gear'\)\}/)
  const head = src('PageHeader.jsx')
  assert.match(head, /data-campaign-open title=\{t\('campaign\.openTip'\)\} aria-label=\{t\('campaign\.open'\)\}/)
  assert.match(head, /data-panel-toggle[^>]*title=\{panel\.open \? t\('panel\.hideTip'\) : t\('panel\.showTip'\)\} aria-label=\{panel\.open \? t\('panel\.hide'\) : t\('panel\.show'\)\}/)
  for (const m of [en, fr, es]) { assert.ok(m.settings.gearTip && m.panel.showTip && m.panel.hideTip); assert.notEqual(m.settings.gearTip, m.settings.gear); assert.notEqual(m.panel.showTip, m.panel.show) }
  // every icon-only button of src/ui is named (nothing is left to a title)
  const bare = []
  for (const f of UI.filter(f => f.endsWith('.jsx'))) {
    for (const tag of tagsOf(src(f)).filter(t => /^<button\b/.test(t))) {
      if (/class(?:Name)?=(?:\{`|\{'|")[^"'`]*\bico\b/.test(tag) && !/aria-label=|aria-labelledby=/.test(tag)) bare.push(`${f}: ${tag.slice(0, 90)}`)
    }
  }
  assert.deepEqual(bare, [])
})

/* ---------- 15 · the thought of an agent ---------- */

test('an agent\'s thought is hidden text reached by aria-describedby, not aria-description (ARIA 1.3); no command in a name or a description', () => {
  for (const f of UI.filter(f => f.endsWith('.jsx'))) assert.doesNotMatch(src(f), /aria-description=/, f)
  const scene = src('OfficeScene.jsx')
  assert.match(scene, /aria-describedby=\{thought \? `\$\{thoughtId\}-\$\{i\}` : undefined\}/)
  assert.match(scene, /<span className="ux-vh" id=\{`\$\{thoughtId\}-\$\{i\}`\} data-thought-text>\{t\('llm\.thoughts\.say', thought\)\}<\/span>/)
  // the approvals rule stays: the command is never in a name or a description
  const approvals = src('Approvals.jsx')
  assert.doesNotMatch(approvals, /aria-label=\{[^}]*(command|cmd)/i)
  assert.doesNotMatch(approvals, /aria-describedby=\{[^}]*(command|cmd)/i)
})

/* ---------- 16 · the language of the settings form, « Loading » ---------- */

test('the settings form says its own language, and « Loading » is a status', () => {
  assert.match(src('SettingsForm.jsx'), /<div className="oc-sf" data-settings-form data-motion=\{motion\} lang=\{t\.lang\}>/)
  assert.match(src('OfficePage.jsx'), /body = <div style=\{s\.muted\} role="status">\{t\('loading'\)\}<\/div>/)
})

/* ---------- 17 · a name that follows the state ---------- */

test('the test button of the notifications is named by its state, like its visible text', () => {
  const form = src('SettingsFormNotify.jsx')
  assert.match(form, /aria-label=\{t\(view\.busy \? 'notify\.testingFor' : 'notify\.testFor', whoOf\(t, target\)\)\}/)
  assert.match(form, /\{view\.busy \? t\('notify\.testing'\) : t\('notify\.test'\)\}/)
  for (const [lang, m] of Object.entries({ en, fr, es })) {
    assert.match(m.notify.testingFor('alpha'), /alpha/, lang)
    assert.notEqual(m.notify.testingFor('alpha'), m.notify.testFor('alpha'), lang)
  }
})
