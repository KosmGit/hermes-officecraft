import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

// ===== Resources: a past day is kept only once it can no longer change =====
{
/* The real module (src/data/usage.js), with the SDK and `useQuery` replaced by stand-ins: `useQuery` hands back its options, the test calls the
   `queryFn` at the instants it chooses, and `ctx.rest` is a server that counts the tokens of a session on the day it STARTED. */
const STUB = 'export const useQuery = options => options\nexport const host = { request: () => { throw new Error(\'no host\') } }'
const url = src => `data:text/javascript,${encodeURIComponent(src)}`
const REACT = 'export const useEffect = () => {}\nexport const useRef = value => ({ current: value })'
register(url(`const M = { '@hermes/plugin-sdk': ${JSON.stringify(url(STUB))}, react: ${JSON.stringify(url(REACT))} }\nexport async function resolve(s, c, next) { return M[s] ? { url: M[s], shortCircuit: true } : next(s, c) }`))
const { DAYS_KEPT, DAY_GRACE_MS, useUsageDays, usageDayTable } = await import('../../src/data/usage.js')

const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const MIN = 60_000

/** A /usage body for the sessions started in [fromS, toS] (seconds), the tokens of each session as they are at `serverMs`. */
const body = (sessions, fromS, toS, serverMs) => {
  const total = sessions.filter(x => x.startMs / 1000 >= fromS && x.startMs / 1000 <= toS).reduce((n, x) => n + x.tokensAt(serverMs), 0)
  return { ok: true, from: fromS, to: toS, attribution: 'session_start', profiles: [{ profile: 'alpha', sessions: 1, apiCalls: 1, tokens: { input: total, output: 0 }, models: [] }], routes: [], partial: [] }
}
/** The server: a clock the test moves, a request log, sessions with a start and a growth. */
function world(sessions) {
  const w = { now: 0, requests: [], sessions }
  w.ctx = { rest: async path => {
    const [, from, to] = path.match(/from=(\d+)&to=(\d+)/)
    w.requests.push({ from: Number(from), to: Number(to), at: w.now })
    return body(w.sessions, Number(from), Number(to), w.now)
  } }
  w.query = (kind = '7d') => useUsageDays(w.ctx, { enabled: true, kind, nowMs: () => w.now })
  w.run = async (q, ms) => { w.now = ms; return q.queryFn() }
  return w
}
const tokensOfDay = (days, dayStartMs) => days.find(d => d.fromMs === dayStartMs)?.usage?.profiles?.[0]?.tokens?.input

test('a session started at 23:50 and finished at 00:40: the day before is read again until it can no longer change (40 000 at 00:05, 250 000 at 06:45)', async () => {
  usageDayTable().clear()
  const start = at(2026, 11, 8, 23, 50)
  // the session grows from 40 000 tokens at 00:05 to 250 000 once it ends at 00:40
  const session = { startMs: start, tokensAt: ms => (ms < at(2026, 11, 9, 0, 40) ? 40_000 : 250_000) }
  const w = world([session])
  const q = w.query()
  const yesterday = at(2026, 11, 8, 0, 0)
  assert.equal(tokensOfDay(await w.run(q, at(2026, 11, 9, 0, 5)), yesterday), 40_000, 'the bar read at 00:05')
  assert.equal(tokensOfDay(await w.run(q, at(2026, 11, 9, 6, 45)), yesterday), 250_000, 'the bar read at 06:45 follows the server')
  // the day after, past the grace: read once more (the first read after the grace), then never again
  const before = w.requests.length
  assert.equal(tokensOfDay(await w.run(q, at(2026, 11, 10, 0, 30)), yesterday), 250_000)
  const reads = ms => w.requests.filter(r => r.from === Math.floor(yesterday / 1000) && r.at >= ms).length
  assert.ok(reads(at(2026, 11, 10, 0, 30)) >= 1, 'a last reading after the grace')
  const afterGrace = w.requests.length
  for (let k = 0; k < 20; k++) await w.run(q, at(2026, 11, 10, 6, 0) + k * MIN)
  assert.equal(w.requests.filter(r => r.from === Math.floor(yesterday / 1000)).length, w.requests.filter(r => r.from === Math.floor(yesterday / 1000) && r.at <= at(2026, 11, 10, 6, 0)).length, 'no request for the final day any more')
  assert.ok(before <= afterGrace)
})

test('the grace: the first reading of a day taken before its end + 24 h is never final', async () => {
  usageDayTable().clear()
  const w = world([{ startMs: at(2026, 11, 8, 23, 50), tokensAt: () => 5 }])
  const q = w.query()
  await w.run(q, at(2026, 11, 9, 0, 5))
  const key = Math.floor(at(2026, 11, 8, 0, 0) / 1000)
  assert.equal(usageDayTable().get(key).final, false)
  await w.run(q, at(2026, 11, 10, 0, 5))   // 5 minutes past the end of the grace
  assert.equal(usageDayTable().get(key).final, true)
  assert.ok(DAY_GRACE_MS >= 12 * 3_600_000)
})

test('400 simulated days (polled every 10 minutes): the table never holds more than DAYS_KEPT days', async () => {
  usageDayTable().clear()
  const w = world([])
  const q = w.query('30d')
  let max = 0
  for (let ms = at(2026, 1, 1, 0, 0); ms < at(2026, 1, 1, 0, 0) + 400 * 86_400_000; ms += 10 * MIN) {
    await w.run(q, ms)
    max = Math.max(max, usageDayTable().size)
  }
  assert.ok(max <= DAYS_KEPT, `at most ${DAYS_KEPT} entries, saw ${max}`)
  assert.ok(max >= 30, 'the window of 30 days is kept')
  // and the work is what it should be: past the grace a day is read once, not again (400 days: far under one read per poll per day)
  const perDay = new Map()
  for (const r of w.requests) perDay.set(r.from, (perDay.get(r.from) || 0) + 1)
  const finalDays = [...perDay.entries()].filter(([from]) => from < Math.floor(at(2026, 12, 1) / 1000) - 3 * 86_400)
  assert.ok(finalDays.length > 300)
  assert.ok(finalDays.every(([, n]) => n <= 24 * 6 + 24 * 6 + 1 + 12), 'a day is read during its own day, then until the grace is over, then no more')
})

test('never more than one /usage request per day and per minute (polls every 20 s, a window reopened, two views of the same days)', async () => {
  usageDayTable().clear()
  const w = world([{ startMs: at(2026, 11, 9, 8, 0), tokensAt: () => 1 }])
  const a = w.query('7d')
  const b = w.query('30d')
  for (let ms = at(2026, 11, 9, 9, 0); ms < at(2026, 11, 9, 11, 0); ms += 20_000) {
    await w.run(a, ms)
    if ((ms / 20_000) % 3 === 0) await w.run(b, ms)
  }
  const byDay = new Map()
  for (const r of w.requests) byDay.set(r.from, [...(byDay.get(r.from) || []), r.at])
  assert.ok(byDay.size >= 7)
  for (const [from, times] of byDay) for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= MIN, `day ${from}: two reads ${times[i] - times[i - 1]} ms apart`)
})

test('a failed day is no answer (never 0) and is asked again; a day over keeps its last reading when a new one fails', async () => {
  usageDayTable().clear()
  const w = world([{ startMs: at(2026, 11, 8, 10, 0), tokensAt: () => 7 }])
  const q = w.query('7d')
  const yesterday = at(2026, 11, 8, 0, 0)
  assert.equal(tokensOfDay(await w.run(q, at(2026, 11, 9, 9, 0)), yesterday), 7)
  const ok = w.ctx.rest
  w.ctx.rest = async path => { if (path.includes(`from=${Math.floor(yesterday / 1000)}`)) throw new Error('down'); return ok(path) }
  assert.equal(tokensOfDay(await w.run(q, at(2026, 11, 9, 9, 5)), yesterday), 7, 'the last reading stays (the day is not final yet)')
  usageDayTable().clear()
  const days = await w.run(q, at(2026, 11, 9, 9, 10))
  assert.equal(days.find(d => d.fromMs === yesterday).usage, null, 'no reading at all: no answer')
})
}
