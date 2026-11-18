import { host } from '@hermes/plugin-sdk'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { MODELS_SHOWN, filterModels, priceLabel, sortProviders } from '../core/modelOptions.js'
import { loadModelOptions } from '../data/modelOptions.js'
import { DlgIcon, Notice } from './DialogKit.jsx'
import { useT } from './useT.js'

const IDLE = { state: 'idle', providers: [], inherited: { model: '', provider: '' } }

/** One read of `model.options` each time the window opens (the user may have added a provider in Hermes' settings since); never polled. */
export function useModelOptions(active) {
  const [res, setRes] = useState(IDLE)
  useEffect(() => {
    if (!active) return undefined
    let live = true
    setRes({ ...IDLE, state: 'loading' })
    loadModelOptions().then(r => { if (live) setRes(r) })
    return () => { live = false }
  }, [active])
  return res
}

/** Where a provider is added: Hermes' own settings (the office never asks for, receives or saves a key). */
const SETTINGS_PATH = '/settings?tab=providers'
const canOpenSettings = () => typeof host?.navigate === 'function'

/**
 * « Model and provider » of the recruitment, chosen from Hermes' own list instead of typed. « Inherited from the main bot » stays
 * the default and shows the model it really inherits; the providers with a key or a connection come first (marked « connected »), the
 * others are folded under « not configured »; then the models of the chosen provider with a search (name and id, full keyboard). When
 * the list cannot be read (failure, deadline, an older Hermes) the two free fields come back, with one line saying so.
 * Nothing but ids and display names is ever held here (see src/core/modelOptions.js).
 */
export function ModelPicker({ opts, model, provider, onChange, invalid = false, describedBy, inheritedTitle = null, inheritedNote = null }) {
  const t = useT()
  const id = useId()
  const listRef = useRef(null)
  const [browse, setBrowse] = useState('')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const ready = opts.state === 'ready'
  const sorted = useMemo(() => sortProviders(opts.providers), [opts.providers])
  const connected = sorted.filter(p => p.ready)
  const idle = sorted.filter(p => !p.ready)
  const inh = opts.inherited
  const inherited = !model && !provider
  const shown = connected.find(p => p.slug === browse)
    ?? connected.find(p => p.slug === provider)
    ?? connected.find(p => p.slug === inh.provider && p.models.length)
    ?? connected.find(p => p.models.length)
    ?? null
  const matches = useMemo(() => (shown ? filterModels(shown.models, query) : []), [shown, query])
  const view = matches.slice(0, MODELS_SHOWN)
  const optId = i => `${id}-o${i}`
  const pick = m => onChange({ model: m.id, provider: shown.slug })

  useEffect(() => { setActive(0) }, [query, shown?.slug])
  useEffect(() => { document.getElementById(optId(active))?.scrollIntoView?.({ block: 'nearest' }) }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(view.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setActive(0) }
    else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); setActive(Math.max(0, view.length - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (view[active]) pick(view[active]) }   // Enter picks; it never sends the form
  }

  return (
    <div className="oc-mp" data-model-picker data-model-state={opts.state}>
      <button type="button" className="oc-mp-inh" data-model-inherit aria-pressed={inherited} onClick={() => onChange({ model: '', provider: '' })}>
        <span className="oc-mp-radio" aria-hidden="true" />
        <span className="oc-mp-inht">
          <b>{inheritedTitle ?? t('recruit.model.inherited')}</b>
          <small>{inheritedNote ?? (inh.model ? `${inh.model}${inh.provider ? ` · ${inh.provider}` : ''}` : t('recruit.model.inheritedNote'))}</small>
        </span>
        <em>{t('recruit.model.default')}</em>
      </button>

      {opts.state === 'loading' ? <p className="oc-dg-busy" role="status" data-model-loading><span className="oc-dg-spin" aria-hidden="true" />{t('recruit.model.loading')}</p> : null}

      {ready ? (
        <>
          <div className="oc-dg-fl">
            <span className="oc-dg-lab" id={`${id}-pv`}>{t('recruit.provider')}</span>
            <div className="oc-dg-chips oc-mp-pvs" role="group" aria-labelledby={`${id}-pv`} data-model-providers>
              {connected.map(p => (
                <label key={p.slug} className={`oc-dg-pill oc-mp-pv ${shown?.slug === p.slug ? 'sel' : ''}`} data-provider={p.slug}>
                  <input type="radio" name={`${id}-pv`} value={p.slug} checked={shown?.slug === p.slug} onChange={() => { setBrowse(p.slug); setQuery('') }} />
                  <span>{p.name}</span>
                  <em className="oc-mp-ok">{t('recruit.model.connected')}</em>
                </label>
              ))}
            </div>
            {idle.length ? (
              <details className="oc-mp-off" data-model-unconfigured>
                <summary><DlgIcon id="chev" size={12} />{t('recruit.model.unconfigured', idle.length)}</summary>
                <ul className="oc-mp-offl" aria-label={t('recruit.model.unconfiguredList')}>
                  {idle.map(p => <li key={p.slug} aria-disabled="true">{p.name}</li>)}
                </ul>
                <p className="oc-dg-faint">{t('recruit.model.configureIn')}</p>
                {canOpenSettings() ? <button type="button" className="oc-dg-link" data-model-settings onClick={() => host.navigate(SETTINGS_PATH)}>{t('recruit.model.openSettings')}</button> : null}
              </details>
            ) : null}
          </div>

          {shown ? (
            <div className="oc-dg-fl">
              <span className="oc-dg-lab" id={`${id}-md`}>{t('recruit.modelField')}<small className="oc-mp-count" data-model-count>{t('recruit.model.count', matches.length, shown.models.length)}</small></span>
              <input type="search" data-h="model-search" role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list" aria-labelledby={`${id}-md`}
                aria-activedescendant={view.length ? optId(active) : undefined} autoComplete="off" spellCheck={false} placeholder={t('recruit.model.search')}
                value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown} />
              <ul className="oc-mp-list" id={`${id}-list`} role="listbox" aria-labelledby={`${id}-md`} ref={listRef} data-model-list>
                {view.map((m, i) => {
                  const on = model === m.id && provider === shown.slug
                  const price = priceLabel(m.price, t)
                  return (
                    <li key={m.id} id={optId(i)} role="option" aria-selected={on} data-model={m.id} className={`oc-mp-opt${on ? ' on' : ''}${i === active ? ' act' : ''}`}
                      onMouseDown={e => e.preventDefault()} onClick={() => pick(m)}>
                      <span className="oc-mp-name">{m.name && m.name !== m.id ? <><b>{m.name}</b><small>{m.id}</small></> : <b>{m.id}</b>}</span>
                      {price ? <span className="oc-mp-price">{price}</span> : null}
                      {on ? <DlgIcon id="check" size={12} /> : null}
                    </li>
                  )
                })}
                {!view.length ? <li className="oc-mp-none" role="presentation">{t(shown.models.length ? 'recruit.model.noMatch' : 'recruit.model.noModels')}</li> : null}
              </ul>
              {matches.length > view.length ? <small className="oc-dg-faint">{t('recruit.model.more', matches.length - view.length)}</small> : null}
            </div>
          ) : null}
          {!inherited ? <small className="oc-dg-faint" data-model-chosen>{t('recruit.model.chosen', model, provider)}</small> : null}
        </>
      ) : null}

      {opts.state !== 'ready' && opts.state !== 'loading' && opts.state !== 'idle' ? (
        <>
          <Notice tone="neutral" icon="alert" data-model-fallback>{t(`recruit.model.fallback.${opts.state}`)}</Notice>
          <div className="oc-dg-row2">
            <label className="oc-dg-fl"><span className="oc-dg-lab">{t('recruit.modelField')}</span><input data-h="model" value={model} placeholder={t('recruit.inherit')} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={e => onChange({ model: e.target.value, provider })} /></label>
            <label className="oc-dg-fl"><span className="oc-dg-lab">{t('recruit.provider')}</span><input data-h="provider" value={provider} placeholder={t('recruit.providerPh')} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={e => onChange({ model, provider: e.target.value })} /></label>
          </div>
          <small className="oc-dg-faint">{t('recruit.modelHint')}</small>
        </>
      ) : null}
    </div>
  )
}
