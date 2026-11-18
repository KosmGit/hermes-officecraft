/* What stands in the empty front of the room. The islands fill the room from the back-left corner and the common room is a
   column on the right: with two rows of islands or more, the floor in front of the sofa would be a bare triangle of boards. Pure geometry,
   shared by the base (contact shadows), the dynamic layer (the objects) and the label placer (they are decor a label avoids).
   Nothing is placed where something may stand: under the armchairs' last row, the room must leave `ROOM` tiles free. */
const ROOM = 3.4

/** -> [{ kind: 'table' | 'plant', x, y, r }] in tiles (`r`: half its footprint), from the back to the front. */
export function floorProps(layout) {
  const { lounge, X, Y } = layout
  const arms = lounge.seats.filter(s => s.kind === 'arm')
  // the common room ends under its coffee table (y 3.8), its mascot (4.15) and its label (5.2), or under the last row of armchairs
  const top = Math.max(5.9, ...arms.map(s => s.y + 1.5))
  const out = []
  const free = Y - top
  if (free >= ROOM) out.push({ kind: 'table', x: lounge.x0 + 2.1, y: top + Math.min(free / 2, 2.2), r: 1.0 })
  if (free >= 1.2) out.push({ kind: 'plant', x: X - 0.7, y: Y - 0.7, r: 0.3 })
  if (free >= ROOM + 1.6) out.push({ kind: 'plant', x: lounge.x0 + 0.5, y: Y - 0.7, r: 0.3 })
  return out
}
