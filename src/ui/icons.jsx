/**
 * The line icons of the page's actions (one 24 x 24 grid, 1.8 stroke, currentColor: no file, no emoji, no colour of their own).
 * Decorative: the label is always next to the icon or on the button (aria-label); the pixel-art icons stay for the game (PixelIcon).
 */
const PATHS = {
  replay: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></>,
  usage: <path d="M4 20V11M10 20V5M16 20v-6M2 20h20" />,
  recruit: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 14H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20.5 10H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
  ext: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  chev: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  back: <path d="m15 6-6 6 6 6" />,
  warn: <><path d="M12 3 22 21H2z" /><path d="M12 10v5M12 18v.5" /></>,
  crit: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  office: <><path d="M3 10 12 4l9 6v10H3z" /><path d="M9 20v-6h6v6" /></>,
  inbox: <><path d="M3 13 6 5h12l3 8v6H3z" /><path d="M3 13h5l1 3h6l1-3h5" /></>,
  folder: <path d="M3 6h6l2 2h10v11H3z" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17.5" cy="9" r="2.8" /><path d="M17 14.3a5.3 5.3 0 0 1 4.5 5.7" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  msg: <path d="M4 5h16v11H8l-4 4z" />,
  unlock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4-2v-4z" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  spark: <path d="m12 3 2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
  // drawn on the 24 grid like its neighbours (it was on a 16 grid: two thirds of the size, pushed to the top left of its tile)
  house: <path d="M3 20.5V10l9-6.5l9 6.5v10.5h-6.5v-6.5h-5v6.5z" fill="currentColor" stroke="none" />,
  trophy: <><path d="M7 4h10v4a5 5 0 0 1-10 0z" /><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6" /></>,
  camera: <><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13" r="4" /></>,
  flame: <path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />,
  // the campaign editor
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  play: <path d="M7 4v16l13-8z" />,
  pause: <path d="M8 5v14M16 5v14" />
}

export function Icon({ name, size = 16, className = '' }) {
  return (
    <svg className={`ux-i${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {PATHS[name] ?? null}
    </svg>
  )
}

/** Progress ring: `done` of `total` (a round track and its arc, in the colour the caller sets on the `--pc` variable). */
export function Ring({ done, total, r = 7, box = 20, stroke = 3.2, className = 'ux-ring' }) {
  const len = 2 * Math.PI * r
  const f = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
  return (
    <svg className={className} viewBox={`0 0 ${box} ${box}`} width={box} height={box} aria-hidden="true" focusable="false">
      <circle className="ux-ring-bg" cx={box / 2} cy={box / 2} r={r} fill="none" strokeWidth={stroke} />
      <circle className="ux-ring-fg" cx={box / 2} cy={box / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - f)} transform={`rotate(-90 ${box / 2} ${box / 2})`} />
    </svg>
  )
}
