import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { addTokens, agentRows, boardRows, boardsAvailable, costOf, dailySeries, dayRanges, exactLabel, modelRows, nousBalance, peakOf, percentLabel, quotaOf, rangeLabel, share, tokenLabel, tokenParts, toUsage, usageWindow, usdLabel } from '../../src/core/usage.js'
import { clockLabel, toReplay } from '../../src/core/replay.js'
import { es } from '../../src/i18n/es.js'
import { messages } from '../../src/i18n/index.js'

// ===== usage =====
{
const tok = (input, output, cacheRead = null, cacheWrite = null, reasoning = null) => ({ input, output, cacheRead, cacheWrite, reasoning })
const line = (o = {}) => ({ model: 'm1', provider: 'p1', task: '', apiCalls: 2, tokens: tok(100, 50, 1000, 10), priced: false, usd: null, costKind: 'unpriced', costSource: 'none', ...o })
const prof = (profile, o = {}) => ({ profile, sessions: 3, apiCalls: 10, tokens: tok(100, 50, 1000, 10), models: [line()], ...o })
const body = (profiles, o = {}) => ({ ok: true, from: 1000, to: 2000, attribution: 'session_start', profiles, routes: [{ model: 'm1', provider: 'p1', priced: false, costSource: 'none' }], partial: [], ...o })
const U = (profiles, o) => toUsage(body(profiles, o))

/* ---------- the body ---------- */

test('toUsage: a body that is not /usage is not ok; seconds become ms', () => {
  assert.equal(toUsage(null).ok, false)
  assert.equal(toUsage({ ok: false }).ok, false)
  assert.equal(toUsage({ ok: true, profiles: [] }).ok, false, 'no window')
  const u = U([])
  assert.equal(u.ok, true)
  assert.equal(u.fromMs, 1_000_000)
  assert.equal(u.toMs, 2_000_000)
})

test('toUsage: a NULL column stays null (never 0); a negative count is null; an unknown reason is dropped', () => {
  const u = U([prof('a', { tokens: { input: null, output: 5, cacheRead: -3, cacheWrite: undefined, reasoning: 'x' }, reason: 'weird' })])
  const t = u.profiles[0].tokens
  assert.equal(t.input, null)
  assert.equal(t.output, 5)
  assert.equal(t.cacheRead, null, 'negative = not recorded')
  assert.equal(t.cacheWrite, null)
  assert.equal(t.reasoning, null)
  assert.equal(u.profiles[0].reason, null)
  assert.equal(U([prof('a', { tokens: null })]).profiles[0].tokens, null)
  assert.equal(U([prof('a', { tokens: { input: null, output: null } })]).profiles[0].tokens, null, 'nothing recorded at all')
})

test('toUsage: a route without a price has NO amount, whatever the body says (the API-price equivalent of a subscription is never shown)', () => {
  const u = U([prof('a', { models: [line({ priced: false, usd: 168.23, costKind: 'estimated' }), line({ model: 'm2', priced: true, usd: 0.5, costKind: 'estimated', costSource: 'provider_models_api' })] })])
  const [a, b] = u.profiles[0].models
  assert.equal(a.usd, null)
  assert.equal(a.costKind, 'unpriced')
  assert.equal(b.usd, 0.5)
  assert.equal(b.costKind, 'estimated')
})

test('toUsage: nothing unknown is kept (no path, no preview), bad profiles and lines are dropped', () => {
  const u = U([{ ...prof('a'), path: '/home/x', soul: 'secret' }, { sessions: 1 }, null], { routes: [{ model: 'm', provider: 'p', priced: true, token: 'sk-x' }, { provider: 'x' }] })
  assert.deepEqual(u.profiles.map(p => p.profile), ['a'])
  assert.ok(!JSON.stringify(u).includes('secret'))
  assert.ok(!JSON.stringify(u).includes('/home/x'))
  assert.ok(!JSON.stringify(u).includes('sk-x'))
  assert.equal(u.routes.length, 1)
})

/* ---------- tokens, units, rounding ---------- */

test('tokenParts: fresh = input + output; all adds the cache; a missing part is left out and flagged, never 0', () => {
  assert.deepEqual(tokenParts(tok(100, 50, 1000, 10), 'fresh'), { input: 100, output: 50, cache: null, total: 150, incomplete: false })
  assert.deepEqual(tokenParts(tok(100, 50, 1000, 10), 'all'), { input: 100, output: 50, cache: 1010, total: 1160, incomplete: false })
  const part = tokenParts(tok(100, null, 7, null), 'all')
  assert.equal(part.total, 107)
  assert.equal(part.incomplete, true, 'the output was not recorded: a lower bound')
  assert.equal(part.cache, 7)
  assert.equal(tokenParts(null, 'fresh'), null)
  assert.equal(tokenParts(tok(null, null, 5, 5), 'fresh'), null, 'only the cache is known: no fresh total')
  assert.equal(tokenParts(tok(0, 0), 'fresh').total, 0, 'a recorded zero stays a zero')
})

test('addTokens: a part is null only when no record had it', () => {
  assert.deepEqual(addTokens([]), null)
  assert.deepEqual(addTokens([null, null]), null)
  const s = addTokens([tok(1, null), tok(2, 3), null])
  assert.equal(s.input, 3)
  assert.equal(s.output, 3)
  assert.equal(s.cacheRead, null)
})

test('labels: tokens are rounded for reading, the exact number is kept apart, null is never 0', () => {
  assert.equal(tokenLabel(999, 'en'), '999')
  assert.equal(tokenLabel(1234, 'en'), '1.2K')
  assert.equal(tokenLabel(1_234_567, 'en'), '1.2M')
  assert.equal(tokenLabel(542_000_000, 'en'), '542M')
  assert.equal(tokenLabel(0, 'en'), '0', 'a recorded zero')
  assert.equal(tokenLabel(null, 'en'), null)
  assert.equal(tokenLabel(Number.NaN, 'en'), null)
  assert.equal(exactLabel(1234567, 'en'), '1,234,567')
  assert.equal(exactLabel(1234567, 'fr').replace(/\s/g, ' '), '1 234 567')
  assert.equal(exactLabel(null, 'en'), null)
  assert.equal(usdLabel(0.5, 'en'), '0.50')
  assert.equal(usdLabel(0.0003, 'en'), '0.0003', 'under a cent: four decimals')
  assert.equal(usdLabel(1.126, 'en'), '1.13')
  assert.equal(usdLabel(0, 'en'), '0.00', 'a recorded zero amount')
  assert.equal(usdLabel(null, 'en'), null)
  assert.equal(usdLabel(0.00001, 'en'), '< 0.0001', 'a positive amount is never shown as 0.0000')
  assert.equal(usdLabel(0.00001, 'fr'), '< 0,0001')
  assert.equal(usdLabel(1.5, 'fr'), '1,50')
  assert.equal(percentLabel(29.4), '29')
  assert.equal(percentLabel(29.5), '30')
  assert.equal(percentLabel(0), '0')
  assert.equal(percentLabel(null), null)
})

/* ---------- by agent ---------- */

test('agentRows: biggest first; the totals add the counted agents only', () => {
  const u = U([prof('small', { tokens: tok(10, 5), sessions: 1, apiCalls: 2 }), prof('big', { tokens: tok(1000, 500), sessions: 4, apiCalls: 20 })])
  const a = agentRows(u, 'fresh')
  assert.deepEqual(a.rows.map(r => r.profile), ['big', 'small'])
  assert.equal(a.totals.parts.total, 1515)
  assert.equal(a.totals.sessions, 5)
  assert.equal(a.totals.calls, 22)
  assert.equal(a.totals.incomplete, false)
})

test('agentRows: an agent with no usage base is ABSENT, one with no session is NONE; neither is added as 0', () => {
  const u = U([
    prof('ok', { tokens: tok(10, 5), sessions: 1, apiCalls: 1 }),
    prof('nobase', { sessions: null, apiCalls: null, tokens: null, models: null, reason: 'missing' }),
    prof('quiet', { sessions: 0, apiCalls: null, tokens: null, models: [], reason: 'no_sessions' }),
    prof('locked', { sessions: null, apiCalls: null, tokens: null, models: null, reason: 'locked' })
  ])
  const a = agentRows(u, 'fresh')
  assert.deepEqual(a.rows.map(r => `${r.profile}:${r.state}`), ['ok:ok', 'quiet:none', 'locked:absent', 'nobase:absent'])
  assert.equal(a.none, 1)
  assert.equal(a.absent, 2)
  assert.equal(a.totals.parts.total, 15, 'the totals know only the counted agent')
  assert.equal(a.rows.find(r => r.profile === 'nobase').parts, null)
  assert.equal(a.rows.find(r => r.profile === 'quiet').parts, null)
})

test('agentRows: nothing recorded anywhere -> totals null (not a sum of nothing shown as 0)', () => {
  const none = agentRows(U([prof('a', { sessions: 0, tokens: null, models: [], reason: 'no_sessions' })]), 'fresh')
  assert.equal(none.totals, null)
  const empty = agentRows(U([]), 'fresh')
  assert.equal(empty.totals, null)
  assert.deepEqual(empty.rows, [])
  assert.equal(agentRows(null).totals, null)
})

test('agentRows: a partly recorded agent makes the total a lower bound, said so', () => {
  const a = agentRows(U([prof('a', { tokens: tok(10, null) })]), 'fresh')
  assert.equal(a.totals.parts.total, 10)
  assert.equal(a.totals.incomplete, true)
})

/* ---------- cost ---------- */

test('costOf: priced only if EVERY line is priced; a priced and an unpriced line are never merged into one amount', () => {
  const priced = line({ priced: true, usd: 0.25, costSource: 'provider_models_api', costKind: 'estimated' })
  assert.deepEqual(costOf([]), { kind: 'none', usd: null, pricedUsd: null, unpriced: 0, source: '' })
  assert.deepEqual(costOf(null).kind, 'none')
  assert.deepEqual(costOf([line()]), { kind: 'unpriced', usd: null, pricedUsd: null, unpriced: 1, source: '' })
  const ok = costOf([priced, { ...priced, usd: 0.5 }])
  assert.equal(ok.kind, 'priced')
  assert.equal(ok.usd, 0.75)
  assert.equal(ok.source, 'provider_models_api')
  const mixed = costOf([priced, line()])
  assert.equal(mixed.kind, 'mixed')
  assert.equal(mixed.usd, null, 'no single amount')
  assert.equal(mixed.pricedUsd, 0.25)
  assert.equal(mixed.unpriced, 1)
  assert.equal(costOf([line({ priced: true, usd: null })]).kind, 'unpriced', 'priced route without a recorded amount: no amount')
})

test('agentRows: the cost of a subscription agent is « unpriced », not 0 and not the API-price equivalent', () => {
  const a = agentRows(U([prof('sub', { models: [line({ priced: false, usd: 168.23 })] })]), 'fresh')
  assert.equal(a.rows[0].cost.kind, 'unpriced')
  assert.equal(a.rows[0].cost.usd, null)
})

/* ---------- by model ---------- */

test('modelRows: merges a route across agents and tasks, counts the auxiliary calls, and has no total in dollars', () => {
  const a = line({ tokens: tok(100, 50), apiCalls: 3 })
  const aux = line({ task: 'compression', tokens: tok(10, 5), apiCalls: 1 })
  const cheap = line({ model: 'cheap', provider: 'or', priced: true, usd: 0.1, costSource: 'provider_models_api', costKind: 'estimated', tokens: tok(1000, 1) })
  const m = modelRows(U([prof('x', { models: [a, aux] }), prof('y', { models: [a, cheap] })]), 'fresh')
  assert.deepEqual(m.rows.map(r => r.model), ['cheap', 'm1'])
  const m1 = m.rows.find(r => r.model === 'm1')
  assert.equal(m1.parts.total, 315, '(100+50) x2 + 15')
  assert.equal(m1.calls, 7)
  assert.equal(m1.auxCalls, 1)
  assert.deepEqual(m1.tasks, ['compression'])
  assert.equal(m1.cost.kind, 'unpriced')
  assert.equal(m.rows.find(r => r.model === 'cheap').cost.usd, 0.1)
  assert.ok(!('usd' in m) && !('totalUsd' in m), 'no total in dollars across routes')
})

test('modelRows: a profile without breakdown is said (never an empty row of zeros); no breakdown anywhere -> no rows', () => {
  const m = modelRows(U([prof('a', { models: null, reason: 'no_breakdown' }), prof('b', { sessions: null, models: null, tokens: null, reason: 'missing' })]), 'fresh')
  assert.deepEqual(m.rows, [])
  assert.equal(m.withoutBreakdown, 1, 'a counted agent whose breakdown is missing; the agent with no base is not a breakdown gap')
})

/* ---------- by board ---------- */

const replayBody = runs => ({
  ok: true, at: 5000, from: 1000, to: 2000,
  boards: [{ slug: 'alpha', since: 1000, start: [], cards: {}, facts: [], silences: [], runs }, { slug: 'quiet', since: 1000, start: [], cards: {}, facts: [], silences: [], runs: [] }],
  orders: [], sessions: [], crons: [], truncated: null, partial: []
})
const run = (start, usage, extra = {}) => ({ start, end: start + 10, profile: 'a', task: 't1', outcome: 'completed', usage, ...extra })

test('boardRows: counts runs with and without a recorded usage apart; no usage at all -> null, not 0', () => {
  const r = toReplay(replayBody([
    run(1100, { apiCalls: 2, tokens: { input: 100, output: 50, cacheRead: 5, cacheWrite: 0, reasoning: null } }),
    run(1200, { apiCalls: 1, tokens: { input: 10, output: 5 } }),
    run(1300, null, { why: 'no_session_link' })
  ]))
  const b = boardRows(r, 'fresh')
  const alpha = b.rows.find(x => x.slug === 'alpha')
  assert.equal(alpha.runs, 3)
  assert.equal(alpha.with, 2)
  assert.equal(alpha.without, 1)
  assert.equal(alpha.calls, 3)
  assert.equal(alpha.parts.total, 165)
  const quiet = b.rows.find(x => x.slug === 'quiet')
  assert.equal(quiet.runs, 0)
  assert.equal(quiet.calls, null)
  assert.equal(quiet.parts, null)
  assert.deepEqual(b.rows.map(x => x.slug), ['alpha', 'quiet'])
  assert.equal(boardRows(null).rows.length, 0)
})

test('boardRows: a run whose usage was not recorded is never counted as 0 tokens', () => {
  const r = toReplay(replayBody([run(1100, null, { why: 'no_calls' })]))
  const alpha = boardRows(r, 'fresh').rows[0]
  assert.equal(alpha.with, 0)
  assert.equal(alpha.without, 1)
  assert.equal(alpha.parts, null)
  assert.equal(alpha.calls, null)
})

test('boards are asked only inside what /replay serves (7 days)', () => {
  assert.equal(boardsAvailable('24h'), true)
  assert.equal(boardsAvailable('7d'), true)
  assert.equal(boardsAvailable('30d'), false)
})

/* ---------- periods and days ---------- */

test('usageWindow: whole seconds, ending now, 24 h / 7 d / 30 d; an unknown kind is 24 h', () => {
  const now = 1_700_000_123_456
  const w = usageWindow('7d', now)
  assert.equal(w.toMs - w.fromMs, 7 * 86_400_000)
  assert.equal(w.toS, Math.floor(now / 1000))
  assert.equal(w.fromS, Math.floor((now - 7 * 86_400_000) / 1000))
  assert.equal(usageWindow('30d', now).toMs - usageWindow('30d', now).fromMs, 30 * 86_400_000)
  assert.equal(usageWindow('nope', now).kind, '24h')
  assert.ok(usageWindow('30d', now).toMs - usageWindow('30d', now).fromMs <= 31 * 86_400_000, '/usage serves 31 days at most')
})

test('dayRanges: 7 local days, oldest first, contiguous, the last one ends now; midnight is local', () => {
  const now = new Date(2026, 10, 13, 8, 41, 17).getTime()
  const d = dayRanges(now)
  assert.equal(d.length, 7)
  assert.equal(d[6].toMs, now)
  assert.equal(d[6].past, false)
  assert.ok(d.slice(0, 6).every(x => x.past))
  for (const x of d) {
    const from = new Date(x.fromMs)
    assert.deepEqual([from.getHours(), from.getMinutes(), from.getSeconds()], [0, 0, 0], 'a local midnight')
    assert.ok(x.toS > x.fromS)
  }
  for (let i = 1; i < d.length; i += 1) assert.equal(Math.floor(d[i - 1].toMs / 1000) + 1, d[i].fromS, 'no second lost between two days')
  assert.equal(new Date(d[0].fromMs).getDate(), 7)
})

test('dayRanges: a night that passes midnight and a DST change keep local days (23 h / 25 h days are what they are)', () => {
  const now = new Date(2026, 9, 26, 0, 30, 0).getTime()   // just after midnight
  const d = dayRanges(now)
  assert.equal(d[6].toMs - d[6].fromMs, 30 * 60_000)
  assert.equal(d.length, 7)
  assert.equal(new Set(d.map(x => x.fromS)).size, 7)
})

test('dailySeries: ok / none / failed are kept apart; a quiet day is no bar and no 0, a failed day is no answer', () => {
  const day = (usage, i) => ({ fromMs: i * 86_400_000, toMs: (i + 1) * 86_400_000 - 1, usage })
  const s = dailySeries([
    day(U([prof('a', { tokens: tok(100, 50), sessions: 2, apiCalls: 7 })]), 0),
    day(U([prof('a', { sessions: 0, tokens: null, models: [], reason: 'no_sessions' })]), 1),
    day(null, 2),
    day(U([prof('a', { sessions: null, tokens: null, models: null, reason: 'missing' })]), 3),
    day(U([]), 4)
  ], 'fresh')
  assert.deepEqual(s.map(x => x.state), ['ok', 'none', 'failed', 'failed', 'none'])
  assert.equal(s[0].parts.total, 150)
  assert.equal(s[0].calls, 7)
  assert.equal(s[0].sessions, 2)
  assert.equal(s[1].parts, null)
  assert.equal(s[1].sessions, 0, 'a quiet day has no sessions: that IS recorded (the base answered)')
  assert.equal(s[2].sessions, null)
  assert.equal(s[3].parts, null)
  assert.equal(dailySeries([], 'fresh').length, 0, 'empty period')
})

test('chart scale: the peak is never 0 and a recorded small total keeps a visible bar; null stays null', () => {
  assert.equal(peakOf([null, null]), 1)
  assert.equal(peakOf([]), 1)
  assert.equal(peakOf([5, null, 20]), 20)
  assert.equal(share(null, 10), null)
  assert.equal(share(0, 10), 0, 'a recorded zero draws nothing')
  assert.equal(share(1, 1000), 0.02, 'a tiny total is still visible')
  assert.equal(share(500, 1000), 0.5)
  assert.equal(share(2000, 1000), 1)
  assert.equal(share(5, 0), null)
})

/* ---------- quota ---------- */

const win = (label, used_percent, resets_at = '2026-11-13T03:30:00+00:00', scope = 'account') => ({ label, used_percent, resets_at, scope })

test('quotaOf: the windows of the providers the usage went through; one account behind several routes is ONE group', () => {
  const same = [win('Current session', 8), win('Current week', 29)]
  const payload = { providers: [{ slug: 'acme-cloud', usage: { windows: same } }, { slug: 'acme-sub', usage: { windows: same.map(w => ({ ...w })) } }, { slug: 'unrelated', usage: { windows: [win('x', 99)] } }] }
  const q = quotaOf(payload, [{ provider: 'acme-cloud' }, { provider: 'acme-sub' }])
  assert.equal(q.groups.length, 1)
  assert.deepEqual(q.groups[0].providers, ['acme-cloud', 'acme-sub'])
  assert.deepEqual(q.groups[0].windows.map(w => [w.label, w.usedPercent]), [['Current session', 8], ['Current week', 29]])
  assert.equal(q.groups[0].windows[0].resetsAtMs, Date.parse('2026-11-13T03:30:00+00:00'))
  assert.deepEqual(q.missing, [])
})

test('quotaOf: a cold cache (no usage) is MISSING, never 0 %; a window without a percentage is dropped', () => {
  const q = quotaOf({ providers: [{ slug: 'a' }, { slug: 'b', usage: { windows: [{ label: 'x', used_percent: null }] } }, { slug: 'c', usage: { windows: [] } }] }, [{ provider: 'a' }, { provider: 'b' }, { provider: 'c' }, { provider: 'gone' }])
  assert.deepEqual(q.groups, [])
  assert.deepEqual(q.missing, ['a', 'b', 'c', 'gone'])
  assert.deepEqual(quotaOf(null, [{ provider: 'a' }]).missing, ['a'])
  assert.deepEqual(quotaOf({ providers: [] }, []).groups, [])
})

test('quotaOf: several accounts stay apart (never an average); a percentage is clamped, a bad reset time is null; only label/percent/reset/scope are kept', () => {
  const payload = { providers: [{ slug: 'p', usage: { accounts: [{ id: 'secret-id', label: 'work', windows: [win('week', 120, 'not a date', 'model')] }, { id: 'x', label: '', windows: [win('week', 10)] }, { label: 'dead', windows: [] }] } }] }
  const q = quotaOf(payload, [{ provider: 'p' }])
  assert.equal(q.groups.length, 2)
  assert.equal(q.groups[0].account, 'work')
  assert.equal(q.groups[0].windows[0].usedPercent, 100)
  assert.equal(q.groups[0].windows[0].resetsAtMs, null)
  assert.equal(q.groups[0].windows[0].scope, 'model')
  assert.equal(q.groups[1].account, null)
  assert.ok(!JSON.stringify(q).includes('secret-id'), 'the account id is not kept')
})

test('nousBalance: shown only when Hermes says it is available, as Hermes formats it; otherwise nothing', () => {
  assert.equal(nousBalance(null), null)
  assert.equal(nousBalance({ ok: true, available: false }), null, 'not signed in to Nous')
  assert.equal(nousBalance({ available: true }), null, 'available with nothing to show')
  const b = nousBalance({ available: true, plan_name: 'Plus', total_spendable_display: '$12.40', renews_display: 'renews Dec 1', plan_bar: { kind: 'plan', remaining_display: '$8', total_display: '$20', spent_display: '$12', pct_used: 60, fill_fraction: 0.4 }, topup_bar: null })
  assert.equal(b.spendable, '$12.40')
  assert.equal(b.plan, 'Plus')
  assert.equal(b.planBar.fill, 0.4)
  assert.equal(b.topupBar, null)
})

/* ---------- what the usage view must not do ---------- */

const src = p => readFileSync(new URL('../../src/' + p, import.meta.url), 'utf8')

test('is read-only and gives no achievement for volume: no order, no write, no usage in the game' , () => {
  for (const f of ['ui/UsageDialog.jsx', 'data/usage.js', 'core/usage.js']) {
    const text = src(f)
    assert.ok(!/useOrders|orderflow|requestRecruit|method:\s*'POST'|'POST'/.test(text), f + ' sends no order')
  }
  for (const f of ['core/game.js', 'core/achievements.js', 'core/hud.js']) assert.ok(!/core\/usage|from '\.\/usage/.test(src(f)), f + ' does not read usage (nothing for volume)')
  const rpc = [...src('data/usage.js').matchAll(/safeRequest\('([^']+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(rpc, ['model.options', 'usage.bars'], 'only these two read-only RPCs')
  const reads = [...src('data/usage.js').matchAll(/ctx\.rest\(`([^`?]+)/g)].map(m => m[1]).sort()
  assert.deepEqual(reads, ['/usage'])
})

test('the window animates nothing (no keyframes, no transition: reduced motion and sober mode have nothing to switch off)', () => {
  const css = src('ui/usageStyles.js')
  assert.ok(!/animation|transition|@keyframes/.test(css))
})

test('no literal colour in the window (theme variables only)', () => {
  const css = src('ui/usageStyles.js') + src('ui/UsageDialog.jsx')
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(css))
})

/* ---------- edge cases ---------- */

test('quotaOf: two providers whose windows DIFFER stay two groups (only identical windows are one account)', () => {
  const payload = { providers: [{ slug: 'a', usage: { windows: [win('week', 10)] } }, { slug: 'b', usage: { windows: [win('week', 80)] } }] }
  const q = quotaOf(payload, [{ provider: 'a' }, { provider: 'b' }])
  assert.deepEqual(q.groups.map(g => [g.providers.join(','), g.windows[0].usedPercent]), [['a', 10], ['b', 80]])
})

test('rangeLabel: beyond a week the month is written (30 days: « 14 Wed → 13 Fri » was ambiguous); a week or less keeps weekday + day', () => {
  const from = new Date(2026, 9, 14, 10, 16).getTime()
  const to = new Date(2026, 10, 13, 9, 16).getTime()
  const long = rangeLabel(from, to, 'en')
  assert.match(long, /Oct/)
  assert.match(long, /Nov/)
  assert.match(long, /10:16/)
  const shortFrom = to - 86_400_000
  assert.equal(rangeLabel(shortFrom, to, 'en'), `${clockLabel(shortFrom, 'en', { day: true })} → ${clockLabel(to, 'en', { day: true })}`)
})

test('an agent\'s partly priced amount (« mixed ») is labelled an estimate like a priced one, and its tip names the price source', async () => {
  const { messages } = await import('../../src/i18n/index.js')
  for (const [code, m] of Object.entries(messages)) {
    const mark = m.usage.cost.est('1').replace(/^1 \$ /, '')   // « (estimate) » / « (estimation) » / « (estimación) »
    assert.ok(m.usage.cost.mixed('1').includes(mark), `${code}: « ${m.usage.cost.mixed('1')} » does not say ${mark}`)
    assert.ok(m.usage.cost.mixedTip(2, 'provider_models_api').includes('provider_models_api'), `${code}: the tip does not name the source`)
  }
})

test('es: the plural of « ejecución » is « ejecuciones » (no accent), in the Resources window and in the replay', () => {
  assert.equal(es.usage.boards.runs(2, 1), '2 ejecuciones, 1 con uso')
  assert.equal(es.usage.boards.runs(1, 1), '1 ejecución, 1 con uso')
  assert.match(es.replay.night.usageMissing(3), /^3 ejecuciones no tienen/)
  assert.match(es.replay.night.agentRuns(2, 5), /^2 ejecuciones · 5 llamadas/)
  assert.match(es.replay.night.agentRuns(1, null), /^1 ejecución · uso desconocido/)
})
}

// ===== usage =====
{
// Bugs reproduced in the real webapp (answers injected by CDP), each kept as a test that fails without its fix.
//    (1)  a count the agent half should never send negative (calls, sessions, a run's tokens) was drawn as is: « -9 model calls ».
//         The body's contract says a negative column is absent (`null`); the page now says absent too, never a made-up number.
//    (2)  « Replay » over the PRESENT: while the facts load (or when /replay fails) the scene is today's office, but its tag and
//         the banner said « Replay: … » as if it were the past. They now say it is not the past.
const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('/usage: a negative call or session count is absent (null), not drawn', () => {
  const body = {
    ok: true, from: 1, to: 2,
    profiles: [{ profile: 'a', sessions: -3, apiCalls: -1, tokens: { input: 5, output: 7 }, models: [{ model: 'm', provider: 'p', task: '', apiCalls: -2, tokens: { input: 1, output: 1 }, priced: false }] }],
    routes: []
  }
  const usage = toUsage(body)
  const p = usage.profiles[0]
  assert.equal(p.sessions, null)
  assert.equal(p.apiCalls, null)
  assert.equal(p.models[0].apiCalls, null)
  const rows = agentRows(usage)
  assert.equal(rows.rows[0].calls, null)
  assert.ok(rows.totals == null || rows.totals.calls == null, 'the total of calls is absent too, not -1')
  // a profile that does record its sessions, with only the calls negative: the calls are absent, the rest is kept
  const half = toUsage({ ok: true, from: 1, to: 2, profiles: [{ profile: 'b', sessions: 2, apiCalls: -1, tokens: { input: 5, output: 7 }, models: [] }], routes: [] })
  const t = agentRows(half).totals
  assert.equal(t.sessions, 2)
  assert.equal(t.calls, null)
})

test('/replay: a negative run count (calls or tokens) is absent (null)', () => {
  const body = {
    ok: true, at: 10, from: 0, to: 10,
    boards: [{ slug: 'b', since: 0, start: [], cards: {}, facts: [], runs: [{ start: 1, end: 2, profile: 'p', task: 't', outcome: 'completed', usage: { apiCalls: -4, tokens: { input: -1, output: 3, cacheRead: -9, cacheWrite: 0, reasoning: 0 } } }], silences: [] }],
    orders: [], sessions: [], crons: []
  }
  const run = toReplay(body).boards[0].runs[0]
  assert.equal(run.usage.apiCalls, null)
  assert.equal(run.usage.input, null)
  assert.equal(run.usage.cacheRead, null)
  assert.equal(run.usage.output, 3)
  assert.equal(run.usage.cacheWrite, 0, 'a recorded zero stays a zero')
})

test('the replay tag and banner say « not the past » while the facts are not there', () => {
  const page = src('src/ui/OfficePage.jsx')
  assert.match(page, /replayData \? t\('replay\.banner', replayAt\) : t\('replay\.notLoaded'\)/, 'the tag over the scene')
  assert.match(page, /replayData \? t\('replay\.bannerNote'\) : t\('replay\.notLoadedNote'\)/, 'the banner note')
  for (const lang of ['en', 'fr', 'es']) {
    const r = messages[lang].replay
    assert.ok(typeof r.notLoaded === 'string' && r.notLoaded.length > 3, `${lang} notLoaded`)
    assert.ok(typeof r.notLoadedNote === 'string' && r.notLoadedNote.length > 10, `${lang} notLoadedNote`)
    assert.doesNotMatch(r.notLoaded, /…$/, 'no bare ellipsis as the moment')
  }
})
}
