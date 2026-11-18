/* SceneModel: the only input of the engine. Built from buildOffice() (src/core/office.js) plus a few extras;
   the engine never reads a clock, a store or the DOM, so the same model always gives the same pixels. */

import { isGatewayDegraded, isGatewayDown, isGatewayKnown } from '../core/gateway.js'
import { normalizePosters } from './art.js'
import { CARDS_MAX } from './pile.js'
import { normalizeSeating } from './seating.js'
import { normalizeStyle } from './style.js'
import { ROLES } from './wardrobe.js'

/** Decor with everything switched off (the default until the game layer fills it in). `sober: true` hides every game object. */
export const DECOR_OFF = Object.freeze({
  sober: true,
  incidentBoards: Object.freeze([]),
  achievements: Object.freeze([]),
  medals: Object.freeze([]),
  centurions: Object.freeze([]),
  streak: 0,
  lastFailMs: null,
  owlBoard: null,
  recruits: Object.freeze([]),
  season: null,
  mascotMood: null,
  style: null,  // the decorator's fiche, normalised (src/scene/style.js normalizeStyle); null = the default office
  posters: Object.freeze([])   // wall art: the posters of the real milestones (src/scene/art.js normalizePosters)
})

const SLEEPY_AFTER_MS = 86_400_000
const LIT = new Set(['working', 'active', 'waiting'])
const MOVING = new Set(['working', 'waiting', 'active'])

/** States whose desk is lit at night. */
export const isLit = state => LIT.has(state)

/** Achievement ids, whether the caller passes ids or objects with an `id`. */
export const achievementIds = decor => (decor.achievements || []).map(a => (typeof a === 'string' ? a : a?.id)).filter(Boolean)
export const hasAchievement = (decor, id) => !decor.sober && achievementIds(decor).includes(id)

/** Boards with an open incident (hidden in sober mode). */
export const incidentBoardsOf = decor => (decor.sober ? [] : decor.incidentBoards || [])

/* Gateway = electricity: only stopped / startup_failed switch the room off; starting is not an outage. */
export const gatewayStateOf = ops => ops?.gateway?.state || null
export const gatewayDown = ops => isGatewayDown(gatewayStateOf(ops))
export const gatewayDegraded = ops => isGatewayDegraded(gatewayStateOf(ops))
export const gatewayKnown = ops => isGatewayKnown(gatewayStateOf(ops))

/** The skill names of the bot a bot was copied from (`ui_meta` copiedFrom), or [] (not copied, source gone or unread: nothing is ignored). */
export function copiedSkillsOf(from, self, profiles) {
  if (typeof from !== 'string' || !from || from === self) return []
  const src = profiles?.[from]?.skills
  return Array.isArray(src) ? src.map(s => String(s?.name ?? '')).filter(Boolean) : []
}

/**
 * office: buildOffice() output, untouched. extras:
 *   nowMs (the snapshot's time), night, selected (agent name), accent [r,g,b] (selection ring),
 *   profiles { [name]: { description, skills: [{ name, category, tags }], roleOverride, recentSkill } },
 *   decor (see DECOR_OFF; absent = everything off).
 */
export function toSceneModel(office, extras = {}) {
  const nowMs = Number.isFinite(extras.nowMs) ? extras.nowMs : 0
  const profiles = extras.profiles || {}
  const agents = (office?.agents || []).map(a => {
    const p = (Object.hasOwn(profiles, a.name) && profiles[a.name]) || {}
    const last = a.lastActivityMs ?? null
    return {
      name: a.name,
      state: a.state || 'unknown',
      home: a.home || null,
      description: p.description ?? a.description ?? '',
      skills: Array.isArray(p.skills) ? p.skills : [],
      // what a bot copied at its recruitment brought along says nothing about its job (see wardrobe scoreRole); names only
      copiedSkills: copiedSkillsOf(a.officeMeta?.copiedFrom, a.name, profiles),
      roleOverride: p.roleOverride ?? (typeof a.officeMeta?.role === 'string' ? a.officeMeta.role : null),
      // made-to-measure outfits: the role the model chose in the catalogue (priority: manual > model > rules, see wardrobe roleOf)
      modelRole: typeof p.modelRole === 'string' && Object.hasOwn(ROLES, p.modelRole) ? p.modelRole : null,
      modelRoleAt: Number.isFinite(p.modelRoleAt) ? p.modelRoleAt : null,
      sleepy: a.state === 'idle' && last != null && nowMs - last > SLEEPY_AFTER_MS,
      // how many cards the bot runs and how many of them are silent, counts only (no title, no id), capped at
      // CARDS_MAX: the pile of folders on its desk (src/scene/pile.js) draws one folder per card beyond the first; the exact number stays on
      // the label. quietCards is carried, not drawn
      cards: Math.min(CARDS_MAX, Array.isArray(a.running) ? a.running.length : 0),
      quietCards: Math.min(CARDS_MAX, Array.isArray(a.quiet) ? a.quiet.length : 0),
      recentSkill: Boolean(p.recentSkill)
    }
  })
  return {
    agents,
    boards: office?.boards || [],
    ops: office?.ops ?? null,
    nowMs,
    night: Boolean(extras.night),
    // true = the first art direction, kept pixel for pixel: no light from the bays on the floor, flat walls, the 9-step
    // light. Nothing in the app sets it; tests/js/scene.test.mjs does, to keep comparing the engine's geometry with its reference.
    classic: Boolean(extras.classic),
    selected: extras.selected ?? null,
    accent: Array.isArray(extras.accent) ? extras.accent : [61, 123, 253],
    decor: { ...DECOR_OFF, ...(extras.decor || {}), style: normalizeStyle(extras.decor?.style), posters: normalizePosters(extras.decor?.posters) },   // a fiche is made safe here: unknown values are ignored
    // seating: how the pods are ordered (src/scene/seating.js); null = by name
    seating: normalizeSeating(extras.seating)
  }
}

/** True only when a fact needs motion (working / waiting / active agent, incident, gateway down, a mascot that plays or alerts). */
export function needsAnimation(model) {
  const d = model.decor || DECOR_OFF
  if ((model.agents || []).some(a => MOVING.has(a.state))) return true
  if (gatewayDown(model.ops)) return true
  if (!d.sober && (incidentBoardsOf(d).length || ['play', 'alert'].includes(d.mascotMood))) return true
  return false
}
