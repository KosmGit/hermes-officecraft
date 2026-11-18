import { Icon } from './icons.jsx'
import { PixelIcon } from './PixelIcon.jsx'

/**
 * The page with no agent at all (a fresh Hermes: no profile yet). Not a bare line of grey text: what the office is, the three
 * things that make it live, and the one button that starts it (the same recruitment window as the header's). Facts only: nothing is
 * drawn as if someone were there. `onRecruit` is null while the recruitment is not available (roster not read yet, replay on).
 */
export function EmptyOffice({ onRecruit, t }) {
  return (
    <section className="ux-void" data-empty-office aria-labelledby="oc-void-h">
      <span className="ux-void-art" aria-hidden="true"><PixelIcon id="office" size={64} /></span>
      <h2 id="oc-void-h">{t('emptyTitle')}</h2>
      <p className="lead">{t('emptyBody')}</p>
      <ol className="ux-void-steps">
        {[1, 2, 3].map(n => (
          <li key={n}>
            <span className="n" aria-hidden="true">{n}</span>
            <span>{t(`emptyStep${n}`)}</span>
          </li>
        ))}
      </ol>
      {onRecruit ? <button type="button" className="ux-b pri" data-empty-recruit onClick={onRecruit}><Icon name="recruit" size={14} />{t('recruit.open')}</button> : null}
      <p className="hint">{t('emptyCli')}</p>
    </section>
  )
}
