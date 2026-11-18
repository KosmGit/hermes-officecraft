/**
 * Seating: what the page decides about who sits next to whom. The engine places (src/scene/seating.js); here is
 * the choice and its inputs. Three choices, kept per machine: 'relays' (the neighbours follow the real hand-offs: computed here, no model,
 * the default once the function is ON), 'model' (the neighbour pairs the model proposed from the user's instructions, kept by the agent half; the engine chains them), 'default'
 * (by name, as without the function). The model returns pairs of names (never a whole order); it places nothing and orders nothing else.
 * Pure: no SDK, no DOM, no clock.
 */
import { relayWeights } from '../scene/seating.js'

export const SEAT_CHOICES = Object.freeze(['relays', 'model', 'default'])
export const isSeatChoice = v => SEAT_CHOICES.includes(v)
/** The instructions typed, at most this long (the agent half cuts them there too). */
export const INSTR_MAX = 280

/** The hand-offs between the roster's agents, from the boards' cards (the same count the agent half sends the model). */
export const relaysOfOffice = office => relayWeights(office?.boards || [], (office?.agents || []).map(a => a.name))

export function cleanInstructions(text) {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, INSTR_MAX)
}

export const seatingBody = (id, instructions, lang) => ({ id, instructions: cleanInstructions(instructions), lang: ['en', 'fr', 'es'].includes(lang) ? lang : 'en' })

/**
 * The seating the scene receives (src/scene/seating.js normalizeSeating takes it from here): null while the function is OFF or in sober
 * mode, or when the choice is 'default'. 'model' with a kept fiche -> its pairs (an empty list = the default order); 'model' without one, and 'relays', -> the hand-offs
 * (null when there are none: nothing to follow, the default order stays).
 */
export function seatingFor({ on, choice, fiche, weights }) {
  if (!on || choice === 'default') return null
  if (choice === 'model' && fiche && Array.isArray(fiche.pairs)) return fiche.pairs.length ? { mode: 'model', pairs: fiche.pairs } : null
  return weights && weights.length ? { mode: 'relays', weights } : null
}

/** The strongest pairs for the dialog: [{ a, b, n }], at most `limit`. */
export const topRelays = (weights, limit = 6) => (weights || []).slice(0, limit).map(([a, b, n]) => ({ a, b, n }))
