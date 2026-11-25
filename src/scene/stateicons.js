/* One pixel-art sign per state, 9 x 9, one colour (the page gives it: a state reads by its SHAPE, the colour only repeats it).
   A round dot said « working », « active » and « waits for you » with three hues, and nothing at all to who does not tell them apart. */
export const STATE_ICON_SIZE = 9

/** '#' = ink. working: a cog · active: a speech bubble (an open session) · waiting: « ! » · idle: « Zz » · stale: an hourglass · queued: two linked rings (a card held by another's) · new: a plug · unknown: « ? ». */
export const STATE_ICONS = Object.freeze({
  working: ['...###...', '.#.###.#.', '.#######.', '###...###', '###...###', '###...###', '.#######.', '.#.###.#.', '...###...'],
  active: ['.#######.', '#########', '#########', '#########', '#########', '.#######.', '..###....', '..##.....', '..#......'],
  waiting: ['...###...', '...###...', '...###...', '...###...', '...###...', '....#....', '.........', '...###...', '...###...'],
  idle: ['#####....', '...##....', '..##.....', '.##......', '#####....', '.....####', '......##.', '.....##..', '.....####'],
  stale: ['#########', '.#######.', '..#####..', '...###...', '....#....', '...#.#...', '..#...#..', '.#.###.#.', '#########'],
  queued: ['.........', '.........', '.###.###.', '#...#...#', '#...#...#', '#...#...#', '.###.###.', '.........', '.........'],
  new: ['..#...#..', '..#...#..', '.#######.', '.#######.', '.#######.', '..#####..', '...###...', '....#....', '....#....'],
  unknown: ['..#####..', '.##...##.', '.##...##.', '......##.', '....###..', '....#....', '.........', '....#....', '....#....']
})

/** The ink cells of a state's sign, as [x, y]; a state the office does not know reads as « unknown ». */
export function stateIconCells(state) {
  const art = STATE_ICONS[state] || STATE_ICONS.unknown
  const out = []
  art.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') out.push([x, y]) })
  return out
}
