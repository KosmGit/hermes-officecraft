/**
 * The model badge: a 7 x 7 pixel-art chip, drawn as SVG rects in the text colour (no image file, no emoji, no literal
 * colour: the page themes it through `color`). Shown next to an agent's name when its running card sets a model that is
 * not the bot's default.
 */
const ART = ['.#.#.#.', '#######', '.#...#.', '##.#.##', '.#...#.', '#######', '.#.#.#.']
const CELLS = ART.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? [x, y] : null)).filter(Boolean))

export function PixelBadge({ size = 11, ...rest }) {
  return (
    <svg className="oc-pin" viewBox="0 0 7 7" width={size} height={size} shapeRendering="crispEdges" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
      {CELLS.map(([x, y]) => <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" />)}
    </svg>
  )
}
