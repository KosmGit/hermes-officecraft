import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { isBusy } from '../core/orders.js'
import { AUTO_ROLE, DESCRIPTION_MAX, STARTS, TITLE_MAX, hireAgent, hireDraft, hireErrors, requestsPreview } from '../core/recruit.js'
import { roleOf } from '../scene/index.js'
import { Dlg, DlgChip, DlgIcon, DlgTip, Notice, Step } from './DialogKit.jsx'
import { ModelPicker, useModelOptions } from './ModelPicker.jsx'
import { OrderConfirm } from './Orders.jsx'
import { RolePicker } from './RolePicker.jsx'
import { AssistPanel, LeftCount, Mark, SoulStep, useRecruitAssist } from './HireAssist.jsx'
import { Portrait } from './SidePanel.jsx'
import { escapeCloses } from './dialogKeys.js'
import { useT } from './useT.js'

const RECRUIT = new Set(['recruit', 'recruitModel'])
const WORKING = new Set(['counting', 'sending', 'verifying'])

/** The bots the form can copy: the roster's desks with the skills `/history` says are their own. */
export function hireProfiles(desks, sceneProfiles) {
  return desks.map(d => ({ name: d.name, isDefault: d.isDefault, label: d.label, skills: { enabled: d.skillCount, own: sceneProfiles?.[d.name]?.skills ?? [] } }))
}

/**
 * The recruitment window: identifier, display title, role
 * description, starting point (copy a bot / new with Hermes' skills / empty), skills to keep, model + provider, live preview of the
 * character, the requests that will be sent. « Recruit » asks for the explicit confirmation (it names the new bot), then the order
 * leaves like every other one: the window closes, the bar shows the 6 s to cancel and then the outcome read back from `profiles.list`.
 * Nothing about a personality is asked or kept: a copied bot keeps its own, any other start gets the Bots tab's identity sheet.
 */
export function HireDialog({ open, onClose, profiles, orders, onSeeBot = null }) {
  const t = useT()
  const nameRef = useRef(null)
  const id = useId()
  const [reqOpen, setReqOpen] = useState(false)
  const [draft, setDraft] = useState(() => hireDraft(profiles))
  const [touched, setTouched] = useState(false)
  // the draft of the model (only when the function is on and served); nothing changes in this window without it
  const assist = useRecruitAssist({ open, draft, setDraft, profiles, lang: t.lang })
  const phase = orders.state.phase
  const o = orders.state.order
  const confirming = phase === 'confirm' && o && RECRUIT.has(o.verb)

  // the form knows the roster only once it has answered: the copy source follows it until the user picks one
  useEffect(() => {
    setDraft(d => (profiles.some(p => p.name === d.from) ? d : { ...d, from: hireDraft(profiles).from }))
  }, [profiles])

  // the order in flight closes the window (the bar of the page must stay reachable)
  useEffect(() => { if (open && WORKING.has(phase) && o && RECRUIT.has(o.verb)) onClose() }, [open, phase, o, onClose])
  useEffect(() => { if (open && !confirming) setTimeout(() => nameRef.current?.focus(), 0) }, [open, confirming])
  // the draft goes with the bot once it exists (a cancelled or failed order keeps it for another try)
  const outcome = orders.state.outcome
  useEffect(() => {
    if (outcome?.verb === 'recruit' && !outcome.cancelled && outcome.ok) { setDraft(hireDraft(profiles)); setTouched(false); assist.reset() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome])

  const errors = useMemo(() => hireErrors(draft, profiles), [draft, profiles])
  const shown = touched ? errors : errors.filter(e => e !== 'name_empty')
  const agent = useMemo(() => hireAgent(draft, profiles), [draft, profiles])
  const role = roleOf(agent).role
  // what « Automatic » would give (name and description only: the skills of a copy are ignored), whatever type is chosen
  const guessed = useMemo(() => roleOf(hireAgent({ ...draft, role: AUTO_ROLE }, profiles)).role, [draft, profiles])
  const modelOpts = useModelOptions(open && !confirming)
  const src = profiles.find(p => p.name === draft.from)
  const own = draft.start === 'clone' ? src?.skills?.own ?? [] : []
  const set = patch => { setTouched(true); assist.lift(patch); setDraft(d => ({ ...d, ...patch })) }
  const marked = field => (assist.marked(field) ? ' oc-lm-f' : '')
  const busy = isBusy(orders.state)
  const close = () => { if (!busy) onClose() }
  const submit = e => {
    e?.preventDefault()
    setTouched(true)
    if (hireErrors(draft, profiles).length) return
    orders.requestRecruit(draft)
  }
  const toggleSkill = (name, on) => set({ off: on ? draft.off.filter(x => x !== name) : [...draft.off, name] })
  const notice = orders.state.notice === 'busy' ? t('orders.refused.busy') : ''

  const nameOk = Boolean(draft.name) && !errors.some(e => e.startsWith('name_'))
  const baseSkills = Math.max(0, (src?.skills?.enabled || 0) - own.length)
  const modelSet = Boolean(draft.model || draft.provider)
  const exit = () => { if (confirming) orders.act('cancel'); else close() }

  return (
    <Dlg open={open} onClose={close} title={t('recruit.title')} icon="hire" size="l" data-hire-dialog
      chip={<DlgChip risk={confirming && o.verb === 'recruitModel' ? 'rev' : 'final'} />}
      onSubmit={confirming ? e => e.preventDefault() : submit}
      onCancel={exit}
      onKeyDown={e => { if (escapeCloses(e)) { e.preventDefault(); e.stopPropagation(); exit() } }}
      alert={confirming ? null : (
        <div id={`${id}-err`} role="alert" data-hire-errors className="oc-dg-al">
          {shown.map(e => <Notice key={e} tone="bad" icon="alert">{t(`recruit.err.${e}`)}</Notice>)}
        </div>
      )}
      start={confirming ? null : (
        <>
          <button type="button" className="oc-dg-link" aria-expanded={reqOpen} onClick={() => setReqOpen(v => !v)}>
            <DlgIcon id="chev" size={12} />{t('recruit.requests')}
          </button>
          <DlgTip name={t('recruit.submit')}>{t('recruit.riskNote')}</DlgTip>
          <LeftCount assist={assist} />
        </>
      )}
      actions={confirming ? null : (
        <>
          <button type="button" className="oc-btn" data-hire-cancel onClick={close}>{t('recruit.cancel')}</button>
          <button type="submit" className="oc-btn oc-primary" data-hire-ok aria-disabled={errors.length || busy ? true : undefined}>{nameOk ? t('recruit.submitNamed', draft.name) : t('recruit.submit')}</button>
        </>
      )}>
      {confirming ? <OrderConfirm orders={orders} /> : (
        <>
          <AssistPanel assist={assist} onSee={onSeeBot} />
          <div className="oc-dg-rc">
            <div className="oc-dg-prev" data-hire-preview>
              <Portrait agent={agent} />
              <b>{draft.title || draft.name || t('recruit.newBot')}</b>
              <span className="oc-faint" data-hire-role-label>{t(`role.${role || 'none'}`)}{draft.role === AUTO_ROLE && role ? ` · ${t('recruit.roleGuessedTag')}` : ''}</span>
              <DlgTip name={t('recruit.newBot')}>{t('recruit.previewNote')}</DlgTip>
            </div>
            <div className="oc-dg-steps">
              <Step n={1} title={t('recruit.step1')}>
                <label className="oc-dg-fl">
                  <span className="oc-dg-lab">
                    {t('recruit.name')}
                    <DlgTip name={t('recruit.name')}>{t('recruit.nameHint', draft.name || '…')}</DlgTip>
                    {nameOk ? <span className="oc-dg-ok" data-hire-free>{t('recruit.free')}</span> : null}
                    <Mark assist={assist} field="name" label={t('recruit.name')} />
                  </span>
                  <input ref={nameRef} data-h="name" className={marked('name').trim() || undefined} value={draft.name} maxLength={64} autoComplete="off" spellCheck={false} placeholder={t('recruit.namePh')}
                    aria-invalid={shown.some(e => e.startsWith('name_')) || undefined} aria-describedby={`${id}-err`}
                    onChange={e => set({ name: e.target.value })} />
                </label>
                <label className="oc-dg-fl">
                  <span className="oc-dg-lab">{t('recruit.titleField')}<Mark assist={assist} field="title" label={t('recruit.titleField')} /></span>
                  <input data-h="title" className={marked('title').trim() || undefined} value={draft.title} maxLength={TITLE_MAX} placeholder={t('recruit.titlePh')} onChange={e => set({ title: e.target.value })} />
                </label>
                <label className="oc-dg-fl">
                  <span className="oc-dg-lab">{t('recruit.description')}<DlgTip name={t('recruit.description')}>{t('recruit.descriptionTip')}</DlgTip><Mark assist={assist} field="description" label={t('recruit.description')} /></span>
                  <textarea data-h="description" className={marked('description').trim() || undefined} rows={assist.phase === 'done' ? 4 : 2} value={draft.description} maxLength={DESCRIPTION_MAX} placeholder={t('recruit.descriptionPh')} onChange={e => set({ description: e.target.value })} />
                </label>
                <RolePicker value={draft.role} onPick={r => set({ role: r })} guessed={guessed} mark={<Mark assist={assist} field="role" label={t('recruit.roleField')} />} />
              </Step>
              <Step n={2} title={<>{t('recruit.step2')} <Mark assist={assist} field="start" label={t('recruit.step2')} /></>} summary={draft.start === 'clone' && src ? t('recruit.skillsSum', own.length, baseSkills) : null}>
                <div className="oc-dg-start">
                  <span className="oc-dg-seg" role="radiogroup" aria-label={t('recruit.start')}>
                    {STARTS.map(s => (
                      <label key={s}>
                        <input type="radio" name={`${id}-start`} data-h="start" value={s} checked={draft.start === s} onChange={() => set({ start: s, off: [] })} />
                        <span>{t(`recruit.starts.${s}`)}</span>
                      </label>
                    ))}
                  </span>
                  {draft.start === 'clone' ? (
                    <select data-h="copy" value={draft.from} aria-label={t('recruit.copyOf')} onChange={e => set({ from: e.target.value, off: [] })}>
                      {profiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  ) : null}
                  <DlgTip name={t('recruit.start')}>{t(`recruit.startHint.${draft.start}`)}</DlgTip>
                </div>
                {own.length ? (
                  <div className="oc-dg-fl" data-hire-skills>
                    <span className="oc-dg-lab" id={`${id}-sk`}>
                      {t('recruit.skills', own.length)}
                      <DlgTip name={t('recruit.skills', own.length)}>{t('recruit.skillsHint', baseSkills, draft.from)}</DlgTip>
                    </span>
                    <div className="oc-dg-chips oc-dg-skills" role="group" aria-labelledby={`${id}-sk`}>
                      {own.map(s => {
                        const on = !draft.off.includes(s.name)
                        return (
                          <label key={s.name} className={`oc-dg-pill ${on ? 'on' : 'off'}`}>
                            <input type="checkbox" data-hskill={s.name} checked={on} onChange={e => toggleSkill(s.name, e.target.checked)} />
                            {on ? <DlgIcon id="check" size={12} /> : null}
                            <span>{s.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </Step>
              <details className="oc-dg-step" open={modelSet}>
                <summary>
                  <span className="oc-dg-num" aria-hidden="true">3</span>
                  <h3>{t('recruit.step3')}</h3>
                  <span className="oc-dg-sum">{modelSet ? draft.model || draft.provider : t('recruit.modelInherited')}</span>
                  <span className="chev"><DlgIcon id="chev" size={16} /></span>
                </summary>
                <div className="oc-dg-sb">
                  <ModelPicker opts={modelOpts} model={draft.model} provider={draft.provider} onChange={set} invalid={shown.includes('model_pair')} describedBy={`${id}-err`} />
                </div>
              </details>
              <SoulStep n={4} draft={draft} set={set} assist={assist} from={draft.from} />
            </div>
          </div>
          {notice ? <Notice tone="warn" icon="alert" data-refused>{notice}</Notice> : null}
          {reqOpen ? <pre className="oc-dg-pre" data-hire-requests>{errors.includes('name_empty') ? t('recruit.requestsEmpty') : requestsPreview(draft).map(([m, p]) => `${m} ${JSON.stringify(p, null, 1)}`).join('\n')}</pre> : null}
        </>
      )}
    </Dlg>
  )
}
