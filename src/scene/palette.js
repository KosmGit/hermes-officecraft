/* The art palette: the only place literal colours are allowed to live, together with the
   other files of src/scene/. The accent colour (selection ring) never comes from here: it arrives
   as model.accent. These are the defaults, fixed: the decorator's fiche overrides them in src/scene/style.js. */
import { hx } from './color.js'
import { hash } from './util.js'

export const PAL = {
  plank: ['#c99863', '#c18f5d', '#d0a06b', '#ba8656'].map(hx),
  seam: hx('#94643d'),
  wallL: hx('#f0e8da'),
  wallB: hx('#e3d8c6'),
  wainL: hx('#a3bba7'),
  wainB: hx('#93ab98'),
  rail: hx('#f6f1e8'),
  base: hx('#6d5646'),
  cap: hx('#faf6ee'),
  capEdge: hx('#5a4c42'),
  slabL: hx('#4c4038'),
  slabR: hx('#3b322c'),
  frame: hx('#3c434f'),
  sill: hx('#f4f1ea'),
  deskT: hx('#f4f2ed'),
  deskL: hx('#d9d5cc'),
  deskR: hx('#bfbab0'),
  leg: hx('#4b515d'),
  bezel: hx('#23272f'),
  monBack: hx('#353b46'),
  kbd: hx('#3a3f4b'),
  kbdT: hx('#5a606d'),
  seat: hx('#3d4456'),
  seatD: hx('#2f3545'),
  chairBase: hx('#23272f'),
  pot: hx('#c86f45'),
  potD: hx('#a3573a'),
  leaf: ['#3e9a57', '#2f7c45', '#5bb872'].map(hx),
  wood: hx('#9b6b43'),
  woodD: hx('#7c5434'),
  woodT: hx('#b07c50'),
  rack: hx('#21252d'),
  rackT: hx('#2f343e'),
  ledG: hx('#3ddc84'),
  ledB: hx('#7cc8ff'),
  ledO: hx('#ffb347'),
  sofa: hx('#5d7fa6'),
  sofaD: hx('#4a6a8f'),
  sofaT: hx('#7193bb'),
  cushion: hx('#e9c46a'),
  counterT: hx('#ece7dd'),
  cab: hx('#7f9db4'),
  cabD: hx('#6a879d'),
  shade: hx('#2b2f36'),
  bulb: hx('#ffe2a0'),
  cord: hx('#2b2f36'),
  wb: hx('#fbfbfa'),
  wbFrame: hx('#9aa3ad'),
  wbLine: hx('#d3d8de'),
  note: { todo: hx('#ffd75e'), run: hx('#7fc1ff'), blocked: hx('#ff7a5c'), done: hx('#8bd98f') },
  outline: hx('#2a1f1d'),
  white: hx('#ffffff'),
  warn: hx('#f2a516')
}

const SKIN_T = [['#f3d2b3', '#dcae8a'], ['#e3b48d', '#c8946c'], ['#c68e64', '#a8724c'], ['#9a6a45', '#7f5536'], ['#6e4a32', '#583a27'], ['#f7e1cf', '#e2c3a9']]
const HAIR_T = [['#2b211c', '#4a3a30'], ['#5a3b25', '#7a5235'], ['#a8673a', '#c4824f'], ['#d9b36a', '#ecd08f'], ['#7d7d82', '#a0a0a6'], ['#2d3a5c', '#45557e'], ['#9b3b2f', '#bf5a45']]
const SHIRT_T = [['#4f7cc9', '#3c63a6'], ['#d9644c', '#b84d38'], ['#45a37a', '#348462'], ['#8b62c9', '#6f4bab'], ['#e0a33a', '#c0862a'], ['#3e9fb5', '#2e8094'], ['#c9577f', '#a8436a'], ['#5b6b7f', '#48566a']]
const PANTS_T = ['#3b4458', '#4a3f36', '#2f3b4f', '#55555e']

/** Skin, hair, shirt, pants, hairstyle, dual monitors, mug: all picked from the name, never random. */
export function lookOf(name) {
  const p = (arr, s) => arr[hash(name + '#' + s) % arr.length]
  return {
    skin: p(SKIN_T, 1).map(hx),
    hair: p(HAIR_T, 2).map(hx),
    shirt: p(SHIRT_T, 3).map(hx),
    pants: hx(p(PANTS_T, 4)),
    style: hash(name + 'h') % 5,
    dual: hash(name + 'm') % 2 === 0,
    mug: hash(name + 'c') % 3
  }
}
