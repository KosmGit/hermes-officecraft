/**
 * Where a popover card goes, as pure functions (src/ui/Popover.jsx wires them to the DOM; tests/js/layout-rules.test.mjs checks them by value).
 */
export const POP_GAP = 8
export const POP_EDGE = 8

/**
 * The card sits under its button, or above it when it does not fit below and there is more room above. A card taller than the room
 * it is given is capped (`maxH`) and scrolls inside itself; it never runs off the window.
 * anchor = { top, bottom, left, width } (the button), card = { w, h } (its natural size), view = { w, h } (the window).
 */
export function placePopover({ anchor, card, view }) {
  const below = view.h - anchor.bottom - POP_GAP - POP_EDGE
  const above = anchor.top - POP_GAP - POP_EDGE
  const useAbove = card.h > below && above > below
  const room = Math.max(48, Math.floor(useAbove ? above : below))
  const h = Math.min(card.h, room)
  const left = Math.min(Math.max(POP_EDGE, anchor.left + anchor.width / 2 - card.w / 2), Math.max(POP_EDGE, view.w - card.w - POP_EDGE))
  const top = useAbove ? Math.max(POP_EDGE, anchor.top - h - POP_GAP) : anchor.bottom + POP_GAP
  return { left, top, maxH: room }
}

/** A scroll closes the popover, unless it is the card's own content that scrolled (reading a long help must not dismiss it). */
export const scrollCloses = ({ insideCard }) => !insideCard
