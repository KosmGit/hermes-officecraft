// The preview in the settings IS the message of the agent half. src/core/notifyFormat.js is a port of
// hermes_officecraft/notify_format.py; this test runs the Python on the same facts (3 languages x 4 platform styles x 14 cases)
// and fails on any character of difference, and compares the table of words with the Python's. A drift cannot ship.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

process.env.TZ = 'UTC'   // the « stopped HH:MM–HH:MM » clock is read in the local zone, on both sides

const { formatMessage, styleFor, cut, splitTitle, inert, span } = await import('../../src/core/notifyFormat.js')
const { SYMBOLS, WORDS, QUIET_SYMBOL } = await import('../../src/core/notifyWords.js')

const root = fileURLToPath(new URL('../../', import.meta.url))
const NOW = 1_800_000_000

const PY = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('notify_format', sys.argv[1] + '/hermes_officecraft/notify_format.py')
nf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nf)
req = json.load(sys.stdin)
out = {'cases': [nf.format_message(c['facts'], c['lang'], platform=c['platform'], now=c['now'], quiet=c.get('quiet'), test=c.get('test', False)) for c in req['cases']],
       'words': nf.WORDS, 'symbols': nf.SYMBOLS, 'quiet': nf.QUIET_SYMBOL,
       'helpers': {'cut': [nf.cut(s, n) for s, n in req['cuts']], 'split': [list(nf.split_title(s)) for s in req['splits']],
                   'inert': [nf.inert(s) for s in req['inerts']], 'span': [[nf.span(v, l) for l in ('en', 'fr', 'es')] for v in req['spans']]}}
sys.stdout.write(json.dumps(out, ensure_ascii=False))
`

const facts = {
  decisions: [
    { state: 'blocked', board: 'website', title: 'DOCS2 — Settings in the office', agent: 'frontend', since: NOW - 12 * 60 },
    { state: 'blocked', board: 'website', title: 'API-3: a very long title that has to be cut cleanly on a word close to the edge', agent: 'backend', since: NOW - 3 * 3600 - 300 },
    { state: 'approval' }
  ],
  mixed: [
    { state: 'blocked', board: 'a', title: 'S4.1 — A card', agent: 'x', since: NOW - 90 },
    { state: 'silent', board: 'b', title: 'Plain title without code', agent: 'y', since: NOW - 7 * 60 },
    { state: 'stopped', start: NOW - 3000, end: NOW - 600 },
    { state: 'degraded', title: 'telegram' },
    { state: 'cron_failed', title: 'nightly-sync', agent: 'default', since: NOW - 2 * 86400 },
    { state: 'camp_ready', board: 'a', name: 'Campaign A', count: 5, phase: 2, title: 'Phase two' },
    { state: 'camp_done', board: 'a', name: 'Campaign A', count: 9 },
    { state: 'review_changes', board: 'a', title: 'R-DOCS1 — Review', agent: 'reviewer', since: NOW - 240 },
    { state: 'review_blocked', board: 'b', title: 'WEB0 review', agent: 'reviewer' },
    { state: 'llm_90', kind: 'usd', pct: 90, used: 4.5, cap: 5 },
    { state: 'llm_cap', kind: 'calls', pct: 100, used: 200, cap: 200 },
    { state: 'trophy', name: 'Zéro casse', tier: 'gold' }
  ],
  hostile: [
    { state: 'blocked', board: 'sandboxless', title: '@everyone MEDIA:/etc/passwd [click](http://evil) <b>bold</b> https://x.y  \u202e\u200b tel:123', agent: 'a @everyone', since: NOW - 60 },
    { state: 'cron_failed', title: '*_~`|>#\\ & < >', agent: 'agent_1', since: NOW - 5 },
    { state: 'trophy', name: '[[directive]] & <i>', tier: 'bronze' }
  ],
  many: Array.from({ length: 11 }, (_, i) => ({ state: 'silent', board: 'p', title: `T${i} — card ${i}`, agent: 'z', since: NOW - (i + 1) * 61 })),
  one: [{ state: 'silent', board: 'p', title: 'T1 — card', agent: 'z', since: NOW - 5 }],
  junk: [{ state: 'nope' }, null, { state: 'blocked', title: 7, agent: 'bad/name', since: 'x' }, { state: 'trophy', name: '', tier: 'platinum' }]
}

const cases = []
for (const lang of ['en', 'fr', 'es']) {
  for (const platform of ['telegram', 'discord', 'slack', null]) {
    for (const [name, list] of Object.entries(facts)) cases.push({ name: `${lang}/${platform}/${name}`, lang, platform, facts: list, now: NOW })
    cases.push({ name: `${lang}/${platform}/quiet`, lang, platform, facts: facts.mixed.slice(0, 3), now: NOW, quiet: { from: '22:00', to: '07:00', resolved: 2 } })
    cases.push({ name: `${lang}/${platform}/quiet-one-resolved`, lang, platform, facts: facts.one, now: NOW, quiet: { from: '22:00', to: '07:00', resolved: 1 } })
    cases.push({ name: `${lang}/${platform}/quiet-bad-clock`, lang, platform, facts: facts.one, now: NOW, quiet: { from: '25:61', to: 'x', resolved: 0 } })
    cases.push({ name: `${lang}/${platform}/test`, lang, platform, facts: facts.decisions, now: NOW, test: true })
  }
}
const cuts = [['short', 50], ['x'.repeat(80), 50], ['one two three four five six seven eight nine ten eleven twelve thirteen', 50], ['word — apart, and punctuation (naïve) to cut there', 30], ['😀'.repeat(60), 50]]
const splits = ['API3 — Leftovers of S4 : launches', 'DOCS1', 'Plain text', 'R-DOCS1 review', 'S4.1: x', 'A', 'CODE-TOO-LONG-FOR-A-CODE1 x', '', 'WEB0']
const inerts = ['a<b>c[d]e', 'MEDIA :/x media:/y', '@here @channel @all @everyone @heresy', 'see https://a.b and ftp://c', 'mailto:x tel:1 sms:2']
const spans = [0, 59, 60, 3599, 3600, 3725, 86399, 86400, 200000, -5, 12.7]

const havePython = !spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' }).error   // the CI and the dev box have it; a box without would skip, never pass silently on a drift

test('preview: the page message is character for character the one of the Python half (3 languages x 4 platform styles x every case)', { skip: havePython ? false : 'python3 not found' }, () => {
  const res = spawnSync('python3', ['-I', '-c', PY, root], { input: JSON.stringify({ cases, cuts, splits, inerts, spans }), encoding: 'utf8', maxBuffer: 50_000_000, env: { ...process.env, TZ: 'UTC' } })
  assert.equal(res.status, 0, `python failed: ${res.stderr}`)
  const py = JSON.parse(res.stdout)
  assert.equal(py.cases.length, cases.length)
  const diffs = []
  cases.forEach((c, i) => {
    const js = formatMessage(c.facts, c.lang, { platform: c.platform, now: c.now, quiet: c.quiet || null, test: c.test || false })
    if (js !== py.cases[i]) diffs.push(`${c.name}\n--- python\n${py.cases[i]}\n--- js\n${js}`)
  })
  assert.deepEqual(diffs, [], diffs.slice(0, 3).join('\n\n'))
  // the table of words and symbols is a copy: the same keys, the same text
  assert.deepEqual(JSON.parse(JSON.stringify(WORDS)), py.words)
  assert.deepEqual(JSON.parse(JSON.stringify(SYMBOLS)), py.symbols)
  assert.equal(QUIET_SYMBOL, py.quiet)
  // the small pieces too, so a drift is named where it is
  assert.deepEqual(cuts.map(([s, n]) => cut(s, n)), py.helpers.cut)
  assert.deepEqual(splits.map(s => splitTitle(s)), py.helpers.split)
  assert.deepEqual(inerts.map(s => inert(s)), py.helpers.inert)
  assert.deepEqual(spans.map(v => ['en', 'fr', 'es'].map(l => span(v, l))), py.helpers.span)
})

test('preview: a safe message on every platform (no tag, no link, no attachment, no mass mention), as in the agent half', () => {
  for (const platform of ['telegram', 'discord', 'slack', null]) {
    const text = formatMessage(facts.hostile, 'en', { platform, now: NOW })
    assert.doesNotMatch(text, /\[click\]\(/, 'no markdown link')
    assert.doesNotMatch(text, /MEDIA:/i, 'no attachment directive')
    assert.doesNotMatch(text, /@everyone/i, 'no mass mention')
    assert.doesNotMatch(text, /[\u202e]/, 'no bidi control')
    assert.doesNotMatch(text, /https?:\/\//, 'no live link')
    if (platform === 'telegram') assert.doesNotMatch(text.replace(/<\/?b>/g, ''), /[<>]/, 'only our own <b> is a tag')
  }
})

test('preview: the style of the platform decides the bold, the preview style marks it', () => {
  const f = [{ state: 'blocked', board: 'p', title: 'AB1 — x', agent: 'z', since: NOW - 60 }]
  assert.match(formatMessage(f, 'en', { platform: 'telegram', now: NOW }), /<b>1 decision is waiting for you<\/b>/)
  assert.match(formatMessage(f, 'en', { platform: 'discord', now: NOW }), /\*\*1 decision is waiting for you\*\*/)
  assert.doesNotMatch(formatMessage(f, 'en', { platform: 'slack', now: NOW }), /<b>|\*\*/)
  assert.equal(styleFor('telegram').kind, 'html')
})

test('a duration in hours never reads as a time of day (« depuis 6 h 50 » read « since 6:50 »)', () => {
  assert.equal(span(6 * 3600 + 50 * 60, 'fr'), '6\u00a0h\u00a050\u00a0min')
  assert.equal(span(5 * 3600 + 59, 'fr'), '5\u00a0h')
  assert.equal(span(3 * 3600 + 300, 'en'), '3 h 5 min')
})
