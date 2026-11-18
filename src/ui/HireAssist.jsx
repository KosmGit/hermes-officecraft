import { useCallback, useEffect, useRef, useState } from 'react'

import { newId } from '../data/uuid.js'
import { workReady } from '../core/llm.js'
import { MISSION_MAX, mergeRecruit } from '../core/llmDraft.js'
import { formatWait, liftMarks, marksOf, pendingOffer, readMark, refusalOf, unreadCount } from '../core/llmAssist.js'
import { SOUL_MAX } from '../core/recruit.js'
import { useLlm, useLlmActions } from '../data/llm.js'
import { DlgIcon, DlgTip, Seg, Step } from './DialogKit.jsx'
import { useT } from './useT.js'

/**
 * The assisted side of the recruitment window. `useRecruitAssist` holds what the window needs (the mission, the call and
 * its wait, the refusal, the marks « to review », the duplicate), the parts below draw it. The model only fills the form: nothing is
 * created here; « Recruit » stays the existing order. The mission and the draft are dropped the moment the order has left (`reset`).
 */
export function useRecruitAssist({ open, draft, setDraft, profiles, lang }) {
  const query = useLlm({ enabled: open })
  const actions = useLlmActions()
  const state = query.data ?? null
  const [mission, setMission] = useState('')
  const [phase, setPhase] = useState('idle')   // idle | wait | refused | done
  const [refusal, setRefusal] = useState(null)
  const [marks, setMarks] = useState(() => new Set())
  const [overlap, setOverlap] = useState('')
  const [stopped, setStopped] = useState(false)
  const [since, setSince] = useState(0)
  const [announce, setAnnounce] = useState('')
  const token = useRef(0)
  const live = useRef({ open, draft, profiles })
  live.current = { open, draft, profiles }

  // a window that opens asks the agent half again which draft it kept (free, no model)
  useEffect(() => { if (open) actions.refresh() }, [open])   // eslint-disable-line react-hooks/exhaustive-deps

  const ready = workReady(state, 'recruit')
  const offer = ready && phase === 'idle' ? pendingOffer(state, 'recruit', Date.now()) : null

  const take = useCallback((answer, id) => {
    const { draft: d, profiles: p } = live.current
    const m = mergeRecruit(d, answer.fiche, p)
    actions.forgetDraft('recruit', id)
    if (!m.ok) {
      setRefusal(refusalOf({ answer, errors: m.errors }))
      setPhase('refused')
      setAnnounce('')
      return
    }
    setDraft(m.draft)
    setMarks(marksOf(m.filled))
    setOverlap(m.overlap)
    setRefusal(null)
    setPhase('done')
    setAnnounce('')
  }, [setDraft])   // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async () => {
    const text = mission.trim()
    if (!text || phase === 'wait') return
    const mine = ++token.current
    const id = newId()
    setStopped(false)
    setRefusal(null)
    setOverlap('')
    setSince(Date.now())
    setPhase('wait')
    setAnnounce('wait')
    const answer = await actions.recruit(id, text, lang)
    if (mine !== token.current) return          // the user stopped waiting: the call went on, its draft stays at the agent half
    if (!live.current.open) { setPhase('idle'); setAnnounce(''); return }   // the window was closed: the draft is offered when it opens again
    if (answer.kind === 'done' && answer.fiche) take(answer, id)
    else { setRefusal(refusalOf({ answer })); setPhase('refused'); setAnnounce('') }
  }
  const stop = () => { token.current++; setStopped(true); setPhase('idle'); setAnnounce('stopped') }
  const redo = () => { setPhase('idle'); setAnnounce('') }
  const useOffer = async () => {
    if (!offer) return
    const got = await actions.readDraft('recruit', offer.id)
    if (!got) { setRefusal(refusalOf({ answer: { reason: 'expired' } })); setPhase('refused'); actions.forgetDraft('recruit', offer.id); return }
    take({ fiche: got.fiche }, offer.id)
  }
  const ignoreOffer = () => { if (offer) actions.forgetDraft('recruit', offer.id) }
  const reset = () => { token.current++; setMission(''); setPhase('idle'); setRefusal(null); setMarks(new Set()); setOverlap(''); setStopped(false); setAnnounce('') }

  return {
    ready, phase, mission, setMission, refusal, overlap, stopped, since, announce, offer,
    marks, left: unreadCount(marks),
    marked: field => marks.has(field),
    lift: patch => setMarks(m => liftMarks(m, patch)),
    read: field => { setMarks(m => readMark(m, field)); setAnnounce('read') },
    ask, stop, redo, useOffer, ignoreOffer, reset
  }
}

/** « to review »: the mark of a field the model wrote; a click reads it, an edit of the field lifts it. Never blocks anything. */
export function Mark({ assist, field, label }) {
  const t = useT()
  if (!assist?.marked(field)) return null
  return (
    <button type="button" className="oc-lm-mk" data-lm-mark={field} title={t('llm.mark.title')} aria-label={t('llm.mark.label', label)} onClick={() => assist.read(field)}>
      <DlgIcon id="spark" size={12} />{t('llm.mark.text')}
    </button>
  )
}

/** The counter at the foot of the window: how many fields still wear the mark (it never stops « Recruit »). */
export function LeftCount({ assist }) {
  const t = useT()
  if (!assist?.left) return null
  return <span className="oc-lm-left" data-lm-left title={t('llm.mark.leftTitle')}>{t('llm.mark.left', assist.left)}</span>
}

function Elapsed({ since }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  return <span className="oc-lm-el" aria-hidden="true">{formatWait((now - since) / 1000)}</span>
}

/** The top of the window: ask for a draft (one call per gesture), the wait, the refusal in one line, the duplicate, the draft kept for a closed window. */
export function AssistPanel({ assist, onSee = null }) {
  const t = useT()
  if (!assist?.ready) return null
  const { phase, refusal } = assist
  const counted = refusal?.calls ? t('llm.ref.counted', refusal.calls) : ''
  const head = (
    <div className="oc-lm-ah">
      <DlgIcon id="spark" size={16} />
      <b>{phase === 'done' ? t('llm.recruit.doneHead') : phase === 'wait' ? t('llm.recruit.waitHead') : t('llm.recruit.title')}</b>
      <small className="grow">{phase === 'done' ? t('llm.recruit.doneSub') : t('llm.recruit.sub')}</small>
      <DlgTip name={t('llm.recruit.help')}>{t('llm.recruit.waitTip')}</DlgTip>
    </div>
  )
  const quoted = <p className="oc-lm-mis" data-lm-mission><span>{t('llm.recruit.mission')}</span><q>{assist.mission}</q></p>
  return (
    <div className="oc-lm-box" data-lm-assist data-phase={phase}>
      {head}
      <span className="oc-lm-sr" role="status" aria-live="polite" data-lm-announce>
        {assist.announce === 'wait' ? t('llm.recruit.waitHead') : assist.announce === 'stopped' ? t('llm.recruit.stopped') : assist.announce === 'read' ? t('llm.mark.read') : ''}
      </span>
      {phase === 'wait' ? (
        <>
          {quoted}
          <span className="oc-lm-prog" aria-hidden="true"><i /></span>
          <div className="oc-lm-ah">
            <small className="grow" data-lm-wait>{t('llm.recruit.waitTyp')} · <Elapsed since={assist.since} /></small>
            <button type="button" className="oc-btn" data-lm-stop onClick={assist.stop}>{t('llm.recruit.stop')}</button>
          </div>
        </>
      ) : phase === 'done' ? (
        <>
          {quoted}
          {assist.overlap ? (
            <div className="oc-lm-dup" role="note" data-lm-dup={assist.overlap}>
              <DlgIcon id="alert" size={16} />
              <p>{t('llm.recruit.dup', assist.overlap)}</p>
              {onSee ? <button type="button" className="oc-btn" onClick={() => onSee(assist.overlap)}>{t('llm.recruit.dupSee', assist.overlap)}</button> : null}
            </div>
          ) : null}
          <div className="oc-lm-ah"><button type="button" className="oc-btn" data-lm-redo onClick={assist.redo}>{t('llm.recruit.redo')}</button></div>
        </>
      ) : (
        <>
          {assist.offer ? (
            <div className="oc-lm-dup" role="group" aria-label={t('llm.recruit.pendingHead')} data-lm-offer>
              <DlgIcon id="spark" size={16} />
              <p><b>{t('llm.recruit.pendingHead')}</b><small>{assist.offer.atMs != null ? t('llm.recruit.pendingNote', t.ago(assist.offer.atMs)) : ''}</small></p>
              <button type="button" className="oc-btn oc-primary" data-lm-offer-use onClick={assist.useOffer}>{t('llm.recruit.pendingUse')}</button>
              <button type="button" className="oc-btn" onClick={assist.ignoreOffer}>{t('llm.recruit.pendingIgnore')}</button>
            </div>
          ) : null}
          {refusal ? (
            <div className="oc-lm-ref" role="alert" data-lm-refusal={refusal.code}>
              <DlgIcon id="alert" size={16} />
              <p>{t(`llm.ref.${refusal.code}`)}<small>{[counted, t('llm.ref.intact')].filter(Boolean).join(' · ')}</small></p>
            </div>
          ) : null}
          <div className="oc-lm-ar">
            <textarea data-lm-mission-in rows={2} value={assist.mission} maxLength={MISSION_MAX} aria-label={t('llm.recruit.missionLabel')} placeholder={t('llm.recruit.missionPh')}
              onChange={e => assist.setMission(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); assist.ask() } }} />
            <button type="button" className="oc-btn oc-primary" data-lm-ask aria-disabled={assist.mission.trim() ? undefined : true} onClick={() => { if (assist.mission.trim()) assist.ask() }}>{refusal ? t('llm.ref.again') : t('llm.recruit.ask')}</button>
          </div>
          <small className="oc-lm-count" data-lm-mission-count>{t('llm.recruit.missionCount', assist.mission.length, MISSION_MAX)}</small>
          {stoppedNote(assist, t)}
        </>
      )}
    </div>
  )
}

const stoppedNote = (assist, t) => (assist.stopped ? <small className="oc-lm-note" data-lm-stopped>{t('llm.recruit.stopped')}</small> : null)

/**
 * The SOUL written for this bot: shown and editable. A new bot sends it instead of the identity sheet; a copy takes it by default,
 * with a visible choice to keep the one of its source (then no `soul` is sent). The SOUL of the source is never read or shown.
 */
export function SoulStep({ n, draft, set, assist, from }) {
  const t = useT()
  if (typeof draft.soul !== 'string') return null
  const clone = draft.start === 'clone'
  const keep = clone && draft.soulKeep === true
  const len = draft.soul.length
  return (
    <Step n={n} title={<>{t('llm.soul.title')} <Mark assist={assist} field="soul" label={t('llm.soul.title')} /></>} summary={keep ? t('llm.soul.of', from) : t('llm.soul.written', len)} data-lm-soul>
      {clone ? (
        <Seg label={t('llm.soul.group')} attr="data-lm-soul-choice" value={keep ? 'keep' : 'new'} onPick={code => set({ soulKeep: code === 'keep' })}
          items={[['new', t('llm.soul.take')], ['keep', t('llm.soul.keep', from)]]} />
      ) : null}
      {keep ? <small className="oc-lm-note">{t('llm.soul.noteClone', from)}</small> : (
        <label className="oc-dg-fl oc-lm-soul">
          <span className="oc-dg-lab">{t('llm.soul.text')}<span className="oc-lm-count" data-lm-soul-count>{t('llm.soul.count', len)}</span></span>
          <textarea data-h="soul" rows={6} maxLength={SOUL_MAX} value={draft.soul} className={assist?.marked('soul') ? 'oc-lm-f' : undefined}
            onChange={e => set({ soul: e.target.value })} />
          {clone ? <small className="oc-lm-note">{t('llm.soul.note', from)}</small> : null}
        </label>
      )}
    </Step>
  )
}
