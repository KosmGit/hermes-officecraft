/**
 * The words of the queue on a bot's sheet, as data the page draws (React escapes it; nothing here is markup). Pure: `t` is the
 * page's translator, `formatSpan` the one of src/core/hud.js. The titles come from `queueView` (already one clean line, cut).
 */
import { QUEUE_NAMES_MAX, ordinalText } from './queue.js'

/** The words of what a head card is doing (`headFact` of src/core/queue.js): '' when there is nothing to say. */
export function factText(fact, t, formatSpan, nowMs) {
  switch (fact?.kind) {
    case 'waiting': return t('queue.waiting')
    case 'silent': return t('queue.silent', formatSpan(fact.ms))
    case 'working': return fact.sinceMs && nowMs > fact.sinceMs ? t('queue.working', formatSpan(nowMs - fact.sinceMs)) : t('queue.workingNow')
    case 'ready': return t('queue.ready')
    case 'triage': return t('queue.triage')
    default: return ''
  }
}

/** Who a card belongs to, in words: the bot's name, « a card with no assignee », « a card of x, who is not on the team ». */
export const whoText = (who, t) => (who.kind === 'none' ? t('queue.noAssignee') : who.kind === 'outside' ? t('queue.outside', who.name) : who.label)

/**
 * `queueView` of a queued bot -> what its sheet says, two lines at most:
 *   waits: { items: [{ who, title }], more }   « Waits for: atlas · <title> » (the first two parents, then « +N »)
 *   head:  { who, fact, rank, more, board, decide } | null   « At the head of the queue: forge, working for 12 min » (+ « 2nd behind » when the bot is not right behind it)
 *   note:  '' | a sentence when the queue is a loop or goes further than the office follows
 */
export function queueLines(view, t, nowMs, formatSpan) {
  if (view?.kind !== 'queued') return null
  const head = view.head
  const rank = head && view.position >= 2 ? t('queue.rank', ordinalText(view.position, t.lang)) : ''
  return {
    waits: { items: view.waits.map(w => ({ who: whoText(w.who, t), title: w.card.title })), more: view.waitsMore },
    head: head
      ? {
          who: whoText(head.who, t),
          fact: factText(head.fact, t, formatSpan, nowMs),
          rank,
          more: view.headsMore ? t('queue.moreHeads', view.headsMore) : '',
          board: head.card.board,
          decide: head.fact.kind === 'waiting'
        }
      : null,
    note: view.loop ? t('queue.loop') : view.capped ? t('queue.longer') : ''
  }
}

/** `queueView` of a bot others wait for -> « 3 bots wait for this card: a, b, c +N », or null. `labelOf(name)` gives the name to show. */
export function waitedLine(view, t, labelOf) {
  if (view?.kind !== 'waited') return null
  return { lead: t('queue.waited', view.count, view.capped, view.cards), names: view.bots.slice(0, QUEUE_NAMES_MAX).map(labelOf), more: view.more }
}

/** What a blocked card holds back, for the decision's card: { text, names, more, tip } or null when nothing waits behind it. */
export function holdsLine(held, t, labelOf) {
  if (!held || !(held.cards > 0)) return null
  const bots = held.bots.length > 0
  const n = bots ? held.bots.length : held.cards
  return {
    text: t('queue.holds', n, bots, held.capped),
    names: held.bots.slice(0, QUEUE_NAMES_MAX).map(labelOf),
    more: Math.max(0, held.bots.length - QUEUE_NAMES_MAX),
    tip: t('queue.holdsTip')
  }
}
