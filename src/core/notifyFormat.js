/**
 * The message as the agent half will send it, for the PREVIEW in the settings (a port of hermes_officecraft/notify_format.py:
 * `format_message`, `format_line`, `clean_fact`, `inert`, `split_title`, `cut`, `span`). Pure: no SDK, no DOM.
 * The words come from notifyWords.js (a generated copy); tests/js/notify-format.test.mjs runs the Python on the same facts and
 * fails on any character of difference, in the three languages and on every platform style.
 */
import { QUIET_SYMBOL, SYMBOLS, WORDS } from './notifyWords.js'

export const TITLE_MAX = 50
export const MAX_LINES = 8
export const NBSP = '\u00a0'
const ZWSP = String.fromCodePoint(0x200B)   // built, never literal: Hermes' install scanner rates a literal invisible char HIGH (tests/js/delivery.test.mjs)

const TYPE_ORDER = Object.freeze(Object.keys(SYMBOLS))
const STATES = Object.freeze({
  blocked: 'decision', approval: 'decision', silent: 'silent', stopped: 'gateway', degraded: 'gateway', cron_failed: 'cron',
  camp_ready: 'campaign', camp_done: 'campaign', review_changes: 'review', review_blocked: 'review', llm_90: 'llm_cap', llm_cap: 'llm_cap', trophy: 'trophy'
})
const TIERS = ['bronze', 'silver', 'gold']
const TASK_RE = /^t_[0-9a-f]{8}$/
const BOARD_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.@ -]{0,63}$/
const CODE_RE = /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/
const SEP_RE = /^[\s—–:|·-]+/
const CLOCK_RE = /^[0-2][0-9]:[0-5][0-9]$/
const MEDIA_RE = /(media)(\s*:)/gi
const MENTION_RE = /@(?=(?:everyone|here|channel|all)\b)/gi
const SCHEME_RE = /\b([a-z][a-z0-9+.-]{1,15}):(?=\/\/)/gi
const MAILTO_RE = /\b(mailto|tel|sms):/gi
const DOMAIN_DOT_RE = /(?<=[a-z0-9])\.(?=[a-z]{2,24}(?:[^a-z0-9]|$))/gi   // a bare domain: apps link it without a scheme
const INERT = { '<': '‹', '>': '›', '[': '(', ']': ')' }

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const chars = text => Array.from(text)   // Python counts code points, JS counts UTF-16 units
const fill = (template, vars) => template.replace(/\{(\w*)\}/g, (_, k) => String(vars[k] ?? ''))

/** One line of plain text: control, format (bidi, zero-width) and separator characters out, blanks collapsed. */
export function plain(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/[\p{Zl}\p{Zp}\p{Cc}]/gu, ' ').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim()
}

/** A title as plain text for every platform: no file attachment, no tag, no link markup, no mass mention. */
export function inert(text) {
  const t = text.replace(/[<>[\]]/g, c => INERT[c]).replace(MEDIA_RE, '$1 $2')
    .replace(MENTION_RE, `@${ZWSP}`)
    .replace(SCHEME_RE, (_, s) => `${s}:${ZWSP}`)
  return t.replace(MAILTO_RE, (_, s) => `${s}${ZWSP}:`).replace(DOMAIN_DOT_RE, `.${ZWSP}`)
}

/** How a platform renders: `esc` makes any dynamic text literal, `bold` wraps ours. Kinds: plain, html (Telegram), markdown (Discord). */
export function styleFor(platform) {
  const kind = platform === 'telegram' ? 'html' : platform === 'discord' ? 'markdown' : 'plain'
  return {
    kind,
    esc: text => (kind === 'html' ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : kind === 'markdown' ? text.replace(/([\\*_~`|>#])/g, '\\$1') : text),
    bold: text => (kind === 'html' ? `<b>${text}</b>` : kind === 'markdown' ? `**${text}**` : text)
  }
}

/** The preview's style: a literal text (nothing escaped) whose bold parts are marked by \u0001 … \u0002, so the page can draw them bold. */
export function previewStyle(platform) {
  const bolds = platform === 'telegram' || platform === 'discord'
  return { kind: 'preview', esc: text => text, bold: text => (bolds ? `\u0001${text}\u0002` : text) }
}

export function splitTitle(title) {
  const text = plain(title)
  const at = text.indexOf(' ')
  const head = at < 0 ? text : text.slice(0, at)
  const rest = at < 0 ? '' : text.slice(at + 1)
  if (CODE_RE.test(head) && head.length <= 16 && (/\d/.test(head) || SEP_RE.test(rest) || !rest)) return [head, rest.replace(SEP_RE, '').trim()]
  return [null, text]
}

export function cut(text, limit = TITLE_MAX) {
  const all = chars(text)
  if (all.length <= limit) return text
  let head = all.slice(0, limit - 1)
  const at = head.lastIndexOf(' ')
  if (at >= Math.floor(limit / 2)) head = head.slice(0, at)
  return `${head.join('').replace(/[ ,;:.—–\-·(]+$/u, '')}…`
}

export function clock(ts) {
  if (!isNum(ts)) return '?'
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function span(seconds, lang = 'en') {
  const w = WORDS[lang] || WORDS.en
  const sp = lang === 'fr' ? NBSP : ' '
  const s = isNum(seconds) && seconds >= 0 ? Math.trunc(seconds) : 0
  if (s >= 86400) return `${Math.floor(s / 86400)}${sp}${w.d}`
  const m = Math.floor((s % 3600) / 60)   // « 3 h 5 min » or « 5 h », never « 3 h 05 » (a time of day after « depuis »)
  if (s >= 3600) return `${Math.floor(s / 3600)}${sp}${w.h}${m ? `${sp}${m}${sp}${w.min}` : ''}`
  return s >= 60 ? `${Math.floor(s / 60)}${sp}${w.min}` : `${s}${sp}${w.s}`
}

const num = (value, lang) => {
  const n = isNum(value) ? Math.round(value * 100) / 100 : 0
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', (WORDS[lang] || WORDS.en).dec)
}
const money = (value, lang) => (WORDS[lang] || WORDS.en).dollar.replace('{}', num(value, lang)).replace(/ /g, lang !== 'en' ? NBSP : ' ')
const int = (value, dflt = 0, top = 1_000_000) => (isNum(value) ? Math.min(Math.max(Math.trunc(value), 0), top) : dflt)
const age = (fact, now) => (isNum(fact.since) && isNum(now) ? Math.max(now - fact.since, 0) : null)

/** The fact re-validated, whitelisted fields only (same rules as `clean_fact`): any other key is never read. */
export function cleanFact(fact) {
  if (!fact || typeof fact !== 'object' || !(fact.state in STATES)) return null
  const out = { state: fact.state, type: STATES[fact.state] }
  if (typeof fact.board === 'string' && BOARD_RE.test(fact.board)) out.board = fact.board
  if (typeof fact.task === 'string' && TASK_RE.test(fact.task)) out.task = fact.task
  if (typeof fact.agent === 'string' && NAME_RE.test(fact.agent)) out.agent = fact.agent
  for (const key of ['title', 'name']) out[key] = typeof fact[key] === 'string' ? fact[key] : ''
  for (const key of ['span', 'since', 'start', 'end', 'count', 'pct', 'used', 'cap']) if (isNum(fact[key]) && Math.abs(fact[key]) < 1e12) out[key] = fact[key]
  if (Number.isInteger(fact.phase) && fact.phase >= 0 && fact.phase <= 7) out.phase = fact.phase
  if (fact.kind === 'usd' || fact.kind === 'calls') out.kind = fact.kind
  if (TIERS.includes(fact.tier)) out.tier = fact.tier
  return out
}

function headText(f, style) {
  const [code, rest0] = splitTitle(f.title)
  const rest = cut(inert(rest0))
  const parts = []
  if (code) parts.push(style.bold(style.esc(code)))
  if (rest) parts.push(style.esc(rest))
  return parts.join(' ')
}

/** ONE fact as a short line, without bullet. */
export function formatLine(fact, lang = 'en', { now = null, multiProject = false, style = styleFor(null) } = {}) {
  const w = WORDS[lang] || WORDS.en
  const f = cleanFact(fact)
  if (!f) return ''
  const { state } = f
  const { esc } = style
  const ago = age(f, now)
  if (state === 'stopped') {
    const dur = 'start' in f && 'end' in f && f.end >= f.start ? f.end - f.start : 0
    return fill(w.stopped, { start: clock(f.start), end: clock(f.end), span: span(dur, lang) })
  }
  if (state === 'approval') return w.approval
  if (state === 'degraded') {
    const name = plain(f.title)
    return fill(w.degraded, { name: NAME_RE.test(name) ? esc(inert(name)) : '?' })
  }
  if (state === 'llm_90' || state === 'llm_cap') {
    const calls = f.kind === 'calls'
    const key = `${calls ? 'llm_calls_' : 'llm_'}${state === 'llm_90' ? '90' : 'cap'}`
    const show = calls ? v => String(int(v)) : v => money(v, lang)
    return fill(w[key], { pct: w.pct.replace('{}', String(int(f.pct, 0, 999))).replace(/ /g, lang !== 'en' ? NBSP : ' '), used: show(f.used), cap: show(f.cap) })
  }
  let parts
  if (state === 'camp_ready' || state === 'camp_done') {
    const name = cut(inert(plain(f.name)), 40)
    const n = int(f.count)
    let what
    if (state === 'camp_done') what = fill(w.camp_done, { n })
    else if ('phase' in f && f.phase > 0) {
      const pname = cut(inert(plain(f.title)), 30)
      what = fill(w.camp_phase, { letter: String.fromCharCode(65 + f.phase), name: pname ? ` (${esc(pname)})` : '', n })
    } else what = fill(w.camp_ready, { n })
    parts = [name ? style.bold(esc(name)) : '', what]
  } else if (state === 'trophy') {
    const name = cut(inert(plain(f.name)), 40)
    parts = [name ? style.bold(esc(name)) : '', 'tier' in f ? fill(w.tier, { tier: w[f.tier] }) : '']
  } else if (state === 'cron_failed') {
    const name = cut(inert(plain(f.title)), 40)
    parts = [name ? style.bold(esc(name)) : '', 'agent' in f ? esc(inert(f.agent)) : '', ago !== null ? fill(w.ago, { span: span(ago, lang) }) : '']
  } else {
    parts = [headText(f, style), 'agent' in f ? esc(inert(f.agent)) : '']
    if (state === 'silent') {
      const seconds = ago !== null ? ago : f.span
      parts.push(seconds !== undefined && seconds !== null ? fill(w.since, { span: span(seconds, lang) }) : '')
    } else if (state === 'blocked') parts.push(ago !== null ? fill(w.since, { span: span(ago, lang) }) : '')
    else if (state === 'review_changes') parts.push(ago !== null ? fill(w.ago, { span: span(ago, lang) }) : '')
    else if (state === 'review_blocked') parts.push(w.review_blocked)
  }
  if (multiProject && 'board' in f) parts.push(esc(f.board))
  return parts.filter(Boolean).join(' · ')
}

const countPhrase = (kind, n, lang, short = false) => {
  const w = WORDS[lang] || WORDS.en
  if (kind === 'decision' && short) return fill(w[n === 1 ? 'decision_s1' : 'decision_sn'], { n })
  return fill(w[`${kind}${n === 1 ? '1' : 'n'}`], { n })
}

/**
 * The message for one recipient. `quiet = { from, to, resolved }` makes it the summary of the end of the quiet hours; `test` prefixes
 * the first line with `[test <label>]`. `style` is `styleFor(platform)` (what is sent) or `previewStyle(platform)` (what the page draws).
 */
export function formatMessage(facts, lang = 'en', { label = 'Officecraft', platform = null, style = null, now = null, quiet = null, test = false } = {}) {
  const w = WORDS[lang] || WORDS.en
  const st = style || styleFor(platform)
  const cleaned = facts.map(cleanFact).filter(Boolean)
  const projects = []
  for (const f of cleaned) if (typeof f.board === 'string' && BOARD_RE.test(f.board) && !projects.includes(f.board)) projects.push(f.board)
  const multi = projects.length > 1
  const byType = Object.fromEntries(TYPE_ORDER.map(t => [t, cleaned.filter(f => f.type === t)]))
  const types = TYPE_ORDER.filter(t => byType[t].length)
  const where = projects.length === 1 ? ` · ${st.esc(projects[0])}` : multi ? ` · ${fill(w.projects, { n: projects.length })}` : ''
  let head
  if (quiet) {
    const start = typeof quiet.from === 'string' && CLOCK_RE.test(quiet.from) ? quiet.from : '?'
    const end = typeof quiet.to === 'string' && CLOCK_RE.test(quiet.to) ? quiet.to : '?'
    const resolved = int(quiet.resolved)
    head = `${QUIET_SYMBOL} ${st.bold(fill(w.quiet, { start, end, n: cleaned.length }) + (resolved ? fill(resolved === 1 ? w.resolved1 : w.resolved, { m: resolved }) : ''))}${where}`
  } else if (types.length === 1) head = `${SYMBOLS[types[0]]} ${st.bold(countPhrase(types[0], byType[types[0]].length, lang))}${where}`
  else head = st.bold(cleaned.length === 1 ? w.facts1 : fill(w.factsn, { n: cleaned.length })) + where
  if (test) head = `[test ${label}] ${head}`
  const lines = [head]
  let shown = 0
  for (const t of types) {
    const group = byType[t]
    const block = []
    for (const f of group) {
      if (shown >= MAX_LINES) break
      const line = formatLine(f, lang, { now, multiProject: multi, style: st })
      if (line) { block.push(line); shown += 1 }
    }
    if ((types.length > 1 || quiet) && block.length) lines.push(`${SYMBOLS[t]} ${st.bold(countPhrase(t, group.length, lang, true))}`)
    lines.push(...block)
  }
  const extra = cleaned.length - shown
  if (extra > 0) lines.push(fill(w.more, { n: extra }))
  return lines.join('\n')
}
