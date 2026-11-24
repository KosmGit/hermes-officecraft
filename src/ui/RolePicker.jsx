import { useId, useRef, useState } from 'react'

import { AUTO_ROLE, roleChoices } from '../core/recruit.js'
import { ROLES } from '../scene/index.js'
import { DlgIcon, DlgTip } from './DialogKit.jsx'
import { useT } from './useT.js'

/** The colour of the outfit a role first wears (the scene's own palette): a swatch tells the chips apart at a glance. */
const swatchOf = id => ROLES[id]?.looks?.[0]?.main?.[0] ?? null

/**
 * « Type de bot » of the recruitment (step 1), folded into ONE line: « Bot type: Automatic · guessed: Developer [Change] ». The default
 * suits most bots, and 23 chips on 7 rows pushed the two settings that matter (the starting point and the model) below the fold.
 * « Change » unfolds the chips in place; a click on a chip folds them again (the arrows of the keyboard only move, so the choice can be
 * explored there: Enter or « Fold » closes). One native radio group (arrows move, Tab leaves). The portrait of the preview follows the
 * choice. `guessed` = the role the office guesses from the name and the description.
 */
export function RolePicker({ value, onPick, guessed, mark = null }) {
  const t = useT()
  const id = useId()
  const [open, setOpen] = useState(false)
  const btn = useRef(null)
  const auto = value === AUTO_ROLE
  const nameOf = r => t(`role.${r || 'none'}`)
  const fold = () => { setOpen(false); setTimeout(() => btn.current?.focus(), 0) }
  return (
    <div className="oc-dg-fl" data-hire-role>
      <div className="oc-rp-line">
        <span className="oc-dg-lab" id={`${id}-lab`}>
          {t('recruit.roleField')}
          <DlgTip name={t('recruit.roleField')}>{t('recruit.roleHint')}</DlgTip>
          {mark}
        </span>
        <span className="oc-rp-cur" data-role-current>
          <b>{auto ? t('recruit.roleAuto') : nameOf(value)}</b>
          {auto && !open ? <span className="oc-dg-faint" data-role-guess>{t('recruit.roleGuessLine', nameOf(guessed))}</span> : null}
        </span>
        <button ref={btn} type="button" className="oc-dg-link" data-role-toggle aria-expanded={open} onClick={() => setOpen(v => !v)}>
          <DlgIcon id="chev" size={12} />{open ? t('recruit.roleFold') : t('recruit.roleChange')}
        </button>
      </div>
      {open ? (
        <>
          <div className="oc-dg-chips oc-rp" role="group" aria-labelledby={`${id}-lab`}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); fold() } }}>
            {roleChoices().map(r => {
              const on = value === r
              const sw = swatchOf(r)
              return (
                <label key={r} className={`oc-dg-pill oc-rp-chip ${on ? 'sel' : ''}`} data-role-chip={r}>
                  <input type="radio" name={`${id}-role`} value={r} checked={on} onChange={() => onPick(r)} onClick={e => { if (e.detail > 0) fold() }} />
                  <i className={`oc-rp-sw${r === AUTO_ROLE ? ' auto' : r === 'none' ? ' none' : ''}`} style={sw ? { background: sw } : undefined} aria-hidden="true" />
                  <span>{r === AUTO_ROLE ? t('recruit.roleAuto') : t(`role.${r}`)}</span>
                </label>
              )
            })}
          </div>
          {auto ? <small className="oc-dg-faint" data-role-guess>{guessed ? t('recruit.roleGuess', nameOf(guessed)) : t('recruit.roleGuessNone')}</small> : null}
        </>
      ) : null}
    </div>
  )
}
