import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { messages } from '../../src/i18n/index.js'
import { translate } from '../../src/core/translate.js'
import { REASONS, answerOfError } from '../../src/core/llm.js'

// ===== llm-dialogs =====
{
// The LLM functions in use: the defects found, each test red without its fix.
const src = name => readFileSync(new URL(`../../src/${name}`, import.meta.url), 'utf8')

test('« Keep them » on the replace confirmation puts the proposal back to « append » (it left the mode on « replace »: the next click on Apply asked the same question again)', () => {
  const jsx = src('ui/CampaignAssist.jsx')
  const no = jsx.match(/<button[^>]*data-lm-confirm-no[^>]*onClick=\{\(\) => c\.setMode\('(\w+)'\)\}[^>]*>\{t\('llm\.cg\.confirmKeep'\)\}/)
  assert.ok(no, 'the « keep » button of the confirmation exists and sets a mode')
  assert.equal(no[1], 'append', 'keeping the cards = adding after them, never replacing')
  const yes = jsx.match(/<button[^>]*data-lm-confirm-yes[^>]*onClick=\{c\.apply\}[^>]*>\{t\('llm\.cg\.confirmGo'\)\}/)
  assert.ok(yes, 'the « replace » button of the confirmation still applies')
})

test('the « cap reached » refusal of the recruit / revise / campaign windows says where to raise the cap (it only said « nothing was sent »; the campaign panel added a bare word « Réglages » with no way)', () => {
  for (const lang of ['en', 'fr', 'es']) {
    const ref = messages[lang].llm.ref
    const where = String(ref.capCalls(1, 2)).split('→')[1]?.trim().replace(/\.$/, '')
    assert.ok(where && where.length > 3, `${lang}: the settings tab name read from the existing cap sentence`)
    assert.ok(ref.cap_reached.includes(where), `${lang}: cap_reached names « ${where} »: ${ref.cap_reached}`)
  }
})

test('the sentence of a proposed graph is right for one card, one phase, one bot (« 2 cartes · 1 phases · 2 bots », « 1 bots »)', () => {
  const one = { en: [/\b1 card\b(?!s)/, /\b1 phase\b(?!s)/, /\b1 bot\b(?!s)/], fr: [/\b1 carte\b(?!s)/, /\b1 phase\b(?!s)/, /\b1 bot\b(?!s)/], es: [/\b1 tarjeta\b(?!s)/, /\b1 fase\b(?!s)/, /\b1 bot\b(?!s)/] }
  for (const lang of ['en', 'fr', 'es']) {
    const cg = messages[lang].llm.cg
    const s = String(cg.readySum(1, 1))
    assert.match(s, one[lang][0], `${lang}: ${s}`)
    assert.match(s, one[lang][1], `${lang}: ${s}`)
    assert.match(String(cg.readyBots(1)), one[lang][2], `${lang}: ${cg.readyBots(1)}`)
    assert.match(String(cg.readySum(7, 3)), /7 \D+ · 3 \D+/, `${lang}: plural kept for several`)
    assert.match(String(cg.readyBots(6)), /6 bots/, `${lang}: ${cg.readyBots(6)}`)
  }
})

test('the buttons and notes of the graph proposal are right for ONE card (« Ajouter 1 cartes », « Add 1 cards », « Vos 1 cartes actuelles restent »)', () => {
  const bad = { en: /\b1 (current )?cards\b/, fr: /\b1 (actuelles )?cartes\b/, es: /\b1 (actuales )?tarjetas\b/ }
  for (const lang of ['en', 'fr', 'es']) {
    const cg = messages[lang].llm.cg
    for (const s of [cg.keepNote(1), cg.dropNote(1), cg.applyAppend(1), cg.applyReplace(1, 1), cg.applyEmpty(1), cg.confirmAsk(1)]) assert.doesNotMatch(String(s), bad[lang], `${lang}: ${s}`)
    for (const s of [cg.keepNote(5), cg.dropNote(5), cg.applyAppend(5), cg.applyReplace(5, 3), cg.applyEmpty(5), cg.confirmAsk(5)]) assert.match(String(s), /5/, `${lang}: ${s}`)
    assert.match(String(cg.applyReplace(5, 3)), /5 \D+ \D+ 3/, `${lang}: several stays plural`)
  }
})
}

// ===== llm-dialogs =====
{
// The look of the LLM functions: the fixes, each test red without it.
const src = name => readFileSync(new URL(`../../src/${name}`, import.meta.url), 'utf8')
const STYLES = ['ui/tokens.js', 'ui/dialogStyles.js', 'ui/campaignStyles.js', 'ui/settingsStyles.js']

test('what a model wrote has its own hue, never the accent (the host has no --ui-violet: marks, dashed fields and panels were the blue of focus, selection and the main button)', () => {
  for (const f of STYLES) {
    const css = src(f)
    assert.doesNotMatch(css, /var\(--ui-violet, var\(--ui-accent\)\)/, `${f}: violet falling straight back on the accent`)
    assert.ok(css.includes('var(--ui-violet, color-mix(in oklab, color-mix(in oklch, var(--ui-purple, var(--ui-accent)), color-mix(in oklch, var(--ui-blue, var(--ui-accent)) 81%, var(--ui-red, var(--ui-accent)))) 88%, var(--foreground)))'), `${f}: the host's purple, deepened toward the text colour, before the accent`)
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /VIOLET[^\n]*#[0-9a-f]{3,8}\b/i, `${f}: no literal colour (repository rule 4)`)
  }
})

test('the wait shows it is alive: the seconds are bold and in the model hue, the bar slides by transform and never rests at « 40 % »', () => {
  const css = src('ui/dialogStyles.js')
  assert.match(css, /\.oc-lm-el\{font-weight:700;color:\$\{VIOLET_INK\};font-variant-numeric:tabular-nums\}/)
  assert.match(src('ui/HireAssist.jsx'), /<span className="oc-lm-el" aria-hidden="true">\{formatWait\(/)
  assert.match(src('ui/CampaignAssist.jsx'), /className="oc-mono oc-lm-el" data-lm-timer=\{tag\}/)
  assert.match(css, /@keyframes oclmprog\{from\{transform:translateX\(-100%\)\}to\{transform:translateX\(250%\)\}\}/, 'no layout property animated')
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.oc-lm-prog i\{animation:none;transform:none;width:100%/, 'still bar: full and faint, not a frozen fraction')
})

test('a proposed text is read whole before « Apply »: the two « after » fields grow with their text (no inner scroll under 16 / 22 lines)', () => {
  assert.match(src('ui/dialogStyles.js'), /\.oc-lm-rv \.oc-lm-ba textarea\{[^}]*field-sizing:content;min-height:4lh;max-height:16lh\}/)
  assert.match(src('ui/campaignStyles.js'), /\.oc-lm-bd textarea\{[^}]*field-sizing:content;min-height:6lh;max-height:22lh\}/)
})

test('380 px: the duplicate button keeps one line and the amount keeps its unit', () => {
  assert.match(src('ui/dialogStyles.js'), /\.oc-lm-dup \.oc-btn\{flex:0 0 auto;white-space:nowrap;margin-left:auto\}/)
  for (const l of ['en', 'fr', 'es']) assert.equal(translate(messages, l, 'llm.cg.usd', ['0.0054']), '0.0054\u00a0$', l)
})

test('the note under « Apply » says the 6 s start after the click (it read as a countdown already running)', () => {
  const said = { en: /after the click, 6 s/, fr: /après le clic, 6 s/, es: /tras el clic, 6 s/ }
  for (const l of ['en', 'fr', 'es']) assert.match(translate(messages, l, 'llm.revise.note', []), said[l], l)
})
}

// ===== llm-dialogs =====
{
// Bugs reproduced in the real webapp, each kept as a test that fails without its fix.
//    (1)  the host's REST door throws `Error("409: {json}")` (no `.body`, no `.status`; read on the real webapp by intercepting the route):
//         « another call is in progress » (HTTP 409 busy) was shown as « the agent half did not answer ».
test('a 409 from the host (message « 409: {"ok":false,"reason":"busy"} ») is « busy », not « unreachable »', () => {
  const answer = answerOfError(new Error('409: {"ok":false,"reason":"busy"}'))
  assert.equal(answer.reason, 'busy')
  assert.equal(answer.kind, 'failed')
  assert.equal(answerOfError(new Error('409')).reason, 'busy', 'the status alone is enough')
  assert.equal(answerOfError(new Error('409: <html>Conflict</html>')).reason, 'busy', 'a body that is not JSON does not hide the status')
})

test('other host failures stay « unreachable »; a reason is only taken from the closed list', () => {
  for (const message of ['Failed to fetch', '500: {"detail":"boom"}', '422: {"detail":[{"msg":"x"}]}', '504: {"ok":false,"reason":"timeout"}', 'network']) {
    const reason = answerOfError(new Error(message)).reason
    assert.ok(REASONS.includes(reason), message)
  }
  assert.equal(answerOfError(new Error('500: {"detail":"boom"}')).reason, 'unreachable')
  assert.equal(answerOfError(new Error('Failed to fetch')).reason, 'unreachable')
  assert.equal(answerOfError(new Error('409: {"ok":false,"reason":"<img onerror=x>"}')).reason, 'busy', 'status wins, a made-up reason is never shown')
  assert.equal(answerOfError(new Error('400: {"ok":false,"reason":"<img onerror=x>"}')).reason, 'unreachable')
  assert.equal(answerOfError({ body: { ok: false, reason: 'busy' } }).reason, 'busy', 'the earlier shape (error.body) still works')
})

//   (2)  on the real webapp under 900 px the host calls preventDefault() on Escape before it reaches the browser, so a native modal
//        <dialog> never gets its `cancel` event (a bare <dialog> shows the same): the Decorator, the Seating and the Recruit windows
//        could only be closed with their button. Each window now closes itself from its own keydown.
test('escapeCloses: Escape alone, not with a modifier, no other key', async () => {
  const { escapeCloses } = await import('../../src/ui/dialogKeys.js')
  assert.equal(escapeCloses({ key: 'Escape' }), true)
  assert.equal(escapeCloses({ key: 'Escape', ctrlKey: true }), false)
  assert.equal(escapeCloses({ key: 'Escape', altKey: true }), false)
  assert.equal(escapeCloses({ key: 'Escape', metaKey: true }), false)
  assert.equal(escapeCloses({ key: 'Enter' }), false)
  assert.equal(escapeCloses({ key: 'Esc' }), false)
  assert.equal(escapeCloses({ key: 'Escape', isComposing: true }), false, 'Escape that ends an input method composition is not a close')
  assert.equal(escapeCloses(null), false)
})

test('the three windows of the plugin close on their own Escape (wire)', () => {
  for (const file of ['DecorDialog', 'SeatingDialog', 'HireDialog']) {
    const src = readFileSync(new URL(`../../src/ui/${file}.jsx`, import.meta.url), 'utf8')
    assert.match(src, /import \{ escapeCloses \} from '\.\/dialogKeys\.js'/, file)
    assert.match(src, /onKeyDown=\{e => \{ if \(escapeCloses\(e\)\)/, `${file} reads Escape itself`)
  }
})

//   (3)  French said « sessions de analyst », « Ouvrir la dernière session de editor »:
//        a name that starts with a vowel takes « d’ » (seen in the banner « Données partielles : sessions de analyst, … »).
test('French elides « de » before a vowel in every sentence that names a profile or a board', async () => {
  const { messages } = await import('../../src/i18n/index.js')
  const fr = messages.fr
  assert.equal(fr.banner.source.sessions('analyst'), 'sessions d’analyst')
  assert.equal(fr.banner.source.sessions('backend'), 'sessions de backend')
  assert.equal(fr.banner.source.cron('editor'), 'tâches planifiées d’editor')
  assert.equal(fr.banner.source.cron('default'), 'tâches planifiées de default')
  assert.equal(fr.openSession('analyst'), 'Ouvrir la dernière session d’analyst')
  assert.equal(fr.openSession('qa'), 'Ouvrir la dernière session de qa')
  assert.equal(fr.spot.board('alpha'), 'Tableau blanc d’alpha')
  assert.equal(fr.spot.board('beta'), 'Tableau blanc de beta')
  assert.equal(fr.chains.queue('alpha'), 'Dernières cartes d’alpha, de la plus ancienne à la plus récente')
})
}
