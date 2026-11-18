import { useId } from 'react'

import { AUTO_ROLE, roleChoices } from '../core/recruit.js'
import { ROLES } from '../scene/index.js'
import { DlgTip } from './DialogKit.jsx'
import { useT } from './useT.js'

/** The colour of the outfit a role first wears (the scene's own palette): a swatch tells the chips apart at a glance. */
const swatchOf = id => ROLES[id]?.looks?.[0]?.main?.[0] ?? null

/**
 * « Type de bot » of the recruitment (step 1): « Automatic (guessed) », every role of the wardrobe, then « Generalist ». One
 * native radio group (arrows move, Tab leaves), so the keyboard needs no code of ours. The portrait of the preview follows the choice.
 * `guessed` = the role the office guesses from the name and the description (shown on the first chip so « Automatic » is not a blind choice).
 */
export function RolePicker({ value, onPick, guessed, mark = null }) {
  const t = useT()
  const id = useId()
  return (
    <div className="oc-dg-fl" data-hire-role>
      <span className="oc-dg-lab" id={`${id}-lab`}>
        {t('recruit.roleField')}
        <DlgTip name={t('recruit.roleField')}>{t('recruit.roleHint')}</DlgTip>
        {mark}
      </span>
      <div className="oc-dg-chips oc-rp" role="group" aria-labelledby={`${id}-lab`}>
        {roleChoices().map(r => {
          const on = value === r
          const sw = swatchOf(r)
          return (
            <label key={r} className={`oc-dg-pill oc-rp-chip ${on ? 'sel' : ''}`} data-role-chip={r}>
              <input type="radio" name={`${id}-role`} value={r} checked={on} onChange={() => onPick(r)} />
              <i className={`oc-rp-sw${r === AUTO_ROLE ? ' auto' : r === 'none' ? ' none' : ''}`} style={sw ? { background: sw } : undefined} aria-hidden="true" />
              <span>{r === AUTO_ROLE ? t('recruit.roleAuto') : t(`role.${r}`)}</span>
            </label>
          )
        })}
      </div>
      {value === AUTO_ROLE ? <small className="oc-dg-faint" data-role-guess>{guessed ? t('recruit.roleGuess', t(`role.${guessed}`)) : t('recruit.roleGuessNone')}</small> : null}
    </div>
  )
}
