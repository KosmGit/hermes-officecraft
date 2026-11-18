/**
 * Sourced tooltips: each scene object cites the fact it shows and where that fact comes from.
 * Pure: returns i18n keys + arguments, the page translates them (`t(key, ...args)`). No SDK, no DOM.
 *
 *   tipOf(spot, office, ctx) -> { name: [key, ...args], fact: [key, ...args], source: [key, ...args] }
 *   badgeTip(badge)          -> same shape plus `extra`, for the model badge on an agent label
 *
 * ctx: { readMs, lang }   readMs = when the data was last read (shown as « read at 14:05 »).
 *
 * Privacy: only counts, states, slugs, card codes and model names are ever placed in a tooltip: never a card body,
 * a cron prompt or script, a message, a path, a key.
 */

import { isGatewayKnown } from './gateway.js'

/** « 14:05 » in the plugin language (24 h or 12 h as that language writes it). Empty without a time. */
export function clockText(ms, lang = 'en') {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  try {
    return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
  } catch {
    return ''
  }
}

function kanbanSource(office, slug, at) {
  return slug ? ['tip.src.kanban', slug, at] : ['tip.src.kanbanAll', (office?.boards || []).length, at]
}

export function tipOf(spot, office, ctx = {}) {
  const at = clockText(ctx.readMs, ctx.lang)
  const ops = office?.ops ?? null
  const noHalf = ['tip.src.noAgentHalf']
  switch (spot?.kind) {
    case 'board': {
      const b = (office?.boards || []).find(x => x.slug === spot.board)
      return {
        name: ['spot.board', spot.board],
        fact: ['tip.board', b?.done ?? 0, b?.total ?? 0, b?.blocked.length ?? 0],
        source: kanbanSource(office, spot.board, at)
      }
    }
    case 'gateway': {
      const state = ops?.gateway?.state
      const key = isGatewayKnown(state) ? state : 'unknown'
      return { name: ['spot.gateway'], fact: [`tip.gateway.${key}`], source: ops ? ['tip.src.gateway', at] : noHalf }
    }
    case 'mail': {
      const platforms = ops?.gateway?.platforms || []
      const ok = platforms.filter(p => p.state === 'connected').length
      const attention = platforms.filter(p => p.attention).length   // `needsAttention` of the gateway, said in the tooltip
      return {
        name: ['spot.mail'],
        fact: ops ? (platforms.length ? ['tip.mail', platforms.length, ok, platforms.length - ok] : ['tip.mailNone']) : ['tip.mailUnknown'],
        extra: attention ? ['tip.mailAttention', attention] : null,
        source: ops ? ['tip.src.gateway', at] : noHalf
      }
    }
    case 'crons': {
      const crons = ops?.crons || []
      const active = crons.filter(c => c.enabled)
      return {
        name: ['spot.crons'],
        fact: ops ? (active.length ? ['tip.crons', active.length, crons.filter(c => c.failing).length] : ['tip.cronsNone']) : ['tip.cronsUnknown'],
        source: ops ? ['tip.src.crons', at] : noHalf
      }
    }
    case 'clock':
      return { name: ['spot.clock'], fact: ['tip.clock', at], source: ['tip.src.clock'] }
    case 'desk': {
      const n = (office?.boards || []).reduce((s, b) => s + b.blocked.length, 0)
      return {
        name: ['spot.desk'],
        fact: n ? ['tip.desk', n] : ['tip.deskNone'],
        source: office?.mode === 'full' ? kanbanSource(office, null, at) : noHalf
      }
    }
    default:
      return { name: ['spot.unknown'], fact: ['tip.unknown'], source: ['tip.src.clock'] }
  }
}

/** « Card S3.2: model-large — the bot's default model: example/… », source « kanban <board>, card <code> ». */
export function badgeTip(badge) {
  return {
    name: ['tip.badgeName', badge.label || badge.name],
    fact: ['tip.badge', badge.code, badge.card, badge.default || ''],
    extra: badge.actual && badge.actual !== badge.card ? ['tip.badgeActual', badge.actual] : null,
    source: ['tip.src.card', badge.board, badge.code]
  }
}
