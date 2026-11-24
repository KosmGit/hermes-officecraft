import { useQuery, useQueryClient } from '@hermes/plugin-sdk'
import { newId as randomUuid } from './uuid.js'
import { useCallback, useEffect, useReducer, useRef } from 'react'

import { PLUGIN_ID } from '../constants.js'
import { approvalTarget } from '../core/approvals.js'
import { guardTarget, readCampaign, summary, toRequest } from '../core/campaign.js'
import { JOURNAL_FETCH, classifyError, initialOrderState, orderBody, orderReducer, readAnswer, recruitTarget, reviseTarget, targetOf, toJournal } from '../core/orders.js'
import { clearLeft, countdownWait, hiddenCancel, leftBehind, leftOutcome, leftSent, liveRead, peekLeft, rememberLeft, rereadOf, routeOf } from '../core/orderflow.js'
import { isGone, sendApproval } from './approvals.js'
import { depart, verifyRecruit, verifyRevise } from './recruit.js'
import { LIVE_KEY, ROSTER_KEY } from './queries.js'

export const ORDERS_KEY = [PLUGIN_ID, 'orders']
/** The journal changes when an order is sent (refetched then) or by another window: once every 30 s is plenty. */
export const JOURNAL_POLL_MS = 30_000
const SEND_TIMEOUT_MS = 15_000
/** A campaign of 40 cards is written in about a quarter of a second, read back, and its name checked: 30 s is a generous ceiling. */
const CAMPAIGN_TIMEOUT_MS = 30_000

/** Audit journal of the orders (`GET /orders`), only when /health says the agent half serves it. A failed read keeps the last good one. */
export function useOrderJournal(ctx, enabled, intervalMs = JOURNAL_POLL_MS) {
  return useQuery({
    queryKey: ORDERS_KEY,
    queryFn: async () => {
      const journal = toJournal(await ctx.rest(`/orders?limit=${JOURNAL_FETCH}`, { timeoutMs: 8_000 }), JOURNAL_FETCH)
      if (!journal.ok) throw new Error('orders journal read failed')
      return journal
    },
    enabled: Boolean(enabled) && typeof ctx?.rest === 'function',
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,
    staleTime: intervalMs,
    retry: 1,
    retryDelay: 5_000
  })
}

/**
 * The order in progress, driven by the pure machine of src/core/orders.js. This hook owns the effects only:
 *   - the countdown (a timeout to the next second, by the deadline: a late timer never makes the window longer or shorter),
 *   - the departure (POST /orders, once per order id),
 *   - the re-read (the route's answer already is the database read back; /live and the journal are then refreshed, and only then
 *     does the outcome show).
 * A page that is hidden during the countdown cancels the order: nothing leaves a window nobody is watching.
 */
export function useOrders(ctx, { audit: auditOn = false, replay = false } = {}) {
  // an order the user lost by leaving the page is said once on the way back (module memory of the tab, cleared by the effect below)
  const [state, dispatch] = useReducer(orderReducer, leftOutcome(peekLeft()), initialOrderState)
  const queryClient = useQueryClient()
  const sent = useRef(new Set())
  const latest = useRef({})   // what the re-read needs without restarting it when the host re-renders
  latest.current = { ctx, auditOn, answer: state.answer, state, replay }

  // the line « order not sent » is shown from the first render and said once (the memory is cleared as soon as the page is
  // mounted); leaving the page while the 6 s window runs kills the window (nothing is ever sent from it): the order is remembered
  // in the memory of the tab, to be said when the page comes back.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    clearLeft()
    // an order still counting is lost; one that already left (sending, verifying) is said « sent, outcome not read »
    return () => { mounted.current = false; rememberLeft(leftBehind(latest.current.state) || leftSent(latest.current.state)) }
  }, [])

  // countdown
  useEffect(() => {
    if (state.phase !== 'counting') return undefined
    // the shown second drops when the time left reaches (left - 1) s: wake up then, not by a fixed 1 s step
    const wait = countdownWait(state, Date.now())   // src/core/orderflow.js
    const timer = setTimeout(() => dispatch({ type: 'tick', now: Date.now() }), wait)
    return () => clearTimeout(timer)
  }, [state.phase, state.sendAt, state.left])

  // nobody watching: cancel
  useEffect(() => {
    if (state.phase !== 'counting') return undefined
    const onHide = () => { const act = hiddenCancel(latest.current.state, document.hidden); if (act) dispatch(act) }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [state.phase])

  // departure
  useEffect(() => {
    if (state.phase !== 'sending' || !state.order || sent.current.has(state.order.id)) return
    sent.current.add(state.order.id)
    const order = state.order
    ;(async () => {
      if (routeOf(order) === 'recruit') {
        // a recruitment: through the host (`profiles.create` / `profiles.configure`), the journal line is written after the re-read
        return depart(order, { mounted: () => mounted.current, dispatch, ctx, auditOn })
      }
      if (routeOf(order) === 'revise') {
        // `profiles.configure { description }` through the host; the description is read back from `profiles.list` after
        return depart(order, { mounted: () => mounted.current, dispatch, ctx, auditOn })
      }
      if (routeOf(order) === 'approval') {
        // an approval: through the host (the session's own authority), not through the agent half; the journal line is the page's
        return dispatch(await sendApproval(ctx, order, auditOn))
      }
      try {
        // a campaign is written by its own route (one transaction, read back, all or nothing); a launch / cancel goes by /orders like any card order
        const route = routeOf(order) === 'campaign' ? '/campaign' : '/orders'
        const raw = await ctx.rest(route, { method: 'POST', body: orderBody(order), timeoutMs: route === '/campaign' ? CAMPAIGN_TIMEOUT_MS : SEND_TIMEOUT_MS })
        const answer = route === '/campaign' ? readCampaign(raw) : readAnswer(raw)
        if (answer) dispatch({ type: 'answered', answer })
        else dispatch({ type: 'failed', reason: 'unknown_outcome' })
      } catch (error) {
        dispatch({ type: 'failed', reason: classifyError(error) })
      }
    })()
  }, [state.phase, state.order, ctx, auditOn])

  // re-read: /live (the board as it is now) and the journal, then show the outcome.
  // An approval is re-read from its own queue (`approval.pending`): it counts as done only when the request is gone from it.
  useEffect(() => {
    if (state.phase !== 'verifying') return undefined
    let live = true
    const startedAt = Date.now()
    const order = state.order
    ;(async () => {
      if (rereadOf(order) === 'queue') {
        const [gone] = await Promise.all([isGone(order), queryClient.refetchQueries({ queryKey: ORDERS_KEY })])
        if (live) dispatch({ type: 'read', liveOk: true, gone })
        return
      }
      if (rereadOf(order) === 'roster' && routeOf(order) === 'revise') {
        const res = await verifyRevise(latest.current.ctx, order, latest.current.answer, latest.current.auditOn)
        await Promise.allSettled([queryClient.refetchQueries({ queryKey: ROSTER_KEY }), queryClient.refetchQueries({ queryKey: ORDERS_KEY })])
        if (live) dispatch({ type: 'read', liveOk: true, present: res.present, audited: res.audited })
        return
      }
      if (rereadOf(order) === 'roster') {
        // the bot must be listed by `profiles.list` before the outcome shows; the roster (the desks) is refreshed in the same breath
        const res = await verifyRecruit(latest.current.ctx, order, latest.current.answer, latest.current.auditOn)
        await Promise.allSettled([queryClient.refetchQueries({ queryKey: ROSTER_KEY }), queryClient.refetchQueries({ queryKey: ORDERS_KEY })])
        if (live) dispatch({ type: 'read', liveOk: true, present: res.present, audited: res.audited })
        return
      }
      await Promise.allSettled([queryClient.refetchQueries({ queryKey: LIVE_KEY }), queryClient.refetchQueries({ queryKey: ORDERS_KEY })])
      const q = queryClient.getQueryState(LIVE_KEY)
      // /live counts as re-read only when it answered after the order left (a failed refetch keeps the older data)
      const liveOk = liveRead(q, startedAt)
      if (live) dispatch({ type: 'read', liveOk })
    })()
    return () => { live = false }
  }, [state.phase, state.order, queryClient])

  // while the office replays a past moment the reducer refuses every request (`replay`), whoever asks (card order, approval, recruit)
  const ask = useCallback(order => dispatch({ type: 'request', order, now: Date.now(), replay: latest.current.replay }), [])
  const request = useCallback((verb, item) => ask(targetOf(verb, item, randomUuid())), [ask])
  // answer an approval of the box (a refusal goes straight to the 6 s window; the other choices ask for a confirmation first)
  const requestApproval = useCallback((req, choice) => ask(approvalTarget(req, randomUuid(), choice)), [ask])
  // recruit the bot the form describes, or apply the model Hermes held for a confirmation (both name the new bot first)
  const requestRecruit = useCallback((draft, held = null) => ask(recruitTarget(draft, randomUuid(), held)), [ask])
  // apply the description the model proposed (the user read it before / after: straight to the 6 s window)
  const requestRevise = useCallback((name, description) => ask(reviseTarget(name, description, randomUuid())), [ask])
  // launch / cancel a campaign by its guard (the card of the decisions or the window's last step): the order names the campaign
  const requestGuard = useCallback((verb, item, extra = {}) => ask({ ...guardTarget(verb, item, randomUuid()), ...extra }), [ask])
  // create the campaign the editor holds. The review step already named the cards and the project: straight to the 6 s window.
  const requestCampaign = useCallback((draft, names) => {
    const id = randomUuid()
    const board = draft.boardMode === 'new' ? draft.nb.slug : draft.board
    return ask({ id, verb: 'campaign', board, task: '', code: String(draft.goal).trim(), body: toRequest(draft, id), size: summary(draft).cards, preconfirmed: true, ...names })
  }, [ask])
  const act = useCallback(type => dispatch({ type, now: Date.now() }), [])
  const setText = useCallback(text => dispatch({ type: 'text', text }), [])
  return { state, request, requestApproval, requestRecruit, requestRevise, requestGuard, requestCampaign, act, setText, dispatch }
}
