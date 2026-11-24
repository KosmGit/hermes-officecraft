import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { followTitle, hireDraft } from '../../src/core/recruit.js'
import { messages } from '../../src/i18n/index.js'
import { DIALOG_CSS } from '../../src/ui/dialogStyles.js'

// What the action windows say and how they are laid out: the recruitment, the campaign, resources, the replay, the showcase.
const src = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')
const LANGS = ['en', 'fr', 'es']
const rule = (css, sel) => css.split('\n').find(l => l.startsWith(`${sel}{`)) ?? ''

/* ---------- recruitment ---------- */
test('the identifier follows the display title until it is written by hand', () => {
  const d = hireDraft([])
  assert.deepEqual(followTitle(d, 'Designer UI'), { name: 'designer-ui' })
  assert.deepEqual(followTitle({ ...d, title: 'Designer UI', name: 'designer-ui' }, 'Designer UI 2'), { name: 'designer-ui-2' }, 'still the slug of the previous title')
  assert.deepEqual(followTitle({ ...d, title: 'Designer UI', name: 'ui' }, 'Designer'), {}, 'typed by hand: left alone')
  assert.deepEqual(followTitle({ ...d, title: 'Designer', name: 'custom' }, ''), {}, 'a title cleared does not erase a typed identifier')
  assert.deepEqual(followTitle({ ...d, title: 'Designer', name: 'designer' }, ''), { name: '' }, 'a followed identifier follows the title down to nothing')
  assert.deepEqual(followTitle(d, 'Éric — Lead'), { name: 'eric-lead' }, 'accents and signs become a valid identifier')
  assert.ok(followTitle(d, 'x'.repeat(200)).name.length <= 64)
})

test('the title comes before the identifier, which the title fills in', () => {
  const dlg = src('ui/HireDialog.jsx')
  assert.ok(dlg.indexOf("htmlFor={`${id}-title`}") < dlg.indexOf("htmlFor={`${id}-name`}"), 'the readable name first')
  assert.match(dlg, /set\(\{ title: e\.target\.value, \.\.\.followTitle\(draft, e\.target\.value\) \}\)/)
  assert.match(dlg, /titleRef\.current\?\.focus\(\)/, 'the window opens on the first field')
})

test('the type of bot is one folded line that unfolds in place and folds back after a choice', () => {
  const rp = src('ui/RolePicker.jsx')
  assert.match(rp, /data-role-toggle/)
  assert.match(rp, /aria-expanded=\{open\}/)
  assert.match(rp, /useState\(false\)/, 'folded by default')
  assert.match(rp, /e\.detail > 0\) fold\(\)/, 'a click on a chip folds; the arrows of the keyboard only move')
  for (const lang of LANGS) {
    const r = messages[lang].recruit
    assert.match(r.roleGuessLine('Developer'), /Developer/, lang)
    assert.ok(r.roleChange.length && r.roleFold.length, lang)
  }
})

test('the portrait follows the scroll on a wide window and sits in the flow on a sheet', () => {
  assert.match(rule(DIALOG_CSS, '.oc-dg-prev'), /position:sticky;top:0/)
  assert.match(DIALOG_CSS, /@media \(max-width:560px\)\{[^@]*\.oc-dg-prev\{position:static/)
})

test('the starting points say what they hold, in plain words, with the counts agreeing', () => {
  assert.equal(messages.fr.recruit.starts.fresh, 'Neuf (compétences de Hermes)')
  assert.equal(messages.fr.recruit.starts.empty, 'Vide (aucune compétence)')
  assert.equal(messages.fr.recruit.skillsSum(12, 'default', 3), '12 compétences copiées de default, dont 3 propres')
  assert.equal(messages.fr.recruit.skillsSum(1, 'default', 0), '1 compétence copiée de default')
  assert.equal(messages.en.recruit.skillsSum(12, 'default', 3), '12 skills copied from default, 3 of them custom')
  assert.equal(messages.es.recruit.skillsSum(1, 'default', 1), '1 skill copiado de default, 1 propio')
  assert.match(messages.fr.recruit.modelInherited, /bot principal/)
})

test('the risk of « Recruit » is written next to the button, the diagnostic link is quiet, and « Close » keeps the draft', () => {
  const dlg = src('ui/HireDialog.jsx')
  assert.match(dlg, /<p className="oc-dg-fn" data-hire-risk>\{t\('recruit\.riskNote'\)\}<\/p>/)
  assert.match(dlg, /className="oc-dg-link quiet"/)
  assert.match(dlg, /data-hire-kept/)
  assert.match(rule(DIALOG_CSS, '.oc-dg-link.quiet'), /font-size:11px/)
  for (const lang of LANGS) {
    const r = messages[lang].recruit
    assert.ok(r.riskNote.length > 40, `${lang} the note says what is written and how to undo it`)
    assert.ok(messages[lang].dlg.draftKept.length > 10, lang)
  }
  assert.equal(messages.fr.recruit.cancel, 'Fermer')
})

/* ---------- campaign ---------- */
import { applyTemplate, draftIssues, missingParts, newDraft, templatePreview } from '../../src/core/campaign.js'
import { CAMPAIGN_CSS } from '../../src/ui/campaignStyles.js'

const bots = ['alpha', 'beta']
const params = { n: 2, per: 2, bots: { dev: 'alpha', review: 'beta', audit: ['alpha'], synth: 'beta', work: ['alpha'], chain: ['alpha'] } }

test('an empty draft says what it lacks, in the order of the form, and nothing else', () => {
  const empty = newDraft({ phaseName: 'Phase A' })
  assert.deepEqual(missingParts(draftIssues(empty, { bots, boards: ['website'] })), ['goal', 'project', 'card'])
  assert.deepEqual(missingParts(draftIssues({ ...empty, boardMode: 'new' }, { bots, boards: [] })), ['goal', 'projectName', 'card'])
  assert.deepEqual(missingParts(draftIssues({ ...empty, goal: 'Ship it', board: 'website' }, { bots, boards: ['website'] })), ['card'])
  const full = applyTemplate({ ...empty, goal: 'Ship it', board: 'website' }, 'chain', params, 'replace').draft
  assert.deepEqual(missingParts(draftIssues(full, { bots, boards: ['website'] })), [], 'a wrong value is an error, not a missing part')
})

test('the checks of the foot appear from the first card and never include the one that cannot fail', () => {
  const dlg = src('ui/CampaignDialog.jsx')
  assert.match(dlg, /\{sum\.work > 0 \? \(\s*<>\s*<span className=\{`ck \$\{g\.loop/)
  assert.doesNotMatch(dlg, /campaign\.ck\.guarded/, '« behind a guard » is true by construction (effective() adds the guards)')
  assert.match(dlg, /data-missing/)
  for (const lang of LANGS) {
    assert.equal(messages[lang].campaign.ck.guarded, undefined, lang)
    assert.match(messages[lang].campaign.missing('X'), /X/, lang)
  }
  assert.equal(messages.fr.campaign.missing('un objectif, un projet, une carte'), 'Il manque : un objectif, un projet, une carte.')
})

test('a chain template is a « gabarit » / « template » / « plantilla »; « modèle » stays the model of the LLM', () => {
  const tpl = { fr: /gabarit/i, en: /template/i, es: /plantilla/i }
  for (const lang of LANGS) {
    const c = messages[lang].campaign.tpl
    for (const k of ['label', 'title', 'go', 'pick']) assert.match(c[k], tpl[lang], `${lang} campaign.tpl.${k}`)
    assert.match(messages[lang].campaign.starter, tpl[lang], lang)
  }
  assert.doesNotMatch(JSON.stringify(Object.values(messages.fr.campaign.tpl).filter(v => typeof v === 'string')), /[Mm]odèle/)
  assert.match(messages.fr.campaign.f.model, /Modèle/, 'the LLM model keeps its word')
  assert.equal(messages.fr.campaign.starter, 'Partez d’un gabarit ou ajoutez une première carte.')
  const dlg = src('ui/CampaignDialog.jsx')
  assert.match(dlg, /data-cg-starter/)
  assert.match(dlg, /k === 0 && sum\.work === 0/, 'the starter shows in the first phase of a draft with no card')
})

test('the window keeps one height on the composing step', () => {
  assert.match(CAMPAIGN_CSS, /\.oc-dg\.oc-cg-dlg\[data-step="compose"\]\{height:min\(760px,calc\(100dvh - 32px\)\)\}/)
})

test('a template on an empty draft has no « add / replace » choice and says what it makes', () => {
  const empty = newDraft({ phaseName: 'Phase A' })
  const p = templatePreview(empty, 'phases', { ...params, n: 2, per: 2 }, 'append')
  assert.deepEqual({ mode: p.mode, made: p.made, phases: p.phases, guards: p.guards, work: p.work }, { mode: 'replace', made: 4, phases: 2, guards: 2, work: 4 })
  assert.equal(messages.fr.campaign.tpl.result(p.made, p.phases, p.guards), 'Crée 4 cartes en 2 phases, 2 verrous.')
  assert.equal(messages.fr.campaign.tpl.result(1, 1, 1), 'Crée 1 carte en 1 phase, 1 verrou.')
  assert.equal(messages.en.campaign.tpl.result(4, 2, 2), 'Creates 4 cards in 2 phases, 2 guards.')
  const filled = applyTemplate(empty, 'chain', params, 'replace').draft
  const add = templatePreview(filled, 'chain', params, 'append')
  assert.equal(add.mode, 'append')
  assert.equal(add.work, 4, 'the draft would then hold 4 cards')
  assert.deepEqual(templatePreview(filled, 'chain', { ...params, n: 20 }, 'append').refused, null)
  const dlg = src('ui/CampaignDialog.jsx')
  assert.match(dlg, /\{empty \? null : \(\s*<span className="oc-dg-seg"/)
  assert.match(dlg, /data-tpl-result/)
})

test('the preview names a phase by its letter in the strip, the whole name on hover and for a screen reader', () => {
  const g = src('ui/CampaignGraph.jsx')
  assert.match(g, /<span className="lb" aria-hidden="true" title=\{t\('campaign\.phaseLabel'[^}]*\}>\{letter\(b\.p\)\}<\/span>/)
  assert.match(g, /<span className="ux-vh">\{t\('campaign\.phaseLabel'/)
  assert.doesNotMatch(CAMPAIGN_CSS, /writing-mode:vertical-rl;transform:rotate\(180deg\);font-size:10\.5px/, 'no vertical label cut to « Ph… »')
})

test('the texts of the editor say what they are for', () => {
  assert.equal(messages.fr.campaign.goal, 'Ce que cette campagne doit livrer')
  assert.equal(messages.fr.campaign.phaseCards(0), '0 carte')
  assert.equal(messages.fr.campaign.phaseCards(3), '3 cartes')
  assert.equal(messages.fr.campaign.addPhase, 'Ajouter une phase (avec verrou)')
  assert.equal(messages.en.campaign.phaseCards(1), '1 card')
  assert.equal(messages.es.campaign.phaseCards(0), '0 tarjetas')
  const dlg = src('ui/CampaignDialog.jsx')
  assert.match(dlg, /<span className="pl" aria-hidden="true">\{letter\(k\)\}<\/span>/, 'the letter of the phase, not « PHASE A » beside « Phase A »')
  assert.match(dlg, /t\('campaign\.phaseCards', /)
})

/* ---------- resources ---------- */
import { costTotal, quotaOf } from '../../src/core/usage.js'
import { USAGE_CSS } from '../../src/ui/usageStyles.js'

const line = (model, priced, usd, provider = 'example') => ({ model, provider, task: '', apiCalls: 1, tokens: null, priced, usd: priced ? usd : null, costKind: priced ? 'estimated' : 'unpriced', costSource: 'x' })
const agent = (profile, models) => ({ profile, sessions: 2, apiCalls: 4, tokens: { input: 10, output: 5, cacheRead: null, cacheWrite: null, reasoning: null }, reason: null, models })

test('the cost of the period is an amount only from priced routes, and says when it is partial', () => {
  const all = costTotal({ profiles: [agent('alpha', [line('m1', true, 1.5), line('m2', true, 0.25)]), agent('beta', [line('m1', true, 2)])] })
  assert.deepEqual({ kind: all.kind, usd: all.usd, routes: all.routes, partial: all.partial }, { kind: 'priced', usd: 3.75, routes: 0, partial: false })
  const some = costTotal({ profiles: [agent('alpha', [line('m1', true, 1.5), line('local', false)]), agent('beta', [line('local', false)])] })
  assert.deepEqual({ kind: some.kind, usd: some.usd, priced: some.pricedUsd, routes: some.routes, partial: some.partial }, { kind: 'mixed', usd: null, priced: 1.5, routes: 1, partial: true }, 'one route without a price, counted once however many agents use it')
  const none = costTotal({ profiles: [agent('alpha', [line('local', false)])] })
  assert.deepEqual({ kind: none.kind, usd: none.usd, priced: none.pricedUsd }, { kind: 'unpriced', usd: null, priced: null }, 'never a 0 for an amount nobody knows')
  assert.equal(costTotal({ profiles: [] }).kind, 'none')
  const blind = costTotal({ profiles: [agent('alpha', [line('m1', true, 1)]), agent('beta', null)] })
  assert.deepEqual({ kind: blind.kind, noDetail: blind.noDetail, partial: blind.partial }, { kind: 'priced', noDetail: 1, partial: true }, 'an agent with sessions and no breakdown makes the total a lower bound')
  assert.equal(costTotal({ profiles: [{ ...agent('gone', null), sessions: null, reason: 'missing' }] }).noDetail, 0, 'an agent with no record is not counted as one without detail')
})

test('the cost is the first tile, without a 0 for an unknown amount', () => {
  const dlg = src('ui/UsageDialog.jsx')
  assert.ok(dlg.indexOf('<CostTile cost={cost}') < dlg.indexOf('<Tile id="tokens"'), 'the first question: what did it cost')
  assert.match(dlg, /cost\.kind === 'priced' \|\| cost\.kind === 'mixed' \? t\('usage\.tile\.costValue'/, 'an amount only for a priced total')
  for (const lang of LANGS) {
    const tile = messages[lang].usage.tile
    assert.match(tile.costRoutes(2), /\+ 2/, lang)
    assert.doesNotMatch(tile.costRoutes(1), /\broutes\b|\brutas\b/i, `${lang}: one route, singular`)
  }
  assert.equal(messages.fr.usage.tile.costRoutes(2), '+ 2 routes sans prix')
  assert.equal(messages.fr.usage.tile.cost, 'coût estimé')
})

test('while nothing is read the sections stand in their final order and the quota concludes nothing', () => {
  const dlg = src('ui/UsageDialog.jsx')
  assert.match(dlg, /<Skeleton id=\{id\} t=\{t\} \/>/)
  const sk = dlg.slice(dlg.indexOf('function Skeleton'), dlg.indexOf('function Days'))
  const order = ['usage.days.title', 'usage.agents.title', 'usage.models.title'].map(k => sk.indexOf(k))
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), 'days, agents, models: the order of the loaded window')
  assert.match(dlg, /if \(!query\.data \|\| usage !== 'ok'\) return <p className="oc-hint" data-usage-quota="loading">/, 'no « none » before the usage is read')
  assert.equal(messages.fr.usage.quota.noRoute, 'Aucun fournisseur utilisé sur la période n’expose de quota.')
  // the quota of a period that used a provider with no window says so, and an empty usage still answers « none »
  assert.deepEqual(quotaOf({ providers: [] }, []), { groups: [], missing: [] })
})

test('the chart of the days names its highest value and puts its grid on values', () => {
  const dlg = src('ui/UsageDialog.jsx')
  assert.match(dlg, /data-usage-max>\{tokenLabel\(peak, t\.lang\)\}/)
  assert.match(dlg, /tokenLabel\(peak \/ 2, t\.lang\)/)
  assert.doesNotMatch(USAGE_CSS, /repeating-linear-gradient\(to top, transparent 0 27px/, 'no grid line that measures nothing')
  assert.match(USAGE_CSS, /\.oc-us-col\{[^}]*linear-gradient\(to bottom/)
})

test('the controls are labelled, a legend names the three colours, and a period reads the same in Resources and in the replay', () => {
  const dlg = src('ui/UsageDialog.jsx')
  assert.match(dlg, /data-usage-label="window">\{t\('usage\.window'\)\}/)
  assert.match(dlg, /data-usage-label="metric">\{t\('usage\.metricLabel'\)\}/)
  assert.match(dlg, /data-usage-key/)
  for (const lang of LANGS) {
    assert.equal(messages[lang].usage.win['24h'], messages[lang].replay.windowShort['24h'], `${lang}: « 24 h » is written once`)
    assert.equal(messages[lang].usage.win['7d'], messages[lang].replay.windowShort['7d'], lang)
  }
  assert.equal(messages.fr.usage.agents.calls('12', '3'), '12 appels · 3 sessions')
  assert.equal(messages.fr.usage.agents.calls('1', '1'), '1 appel · 1 session')
  assert.equal(messages.en.usage.agents.calls('12', '3'), '12 calls · 3 sessions')
  assert.equal(messages.es.usage.agents.calls('1', '2'), '1 llamada · 2 sesiones')
  assert.match(messages.fr.usage.agents.calls(null, '2'), /non enregistrés/, 'a count Hermes did not record is said so, never written 0')
})

test('a window that only reads has no « Close » in its foot: the cross, Escape and the backdrop close it', () => {
  const dlg = src('ui/UsageDialog.jsx')
  assert.doesNotMatch(dlg, /actions=\{/, 'Resources has no action')
  assert.match(dlg, /backdrop/)
  assert.doesNotMatch(src('ui/Collection.jsx'), /actions=\{/, 'nor has the showcase')
})
