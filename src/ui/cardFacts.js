/**
 * The words of a bot that runs several cards, shared by the scene label, the list view, the tooltip, the screen-reader text
 * and the replay panel. Pure (no React): `tag` is src/core/hud.js `taskTag`, `t` the page's translator (useT).
 * One card, none silent: every function here returns '' / false and the label reads exactly as before.
 */
import { plusOf } from '../core/hud.js'

/** The code of a label: « API-3 +1 » (main card + the others, +9 at most); « 3 cards » when none of them has a code; else the code alone. */
export function codeText(ref, more, t) {
  if (!more) return ref || ''
  return ref ? `${ref} ${plusOf(more)}` : t('tagCards', more + 1)
}

/** « 3 cards running: API-3 50 min, API-4 3 min, … +1 » : the number and the first three, each with its time. '' for one card. */
export function cardsTip(tag, t) {
  if (!tag?.more || !tag.cards?.length) return ''
  const list = tag.cards.map(c => (c.span ? `${c.ref} ${c.span}` : c.ref)).join(', ')
  return t('tipCards', tag.more + 1, list, tag.cardsMore ? `+${tag.cardsMore}` : '')
}

/** « API-3 silent for 40 min » for each silent card (three at most, then « +N »). '' when no card is silent. */
export function quietTip(tag, t) {
  if (!tag?.quiet?.length) return ''
  const list = tag.quiet.map(q => t('quietOne', q.ref, q.span)).join(', ')
  return tag.quietMore ? `${list} +${tag.quietMore}` : list
}

/** Elapsed / waiting tag of a label, translated. */
export function tagText(tag, t) {
  if (!tag || tag.kind === 'quiet') return ''   // a bot at rest with a silent card has no tag text, only the sign and the tooltip
  if (tag.kind === 'working') return [codeText(tag.ref, tag.more, t), tag.span].filter(Boolean).join(' · ') || t('tagRunning')
  if (tag.kind === 'stale') return t('tagSilent', tag.span)
  if (tag.ref) return t('tagWaitsRef', tag.ref)
  return tag.n ? t('tagWaitsN', tag.n) : t('tagWaits')
}
