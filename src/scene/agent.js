/* One agent as a pixel sprite, a pose per state:
   working  types (arms alternate, blue crystal shimmers)     waiting  waves, "!" bubble
   active   hands on the desk, green crystal, blinks           stale    grey, "?" bubble (a running card went silent)
   idle     arms down (sleepy: eyes closed, head sagging)      new      grey, nothing running yet
   unknown  grey, "..." bubble (no session data: the office never guesses)
   With opt.art: idle leans back, hands behind the head, under a "zz"; stale hangs its head; new is an empty chair with the
   agent's jacket on it; working has a bubble of running dots where the page hides the crystal. */
import { E, hx, mixc, mulc } from './color.js'
import { SEAT_Z } from './constants.js'
import { Lay, Spr } from './raster.js'
import { PAL, lookOf } from './palette.js'
import { headGear, outfitOf, torsoExtras } from './wardrobe.js'

/** States drawn desaturated (nothing live to show). */
export const GREY_STATES = new Set(['new', 'stale', 'unknown'])

/**
 * `opt` (both off = the sprite of the first art direction):
 *   art     a lit edge on the side of the glazing (hair, shoulder, arm), and who waits on you stands up, arms crossed;
 *   marker  false = no state crystal above the head (the page hangs its own state dot there: the two said the same thing twice).
 */
export function agentSprite(a, facing, frame, seatKind, opt = {}) {
  const art = !!opt.art
  const up = art && a.state === 'waiting' && seatKind !== 'sofa'   // standing (the sprite is drawn STAND px higher, on its legs)
  const L = lookOf(a.name)
  const O = outfitOf(a)
  const s = new Spr()
  const st = a.state
  if (art && st === 'new') return jacket(O, facing)   // nobody has sat here yet
  const typing = st === 'working'
  const sleepy = st === 'idle' && a.sleepy
  const bob = typing && frame % 2 ? -1 : 0
  const droop = art && st === 'stale' ? (facing === 'back' ? 3 : 2) : 0   // silent = the head hangs
  const lean = art && st === 'idle' && !sleepy && seatKind !== 'sofa'   // at rest = leaning back, hands behind the head
  const hy = -22 + bob + (sleepy ? 1 : 0) + droop
  const hxo = sleepy ? 1 : 0
  const sh = O.body
  const sl = O.sleeve
  const sk = L.skin
  const hr = L.hair
  const style = O.hair ?? L.style
  const yb = y => y + (y < -12 ? bob : 0)
  if (seatKind === 'sofa') {
    s.add(new Lay().rect(-5, -5, 4, -1, O.pants).rect(-6, 0, -2, 1, O.pants).rect(1, 0, 5, 1, O.pants))
    s.add(new Lay().rect(-7, 2, -3, 3, hx('#2a2a30')).rect(1, 2, 5, 3, hx('#2a2a30')))
  }
  // torso
  const torso = new Lay()
  for (let y = -16; y <= -4; y++) {
    const w = y === -16 ? 4 : y === -15 ? 5 : 6
    torso.rect(-w, y + bob * (y < -12 ? 1 : 0), w - 1, y + bob * (y < -12 ? 1 : 0), sh[0])
  }
  torso.shade(x => (x >= 3 ? sh[1] : null))
  if (art) torso.shade((x, y) => (x <= -5 && !torso.has(x - 1, y) ? mixc(sh[0], [255, 255, 255], 0.22) : null))   // the light comes from the left
  if (facing === 'back') torso.shade((x, y) => (x === -1 && y > -14 ? sh[1] : null))
  s.add(torso)
  if (facing === 'front') s.add(new Lay().rect(-1, -16 + bob, 0, -15 + bob, sk[0]), false)
  {
    const ov = new Lay()
    const fn = facing === 'front' ? O.front : O.back
    if (fn) { fn(ov, yb); s.add(ov, false) }
    s.add(torsoExtras(O, facing), false)
  }
  // arms
  const arms = new Lay()
  const hands = new Lay()
  if (up) {
    // arms crossed on the chest (front), fists on the hips (back): it waits, it does not wave any more (the "!" bubble calls you)
    if (facing === 'front') {
      arms.rect(-8, -14, -7, -11, sl[1]).rect(6, -14, 7, -11, sl[1]).rect(-7, -11, 6, -9, sl[1])
      hands.rect(-6, -11, -5, -10, sk[0]).rect(4, -10, 5, -9, sk[0])
    } else {
      arms.rect(-9, -14, -8, -9, sl[1]).rect(7, -14, 8, -9, sl[1])
      hands.rect(-8, -8, -7, -7, sk[0]).rect(6, -8, 7, -7, sk[0])
    }
  } else if (st === 'waiting') {
    const wv = frame % 4 < 2 ? 0 : 1
    arms.rect(6, -27, 7, -13, sl[1]).rect(-8, -14, -7, -8, sl[1])
    hands.rect(5 + wv, -31, 8 + wv, -28, sk[0]).rect(-8, -7, -7, -6, sk[0])
  } else if (typing || st === 'active') {
    const l = typing && frame % 2 ? -1 : 0
    const r = typing && frame % 2 ? 0 : -1
    if (facing === 'front') {
      arms.rect(-8, -14, -7, -9, sl[1]).rect(6, -14, 7, -9, sl[1])
      hands.rect(-8, -8 + l, -6, -7 + l, sk[0]).rect(5, -8 + r, 7, -7 + r, sk[0])
    } else {
      arms.rect(-8, -14, -7, -10 + l, sl[1]).rect(6, -14, 7, -10 + r, sl[1])
      hands.rect(-8, -9 + l, -7, -8 + l, sk[0]).rect(6, -9 + r, 7, -8 + r, sk[0])
    }
  } else if (lean) {
    // elbows out on both sides of the head, the hands behind it (the head is drawn over them)
    arms.rect(-8, -15, -7, -13, sl[1]).rect(-10, -21, -9, -15, sl[1]).rect(-8, -23, -7, -21, sl[1])
    arms.rect(6, -15, 7, -13, sl[1]).rect(8, -21, 9, -15, sl[1]).rect(6, -23, 7, -21, sl[1])
    hands.rect(-6, -24, -5, -23, sk[0]).rect(4, -24, 5, -23, sk[0])
  } else {
    arms.rect(-8, -14, -7, -7, sl[1]).rect(6, -14, 7, -7, sl[1])
    hands.rect(-8, -6, -7, -5, sk[0]).rect(6, -6, 7, -5, sk[0])
  }
  s.add(arms)
  s.add(hands)
  // head
  const cx = 0 + hxo
  const head = new Lay().ell(cx - 0.5, hy, 5.6, 5.2, sk[0]).shade((x, y) => (x >= cx + 3 && y >= hy - 1 ? sk[1] : null))
  s.add(head)
  const hair = new Lay()
  const c0 = hr[0]
  if (facing === 'front') {
    if (style === 0) hair.ell(cx - 0.5, hy - 1, 6, 5.6, c0, (x, y) => y <= hy - 3 || ((x <= cx - 5 || x >= cx + 4) && y <= hy))
    if (style === 1) hair.ell(cx - 0.5, hy - 1, 6.2, 5.8, c0, (x, y) => y <= hy - 3 || x <= cx - 5 || x >= cx + 4).rect(cx - 7, hy, cx - 6, hy + 6, c0).rect(cx + 5, hy, cx + 6, hy + 6, c0)
    if (style === 2) hair.ell(cx - 0.5, hy - 1, 6, 5.6, c0, (x, y) => y <= hy - 3 || ((x <= cx - 5 || x >= cx + 4) && y <= hy - 1)).ell(cx - 0.5, hy - 8, 2.6, 2.2, c0)
    if (style === 3) hair.ell(cx - 0.5, hy - 1.5, 7, 6.6, c0, (x, y) => y <= hy - 2 || x <= cx - 5 || x >= cx + 4)
    if (style === 4) hair.ell(cx - 0.5, hy - 2, 6, 4.6, sh[1], (x, y) => y <= hy - 3).rect(cx - 7, hy - 3, cx - 1, hy - 3, sh[1])
  } else {
    hair.ell(cx - 0.5, hy - 0.5, 6, 5.6, style === 4 ? sh[1] : c0, (x, y) => y <= hy + 3)
    if (style === 1) hair.rect(cx - 5, hy + 3, cx + 4, hy + 7, c0)
    if (style === 2) hair.ell(cx - 0.5, hy - 7, 2.6, 2.2, c0)
    if (style === 3) hair.ell(cx - 0.5, hy - 1, 7, 6.4, c0, (x, y) => y <= hy + 4)
    if (style === 4) hair.rect(cx - 5, hy + 1, cx + 4, hy + 3, c0)
  }
  hair.shade((x, y) => (((x + y) & 3) === 0 && y <= hy - 3 ? hr[1] : null))
  // a lit edge on the hair, on the side of the glazing: a dark head does not melt into a dark screen or a dark chair
  if (art) hair.shade((x, y) => (x < cx && !hair.has(x - 1, y) && y <= hy + 1 ? mixc(mulc(c0, 1.55), [255, 240, 215], 0.14) : null))
  s.add(hair)
  s.add(headGear({ ...O, glasses: null }, facing, cx, hy))
  if (facing === 'back') s.add(new Lay().set(cx - 7, hy, sk[1]).set(cx + 6, hy, sk[1]), false)
  // face
  if (facing === 'front') {
    const f = new Lay()
    const eyeC = hx('#2a1d17')
    const blink = st === 'active' && frame % 14 === 0
    if (sleepy || blink || lean) f.rect(cx - 4, hy + 1, cx - 2, hy + 1, eyeC).rect(cx + 1, hy + 1, cx + 3, hy + 1, eyeC)
    else if (droop) f.set(cx - 3, hy + 2, eyeC).set(cx + 2, hy + 2, eyeC)   // looking down
    else f.rect(cx - 3, hy, cx - 3, hy + 1, eyeC).rect(cx + 2, hy, cx + 2, hy + 1, eyeC)
    f.set(cx - 5, hy + 3, hx('#ee9a8c')).set(cx + 4, hy + 3, hx('#ee9a8c'))
    if (st === 'waiting') f.rect(cx - 1, hy + 3, cx, hy + 4, hx('#7a3b33'))
    else f.rect(cx - 1, hy + 3, cx, hy + 3, hx('#a65a48'))
    s.add(f, false)
    if (O.glasses) s.add(headGear({ glasses: O.glasses }, facing, cx, hy), false)
  }
  // state crystal above the head (Sims-like): blue = working (shimmers), green = active
  if ((st === 'working' || st === 'active') && opt.marker !== false) {
    const col = st === 'working' ? hx('#4d8cff') : hx('#2fae6b')
    const dk = mulc(col, 0.68)
    const hi = mixc(col, [255, 255, 255], 0.6)
    const gy = -41 + (st === 'working' && frame % 4 >= 2 ? -1 : 0)
    const g = new Lay()
    for (let i = 0; i <= 3; i++) g.rect(-i, gy + i, i, gy + i, E(col))
    for (let i = 0; i < 4; i++) g.rect(-(3 - i), gy + 4 + i, 3 - i, gy + 4 + i, E(dk))
    const shine = st === 'working' ? (frame % 4) - 2 : -1
    g.set(shine, gy + 2, E(hi)).set(shine, gy + 3, E(hi))
    s.add(g, E(hx('#14213d')))
  }
  // who works has a bubble of running dots (where the page hides the crystal: one sign above a head, not two)
  if (art && st === 'working' && opt.marker === false) {
    const by = -41
    const W = E(PAL.white)
    s.add(new Lay().rect(-5, by, 5, by + 4, W).set(-1, by + 5, W).set(0, by + 5, W).set(0, by + 6, W), E(hx('#14213d')))
    const d = new Lay()
    for (let i = 0; i < 3; i++) d.set(-3 + i * 3, by + 2 - (frame % 4 === i ? 1 : 0), E(frame % 4 === i ? hx('#4d8cff') : hx('#9bb4dc')))
    s.add(d, false)
  }
  // who rests has a "zz" by the head (still: a room at rest never animates)
  if (art && st === 'idle' && seatKind !== 'sofa') {   // on the sofa the seat says it, and a zz would float over the coffee corner
    const Z = E(hx('#dfe6f5'))
    const z = new Lay()
    z.rect(7, -33, 9, -33, Z).set(8, -32, Z).rect(7, -31, 9, -31, Z)
    z.rect(10, -40, 13, -40, Z).set(12, -39, Z).set(11, -38, Z).rect(10, -37, 13, -37, Z)
    s.add(z, E(hx('#39425a')))
  }
  // grey "?" bubble: a running card whose worker went silent (stale, never shown as working)
  if (st === 'stale') {
    const by = -44
    const W = E(hx('#e4e7ec'))
    const Q = E(hx('#5b6472'))
    s.add(new Lay().rect(-4, by, 4, by + 9, W).set(-1, by + 10, W).set(0, by + 10, W).set(0, by + 11, W), E(hx('#2b2f36')))
    s.add(new Lay().rect(-2, by + 2, 1, by + 2, Q).set(2, by + 3, Q).set(1, by + 4, Q).set(0, by + 5, Q).set(0, by + 7, Q), false)
  }
  // grey "..." bubble: no session data about this agent (the office does not guess)
  if (st === 'unknown') {
    const by = -44
    const W = E(hx('#e4e7ec'))
    const Q = E(hx('#5b6472'))
    s.add(new Lay().rect(-4, by + 2, 4, by + 7, W).set(-1, by + 8, W).set(0, by + 8, W).set(0, by + 9, W), E(hx('#2b2f36')))
    s.add(new Lay().set(-2, by + 5, Q).set(0, by + 5, Q).set(2, by + 5, Q), false)
  }
  // "!" bubble: a decision is waiting on you
  if (st === 'waiting') {
    const by = -44 + (frame % 4 < 2 ? 0 : -1)
    const W = E(PAL.white)
    const O2 = E(PAL.warn)
    const b = new Lay().rect(-4, by, 4, by + 9, W).set(-1, by + 10, W).set(0, by + 10, W).set(0, by + 11, W)
    s.add(b, E(hx('#3a2a10')))
    s.add(new Lay().rect(-1, by + 2, 0, by + 5, O2).rect(-1, by + 7, 0, by + 7, O2), false)
  }
  if (up) {
    // on its legs: everything drawn so far moves up, the legs fill what opens under the torso
    const t = new Spr()
    for (const [k, c] of s.m) t.m.set(k - (STAND << 9), c)
    const legs = new Lay().rect(-6, -3 - STAND, 5, -2 - STAND, O.pants).rect(-6, -1 - STAND, -1, SEAT_Z - 3, O.pants).rect(1, -1 - STAND, 5, SEAT_Z - 3, O.pants)
    const body = new Spr().add(legs).add(new Lay().rect(-7, SEAT_Z - 2, -1, SEAT_Z - 1, hx('#2a2a30')).rect(1, SEAT_Z - 2, 6, SEAT_Z - 1, hx('#2a2a30')))
    for (const [k, c] of t.m) body.m.set(k, c)
    return body
  }
  return s
}
/** The jacket an agent that never had a session left on its chair, in its outfit's colours (no head: the seat is empty). */
function jacket(O, facing) {
  const sh = O.body
  const hi = mixc(sh[0], [255, 255, 255], 0.3)
  const j = new Lay()
  // sloping shoulders, a hem lower on one side: cloth over a chair's back, not a box
  for (let y = -15; y <= -5; y++) { const w = y === -15 ? 3 : y === -14 ? 4 : 5; j.rect(-w, y, w - 1, y, sh[0]) }
  j.rect(-5, -4, -1, -4, sh[0]).rect(-5, -3, -3, -3, sh[0])
  j.shade((x, y) => (x >= 2 || y >= -4 ? sh[1] : null))
  if (facing === 'front') j.rect(-1, -15, 0, -11, sh[1]).set(-2, -15, hi).set(1, -15, hi)   // open collar, lapels
  else j.rect(-2, -15, 1, -15, hi)   // the collar, from behind
  // empty sleeves: one hangs straight, the other is tucked shorter
  const sleeves = new Lay().rect(-7, -13, -6, -3, O.sleeve[1]).rect(5, -13, 6, -8, O.sleeve[1])
  return new Spr().add(j).add(sleeves)
}

/** How much higher a standing agent is drawn (art pixels). */
export const STAND = 6
