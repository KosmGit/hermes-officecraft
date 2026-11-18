/**
 * Officecraft — desktop half. Built by `npm --prefix dev run build` into desktop/plugin.js.
 * Runs in Hermes Desktop and in the browser Webapp (`hermes webapp`).
 */
import { PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, STATUSBAR_AREAS, host } from '@hermes/plugin-sdk'

import { PLUGIN_ID, ROUTE } from './constants.js'
import { resolveLocale } from './core/locale.js'
import { translate } from './core/translate.js'
import { initApprovals } from './data/approvals.js'
import { initLlm } from './data/llm.js'
import { initNotify } from './data/notify.js'
import { $languagePref, initPrefs } from './data/prefs.js'
import { messages } from './i18n/index.js'
import { OfficePage } from './ui/OfficePage.jsx'
import { SettingsPage } from './ui/SettingsPage.jsx'
import { StatusChip } from './ui/StatusChip.jsx'
import { systemLocales } from './ui/useT.js'

/** Outside React the app locale is read from <html lang>, which the app keeps in sync. */
const appLocale = () => (typeof document !== 'undefined' ? document.documentElement.lang : undefined)
const currentLang = () => resolveLocale($languagePref.get(), appLocale(), systemLocales())

export default {
  id: PLUGIN_ID,
  name: 'Officecraft',
  register(ctx) {
    initPrefs(ctx)
    initNotify(ctx)
    initLlm(ctx)
    initApprovals(ctx)
    // Also hand the bundles to the host registry (catalog tooling, ctx.i18n.t);
    // rendering uses useT(), which honours the per-plugin language override.
    ctx.i18n?.register?.(messages)

    const register = item => (item.area ? ctx.register(item) : () => {})

    // Static surfaces: their content re-renders through useT().
    register({ id: 'page', area: ROUTES_AREA, data: { path: ROUTE }, render: () => <OfficePage ctx={ctx} /> })
    register({ id: 'chip', area: STATUSBAR_AREAS?.right, order: 140, render: () => <StatusChip /> })
    if (typeof ctx.registerSettingsPage === 'function') {
      ctx.registerSettingsPage({ id: 'settings', title: 'Officecraft', icon: 'organization', render: () => <SettingsPage /> })
    }

    // Labelled surfaces take plain strings: re-register them when the language changes.
    let disposeLabels = () => {}
    let labelledIn = null
    const relabel = () => {
      const lang = currentLang()
      if (lang === labelledIn) return
      labelledIn = lang
      const t = key => translate(messages, lang, key)
      disposeLabels()
      const disposers = [
        register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: ROUTE, label: t('nav'), codicon: 'organization' } }),
        register({
          id: 'open',
          area: PALETTE_AREA,
          data: {
            id: `${PLUGIN_ID}.open`,
            label: t('paletteOpen'),
            keywords: ['officecraft', 'agents', 'profiles', 'office', 'desks', 'kanban', 'bureau', 'oficina', 'agentes'],
            run: () => host.navigate(ROUTE)
          }
        })
      ]
      disposeLabels = () => disposers.forEach(dispose => typeof dispose === 'function' && dispose())
    }
    relabel()

    const unlisten = $languagePref.listen(relabel)
    let observer = null
    if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
      observer = new MutationObserver(relabel)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    }
    ctx.onDispose?.(() => {
      unlisten()
      observer?.disconnect()
      disposeLabels()
    })
  }
}
