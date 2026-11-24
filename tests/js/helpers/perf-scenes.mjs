// Three scenes (a small office, a busy one with the game decor, an empty one with the gateway down), day and night, and the checksum of five
// frames of each: the same bytes before and after a change of how the frames are made.
import { createHash } from 'node:crypto'
import { buildOffice } from '../../../src/core/office.js'
import { buildRoster } from '../../../src/core/roster.js'
import { buildBase, drawScene, layoutScene, toSceneModel } from '../../../src/scene/index.js'

const D = 86_400_000
const T0 = new Date(2026, 10, 9, 10, 0, 0).getTime()
const s = ms => ms / 1000
export const FRAMES = [0, 1, 2, 5, 13]

const desks = (names, workers) => buildRoster({
  profiles: names.map((name, i) => ({
    name, description: ['Build and test the web pages', 'Research and write docs', 'Design the interface', 'Review pull requests'][i % 4],
    last_session: { id: `s${i}`, last_active: s(T0 - (i % 3 === 0 ? 2 * 60_000 : 3 * D)) },
    ...(workers.includes(i) ? { worker_session: { id: `w${i}`, last_active: s(T0) - 5 } } : {})
  }))
}, T0)
const card = (id, status, assignee, extra = {}) => ({ id, title: `Card ${id}`, status, assignee, createdAt: s(T0 - 3 * D), ...extra })

export function scenes() {
  const small = buildOffice(desks(['alpha', 'beta', 'gamma'], [0]), {
    ok: true,
    boards: [{ slug: 'website', createdAt: s(T0 - 60 * D), tasks: [card('t1', 'done', 'alpha'), card('t2', 'running', 'alpha', { startedAt: s(T0 - 600_000), heartbeatAt: s(T0 - 5_000) }), card('t3', 'blocked', 'beta')] }],
    ops: { gateway: { state: 'running', platforms: [{ name: 'chat', state: 'connected' }] }, crons: [{ name: 'nightly', profile: 'alpha', enabled: true }] }
  }, T0)
  const names = Array.from({ length: 12 }, (_, i) => `bot${i}`)
  const tasks = slug => Array.from({ length: 14 }, (_, i) => card(`${slug}${i}`, ['done', 'done', 'running', 'todo', 'blocked'][i % 5], names[(i * 5 + slug.length) % 12], { startedAt: s(T0 - 3_600_000), heartbeatAt: s(T0 - (i % 3 === 0 ? 900_000 : 4_000)), completedAt: s(T0 - D) }))
  const busy = buildOffice(desks(names, [0, 3, 6, 9]), {
    ok: true,
    boards: ['website', 'demostore', 'docs'].map((slug, i) => ({ slug, createdAt: s(T0 - (90 - i * 20) * D), tasks: tasks(slug) })),
    ops: { gateway: { state: 'degraded', platforms: [{ name: 'chat', state: 'retrying' }, { name: 'mail', state: 'connected' }] }, crons: [{ name: 'a', profile: 'bot1', enabled: true }, { name: 'b', profile: 'bot2', enabled: true, failure_streak: 2 }] }
  }, T0)
  const empty = buildOffice(desks([], []), { ok: true, boards: [], ops: { gateway: { state: 'stopped', platforms: [] }, crons: [] } }, T0)
  const decor = { sober: false, incidentBoards: ['demostore'], achievements: ['chain', 'owl', 'fire', 'quick', 'thrifty'], centurions: ['website'], streak: 7, lastFailMs: T0 - D, owlBoard: 'docs', recruits: ['bot3'], season: 'xmas', mascotMood: 'play' }
  return { small: { office: small }, busy: { office: busy, decor }, empty: { office: empty } }
}

/** The model of a scene, day or night. */
export const modelOf = (scene, night) => toSceneModel(scene.office, { nowMs: T0, night, decor: scene.decor })

/** One digest per scene and light: the bytes of FRAMES.length frames, drawn by `draw(layout, base, model, frame)` and read at once (a reused buffer is overwritten by the next frame). */
export function checksums(draw) {
  const out = {}
  for (const [name, scene] of Object.entries(scenes())) {
    for (const night of [false, true]) {
      const model = modelOf(scene, night)
      const layout = layoutScene(model)
      const base = buildBase(layout, model)
      const h = createHash('sha1')
      for (const f of FRAMES) h.update(Buffer.from(draw(layout, base, model, f).d))
      out[`${name}-${night ? 'night' : 'day'}`] = h.digest('hex')
    }
  }
  return out
}
export const plainDraw = (layout, base, model, f) => drawScene(layout, base, model, f)
