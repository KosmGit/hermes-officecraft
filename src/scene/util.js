/* Deterministic helpers shared by the scene engine. No state, no DOM. */

/** FNV-1a over the string's code points (first UTF-16 unit of each). */
export function hash(str) {
  let h = 2166136261
  for (const ch of str) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 0..1 pseudo-random from a key list (never a random generator: same input, same pixels). */
export const rnd = (...k) => (hash(k.join('|')) % 10000) / 10000

/** Lower case, accents stripped (role / skill matching). */
export const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
