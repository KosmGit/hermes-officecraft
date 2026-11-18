/**
 * Thought bubbles: a short line above an agent AT WORK that sums up what it really does (the agent half builds it from the
 * role, the title of the running card and the names of the tools used, never their content).
 * The rules of the page, pure and tested by value: who is at work, when the model may be asked (at most once a minute, page visible, at
 * least one agent at work), what is shown (never for an agent that does not work, never from a fiche older than the agent's work,
 * never in sober mode, never while the page is hidden). No SDK, no DOM, no clock (`nowMs` is given).
 */
import { ROLES, roleOf, wireRole } from '../scene/wardrobe.js'
import { dict } from './dict.js'

/** The model is asked at most once a minute in all (the agent half refuses sooner: `too_soon`), hence at most once a minute per agent. */
export const THOUGHT_EVERY_MS = 60_000
/** A bubble is text up to 60 characters, one line, no markup or link (hermes_officecraft/llm.py `_valid_thought`). */
export const THOUGHT_MAX = 60
// same refusals as the agent half: markup, links (with or without « :// »: javascript:, MEDIA:/..., evil.example/pay),
// control and invisible characters (line/paragraph separators and word joiners included, as in llm.py _CTRL_RE)
const BAD = /[<>]|:\/\/|www\.|(?<![a-z0-9])[a-z][a-z0-9+.-]{1,31}:(?=\S)|[a-z0-9-]+\.[a-z]{2,}\/|[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/i

/** A bubble's text the page accepts (the agent half already checked; the page checks again before drawing). */
export const isThought = text => typeof text === 'string' && text.length >= 1 && text.length <= THOUGHT_MAX && text === text.trim() && !BAD.test(text)

/** The agents at work and the role each wears: { name: roleId }. A working agent with no role in the catalogue is not asked (no role is invented). */
export function thoughtRoles(agents) {
  const out = dict()
  for (const a of agents || []) {
    if (a?.state !== 'working') continue
    const r = wireRole(roleOf(a).role)   // the agent half knows 16 roles: a role added since is sent as its closest one
    if (r && Object.hasOwn(ROLES, r)) out[a.name] = r
  }
  return out
}

/**
 * Whether the page may ask the model for bubbles now: the function is ON and ready, the page is visible, someone works, and the last
 * request is at least a minute old. -> { ask, why } with `why` ∈ 'off' | 'hidden' | 'idle' | 'soon' | null.
 */
export function thoughtGate({ nowMs, lastMs, visible, ready, roles }) {
  if (!ready) return { ask: false, why: 'off' }
  if (!visible) return { ask: false, why: 'hidden' }
  if (!Object.keys(roles || {}).length) return { ask: false, why: 'idle' }
  if (Number.isFinite(lastMs) && nowMs - lastMs < THOUGHT_EVERY_MS) return { ask: false, why: 'soon' }
  return { ask: true, why: null }
}

/** The body of `POST /llm/thoughts`: the roles of the agents at work (the agent half finds their card and tools itself). */
export const thoughtsBody = (id, roles, lang) => ({ id, roles: { ...roles }, lang: ['en', 'fr', 'es'].includes(lang) ? lang : 'en' })

/**
 * The bubbles to draw: { [name]: text } for the agents AT WORK now whose fiche carries a valid text; function OFF, sober mode or a hidden
 * page -> {}. An agent that rests, waits or sleeps has none (a bubble kept by the server for five minutes is not shown once the work ends).
 */
export function thoughtsShown(state, agents, { sober = false, visible = true } = {}) {
  if (sober || !visible || !state?.settings?.features?.thoughts) return dict()
  const working = new Set((agents || []).filter(a => a?.state === 'working').map(a => a.name))
  const out = dict()
  for (const t of state.fiches?.thoughts || []) if (working.has(t.name) && isThought(t.text)) out[t.name] = t.text
  return out
}
