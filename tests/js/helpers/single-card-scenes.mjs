// The outputs of the label / bar / inspector / model / since-when functions for bots that run ZERO or ONE card, over three
// datasets. `snapshot(root)` imports the modules of `root` (a checkout of the repo), so the same code ran on the revision before a bot could run
// several cards, to write tests/js/fixtures/single-card-scenes.json, and runs on the working tree in the test: a single card must read exactly as before.
// Regenerate (only if a rule changes on purpose): git archive <ref> src | tar -x -C <dir>; node tests/js/helpers/single-card-scenes.mjs <dir> > fixture
import { pathToFileURL } from 'node:url'

export const NOW = 1_800_000_000_000
const s = ms => Math.round(ms / 1000)
const card = (id, title, startedAgoMin, beatAgoMin, extra = {}) => ({ id, title, status: 'running', createdAt: s(NOW) - 7200, startedAt: s(NOW) - startedAgoMin * 60, heartbeatAt: beatAgoMin == null ? null : s(NOW) - beatAgoMin * 60, ...extra })
const blocked = (id, title, assignee) => ({ id, title, status: 'blocked', assignee, createdAt: s(NOW) - 5000 })
const desk = (name, state, extra = {}) => ({ name, label: name, state, model: 'example/model-fast', provider: 'example', ...extra })

/** Three datasets: [{ desks, live, history }]. Every bot has at most one running card. */
export function datasets() {
  const mine = (name, c) => ({ ...c, assignee: name })
  return [
    // 1: one board, every state, one card each (a pinned model, a card with no code, no heartbeat)
    {
      desks: [desk('w1', 'working'), desk('w2', 'working'), desk('w3', 'working'), desk('st', 'idle'), desk('wa', 'idle'), desk('id', 'idle'), desk('nw', 'new'), desk('ac', 'active')],
      live: { ok: true, boards: [{ slug: 'alpha', tasks: [
        mine('w1', card('t1', 'S3.2 — Alpha job', 12, 1)),
        mine('w2', card('t2', 'plain title with no code', 90, null, { modelOverride: 'example/model-large' })),
        mine('w3', card('t3', 'R-API3 — Review', 3, 0.5, { providerOverride: 'acme-cloud' })),
        mine('st', card('t4', 'T4.2 — Silent job', 40, 12)),
        mine('wa', card('t5', 'A1 — Running while blocked card waits', 8, 1)),
        blocked('t6', 'Q9 — Needs you', 'wa'), blocked('t7', 'Q10 — Needs you too', 'wa')
      ] }] },
      history: { ok: true, profiles: { w1: { workerModel: 'example/model-fast', worker: { lastActiveMs: NOW - 1000 } }, w2: { workerModel: 'example/model-large', worker: { lastActiveMs: NOW - 1000 } }, w3: { defaultModel: 'example/model-fast' } } }
    },
    // 2: two boards, one card per bot, an unknown default model
    {
      desks: [desk('a', 'working', { model: '', provider: '' }), desk('b', 'working'), desk('c', 'idle'), desk('d', 'unknown')],
      live: { ok: true, boards: [
        { slug: 'zeta', tasks: [mine('a', card('t1', 'X1 — Zeta', 20, 2, { modelOverride: 'other/model-x' })), mine('c', card('t2', 'Y2 — Zeta silent', 33, 20))] },
        { slug: 'beta', tasks: [mine('b', card('t3', 'Z3 — Beta', 2, 0)), blocked('t4', 'B7 — decision', 'd')] }
      ] },
      history: null
    },
    // 3: no live read (roster only), then a board with idle bots and no running card at all (zero cards)
    {
      desks: [desk('p', 'idle'), desk('q', 'working'), desk('r', 'active')],
      live: { ok: true, boards: [{ slug: 'solo', tasks: [{ id: 't1', title: 'Done thing', status: 'done', assignee: 'p', createdAt: s(NOW) - 9000, completedAt: s(NOW) - 4000 }, mine('q', card('t2', 'K1', 1, 0))] }] },
      history: { ok: true, profiles: { q: { workerModel: 'example/model-fast', worker: { lastActiveMs: NOW - 1000 } } } }
    }
  ]
}

export async function snapshot(root) {
  const load = f => import(pathToFileURL(`${root}/src/core/${f}`).href)
  const { buildOffice } = await load('office.js')
  const { taskTag, cardProgress } = await load('hud.js')
  const { inspectorOf, sinceOf } = await load('panel.js')
  const { modelOf, withWorkerModels } = await load('models.js')
  const out = []
  for (const ds of datasets()) {
    const office = buildOffice(ds.desks, ds.live, NOW)
    const agents = withWorkerModels(office.agents, ds.history)
    for (const a of agents) {
      const models = modelOf(a)
      out.push({
        name: a.name, state: a.state, silentMs: a.silentMs,
        taskTag: taskTag(a, NOW), cardProgress: cardProgress(a, NOW), sinceOf: sinceOf(a, NOW), modelOf: models,
        inspectorOf: inspectorOf(a, { nowMs: NOW, history: ds.history, models })
      })
    }
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await snapshot(process.argv[2]), null, 1))
}
