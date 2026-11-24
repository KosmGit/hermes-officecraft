import { Icon } from './icons.jsx'
import { PixelIcon } from './PixelIcon.jsx'

/**
 * The game bar: the head of the showcase window — the office level on a bar, the numbers that make it (cards to the next level,
 * trophies, hidden ones, decision streak), the grades the agents hold, the cat's mood, the season's decor and the postcard.
 * It left the page (a strip under the header): the header's badge opens the window that holds it.
 * Every element carries `data-game`: in sober mode (game mode off) the window is never rendered, and the page has no `[data-game]`
 * left. Facts only: the level is cards done, the grades are successful runs, the cat mirrors
 * the office state, the season is a date; nothing is invented. `view` = core/vitrine.js vitrineView.
 */
export function GameBar({ game, view, t, onPostcard }) {
  const { level: lvl } = view
  const streak = game.quests?.streakDays ?? 0
  const name = t(`game.levelName.${lvl.name}`)
  return (
    <section className="oc-vh" data-game data-gamebar aria-label={t('vit.heroLabel')}>
      <span className="oc-vh-lvl" aria-hidden="true"><PixelIcon id="office" size={40} /></span>
      <div className="oc-vh-main">
        <h3 data-level={lvl.level} data-level-name={lvl.name}>{name}{' '}<small>{t('game.level', lvl.level)}</small></h3>
        <div className="oc-xp" role="progressbar" aria-label={t('game.levelTip')} aria-valuemin={0} aria-valuemax={lvl.next ?? lvl.done} aria-valuenow={lvl.done} aria-valuetext={lvl.next ? t('game.levelNext', lvl.done, lvl.next) : t('game.levelTop', lvl.done)}>
          <i style={{ width: `${lvl.pct}%` }} />
        </div>
        <ul className="oc-vh-stats" aria-label={t('vit.stats')}>
          <li>
            <b>{lvl.done}{lvl.next ? <span className="oc-faint">/{lvl.next}</span> : null}</b>
            <span>{lvl.nextName ? t('vit.toLevel', t(`game.levelName.${lvl.nextName}`)) : t('vit.cards')}</span>
          </li>
          <li data-trophy-count title={t('game.trophiesTip')}><b>{view.got}<span className="oc-faint">/{view.total}</span></b><span>{t('vit.trophies')}</span></li>
          {view.hidden ? <li data-hidden-chip title={t('game.hidden.cond')}><span>{t('vit.hidden', view.hidden)}</span></li> : null}
          {streak > 0 ? <li data-streak={streak} title={t('game.streakTip')}><PixelIcon id="flame" size={16} /><b>{streak}</b><span>{t('vit.streakDays', streak)}</span></li> : null}
        </ul>
        <ul className="oc-vh-chips" aria-label={t('vit.moods')}>
          {view.grades.map(g => (
            <li key={g.id} className="oc-vh-chip" data-grade={g.id} title={t('vit.gradesTip')}>
              <b>{g.n}</b><span>{t('vit.gradeOf', g.n, t(`game.grade.${g.id}`))}</span>
            </li>
          ))}
          <li className="oc-vh-chip" data-mascot={game.mascotMood} title={t('game.mascotTip')}>
            <Cat mood={game.mascotMood} />
            <span>{t(`game.mascot.${game.mascotMood}`)}</span>
          </li>
          {game.season ? (
            <li className="oc-vh-chip" data-season={game.season} title={t('game.seasonTip')}>
              <PixelIcon id={game.season === 'halloween' ? 'flame' : 'spark'} size={16} />
              <span>{t(`game.season.${game.season}`)}</span>
            </li>
          ) : null}
        </ul>
      </div>
      {onPostcard ? (
        <button type="button" className="oc-vh-card" data-game data-postcard title={t('game.postcardTip')} aria-label={t('game.postcard')} onClick={onPostcard}>
          <Icon name="camera" size={16} /><span>{t('game.postcard')}</span>
        </button>
      ) : null}
    </section>
  )
}

/** The cat as a 7 x 6 pixel-art chip in the text colour (no image file, no emoji): ears only when it hides, closed eyes when it sleeps. */
const CAT = ['#.....#', '##...##', '#######', '##.#.##', '###.###', '.#####.']
const CAT_SLEEP = ['#.....#', '##...##', '#######', '#######', '###.###', '.#####.']
function Cat({ mood }) {
  const art = mood === 'hide' ? CAT.slice(0, 2) : mood === 'sleep' ? CAT_SLEEP : CAT
  return (
    <svg className={`oc-cat oc-cat-${mood}`} viewBox={`0 0 7 ${art.length}`} width="14" height={art.length * 2} shapeRendering="crispEdges" fill="currentColor" aria-hidden="true" focusable="false">
      {art.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" /> : null)))}
    </svg>
  )
}
