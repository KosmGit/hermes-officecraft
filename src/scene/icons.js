/* Pixel-art icons (same engine as the scene; no emoji font dependency). Buffer version: the page turns it into a data URL. */
import { hx } from './color.js'
import { PAL } from './palette.js'
import { Lay, Px, Spr } from './raster.js'

export const ICON_ART = {
  chain: l => l.rect(-3, -9, 3, -6, hx('#f2c94c')).set(-4, -9, hx('#f2c94c')).set(4, -9, hx('#f2c94c')).set(-5, -8, hx('#f2c94c')).set(5, -8, hx('#f2c94c')).rect(-2, -5, 2, -5, hx('#e0a92e')).rect(-1, -4, 1, -3, hx('#e0a92e')).rect(-3, -2, 3, -1, hx('#8a5a2a')).set(-1, -8, hx('#fff2b0')),
  centurion: l => {
    l.rect(-6, -9, 6, -1, hx('#e2b84a'))
    ;['111', '101', '101', '101', '111'].forEach((r, y) => { for (let x = 0; x < 3; x++) { if (r[x] === '1') { l.set(-1 + x, -8 + y, hx('#6b4a12')); l.set(3 + x, -8 + y, hx('#6b4a12')) } } })
    l.rect(-5, -7, -5, -3, hx('#6b4a12'))
  },
  zero: l => l.rect(0, -6, 0, -1, hx('#2f7c45')).ell(-2, -7, 2.2, 1.4, hx('#5bb872')).ell(2, -9, 2.2, 1.4, hx('#3e9a57')).rect(-3, -1, 3, 0, hx('#c86f45')),
  quick: l => l.ell(0, -5, 4, 4, hx('#f2c94c'), (x, y) => y <= -3).rect(-5, -2, 5, -1, hx('#8a6a2a')).set(0, -10, hx('#f2c94c')).set(-1, -7, hx('#fff2b0')),
  review: l => {
    l.ell(-1, -6, 3.6, 3.6, hx('#3a3f4b')).ell(-1, -6, 2.4, 2.4, hx('#bfe4ff')).set(-2, -7, hx('#ffffff'))
    for (let i = 0; i < 4; i++) l.rect(2 + i, -3 + i, 3 + i, -2 + i, hx('#c9a227'))
  },
  owl: l => l.ell(0, -5, 4.5, 4.5, hx('#ffd75e'), (x, y) => (x - 2) * (x - 2) + (y + 6) * (y + 6) > 12).set(4, -10, hx('#ffffff')).set(-5, -11, hx('#ffffff')),
  thrifty: l => l.rect(-4, -6, 2, -1, hx('#f2efe9')).rect(3, -5, 4, -3, hx('#f2efe9')).rect(-3, -6, 1, -6, hx('#6b4126')).set(-2, -9, hx('#c9ccd2')).set(0, -10, hx('#c9ccd2')).set(-1, -11, hx('#c9ccd2')),
  hire: l => l.rect(-5, -7, 5, -1, hx('#d8b07a')).rect(-5, -7, 5, -7, hx('#c49a63')).rect(-1, -7, 1, -4, hx('#a87f4c')),
  builder: l => l.rect(-5, -5, 5, -1, hx('#7f9db4')).rect(-6, -6, 6, -6, hx('#c0392b')).rect(-4, -8, 4, -7, hx('#c0392b')).rect(-2, -9, 2, -9, hx('#c0392b')).rect(-1, -4, 1, -1, hx('#5d4636')).set(3, -4, hx('#ffe08a')).set(-3, -4, hx('#ffe08a')),
  fire: l => l.rect(-2, -8, 2, -1, hx('#d33a2c')).rect(1, -8, 2, -1, hx('#962d22')).rect(-1, -10, 1, -9, hx('#2b2f36')).rect(2, -11, 4, -10, hx('#2b2f36')).set(-1, -6, hx('#ffffff')),
  // the eighteen achievements added to the first ten, one drawing each (family colours: chains teal, boards blue, reliability green/red, decider orange, team violet)
  smooth: l => l.ell(-3, -6, 3.4, 3.4, hx('#4cc9b0'), (x, y) => (x + 3) ** 2 + (y + 6) ** 2 >= 4).ell(3, -6, 3.4, 3.4, hx('#2fa38d'), (x, y) => (x - 3) ** 2 + (y + 6) ** 2 >= 4).rect(-1, -7, 1, -5, hx('#4cc9b0')).set(-5, -9, hx('#d9fff6')),
  architect: l => l.rect(-6, -10, 6, -1, hx('#3b6ea8')).rect(-5, -9, 5, -2, hx('#9fd3f0')).rect(-5, -6, 5, -6, hx('#3b6ea8')).rect(-1, -9, -1, -2, hx('#3b6ea8')).rect(2, -9, 2, -2, hx('#3b6ea8')).rect(-4, -4, -2, -3, hx('#f2c94c')),
  teamwork: l => l.rect(-6, -5, -2, -1, hx('#3d7bfd')).rect(2, -5, 6, -1, hx('#2f9e6e')).ell(-4, -8, 2, 2, hx('#e8a35a')).ell(4, -8, 2, 2, hx('#c98340')).rect(-3, -6, 3, -1, hx('#e76f51')).ell(0, -9, 2.3, 2.3, hx('#f2c94c')),
  quickstart: l => l.ell(0, -5, 4.8, 4.8, hx('#d8dee6')).ell(0, -5, 3.6, 3.6, hx('#ffffff')).rect(0, -8, 0, -5, hx('#c0392b')).rect(0, -5, 2, -5, hx('#c0392b')).rect(-1, -11, 1, -10, hx('#8a93a0')).rect(4, -10, 5, -9, hx('#8a93a0')),
  wide: l => l.rect(-6, -6, -4, -1, hx('#3d7bfd')).rect(-2, -10, 0, -1, hx('#2f9e6e')).rect(2, -8, 4, -1, hx('#e76f51')).rect(-6, 0, 5, 0, hx('#6b7480')),
  versatile: l => l.ell(-3, -3, 2.6, 2.6, hx('#3d7bfd')).ell(3, -3, 2.6, 2.6, hx('#2f9e6e')).ell(0, -8, 2.6, 2.6, hx('#e76f51')).set(0, -5, hx('#ffffff')),
  multimodel: l => l.rect(-6, -8, 1, -2, hx('#3d7bfd')).rect(-1, -10, 5, -4, hx('#e76f51')).rect(-1, -8, 1, -4, hx('#8b62c9')).set(-6, -10, hx('#c9ccd2')).set(5, -2, hx('#c9ccd2')).set(-4, -5, hx('#ffffff')),
  rescue: l => l.ell(0, -6, 5.6, 5.6, hx('#d33a2c'), (x, y) => x * x + (y + 6) ** 2 >= 7).rect(-1, -12, 1, -11, hx('#f2efe9')).rect(-1, -1, 1, 0, hx('#f2efe9')).rect(-6, -7, -5, -5, hx('#f2efe9')).rect(5, -7, 6, -5, hx('#f2efe9')),
  iron: l => l.rect(-4, -10, 4, -6, hx('#8a93a0')).rect(-3, -5, 3, -4, hx('#8a93a0')).rect(-2, -3, 2, -3, hx('#8a93a0')).rect(-1, -2, 1, -2, hx('#8a93a0')).rect(-3, -9, -3, -6, hx('#cfd6de')).rect(0, -9, 0, -4, hx('#6b7480')),
  ontime: l => l.ell(0, -6, 5.2, 5.2, hx('#2f9e6e')).ell(0, -6, 3.8, 3.8, hx('#f2efe9')).rect(0, -9, 0, -6, hx('#2b2f36')).rect(0, -6, 2, -6, hx('#2b2f36')),
  firstpass: l => l.rect(-4, -11, 4, -1, hx('#f2efe9')).rect(-3, -10, 1, -10, hx('#c9ccd2')).set(-3, -5, hx('#2f9e6e')).set(-2, -4, hx('#2f9e6e')).set(-1, -3, hx('#2f9e6e')).set(0, -4, hx('#2f9e6e')).set(1, -5, hx('#2f9e6e')).set(2, -6, hx('#2f9e6e')).set(3, -7, hx('#2f9e6e')),
  swiss: l => l.ell(0, -6, 5.6, 5.6, hx('#f2efe9')).rect(-1, -9, 1, -3, hx('#d33a2c')).rect(-3, -7, 3, -5, hx('#d33a2c')).set(-5, -6, hx('#2b2f36')).set(5, -6, hx('#2b2f36')),
  present: l => l.rect(-5, -10, 5, -1, hx('#f2efe9')).rect(-5, -10, 5, -8, hx('#e8863a')).rect(-3, -6, -2, -5, hx('#2f9e6e')).rect(0, -6, 1, -5, hx('#2f9e6e')).rect(3, -6, 4, -5, hx('#2f9e6e')).rect(-3, -3, -2, -2, hx('#2f9e6e')).rect(0, -3, 1, -2, hx('#2f9e6e')),
  noqueue: l => l.rect(-6, -3, 6, -1, hx('#8a93a0')).rect(-6, -6, -5, -3, hx('#8a93a0')).rect(5, -6, 6, -3, hx('#8a93a0')).set(-2, -7, hx('#2f9e6e')).set(-1, -6, hx('#2f9e6e')).set(0, -7, hx('#2f9e6e')).set(1, -8, hx('#2f9e6e')).set(2, -9, hx('#2f9e6e')),
  fullteam: l => l.ell(0, -9, 1.8, 1.8, hx('#e76f51')).ell(5, -6, 1.8, 1.8, hx('#f2c94c')).ell(3, -2, 1.8, 1.8, hx('#2f9e6e')).ell(-3, -2, 1.8, 1.8, hx('#3d7bfd')).ell(-5, -6, 1.8, 1.8, hx('#8b62c9')).ell(0, -5, 1.4, 1.4, hx('#f2efe9')),
  training: l => l.rect(-6, -8, 6, -7, hx('#2b2f36')).rect(-4, -9, 4, -9, hx('#2b2f36')).rect(-2, -10, 2, -10, hx('#2b2f36')).rect(-3, -6, 3, -3, hx('#3b4150')).rect(6, -7, 6, -3, hx('#f2c94c')).set(6, -2, hx('#f2c94c')),
  firstmission: l => l.rect(-4, -11, -4, -1, hx('#8a6a2a')).rect(-3, -11, 5, -6, hx('#d33a2c')).rect(-3, -9, 2, -8, hx('#f2efe9')).rect(-6, -1, -2, 0, hx('#6b7480')),
  veteran: l => l.rect(-3, -11, -1, -8, hx('#3d7bfd')).rect(1, -11, 3, -8, hx('#c0392b')).ell(0, -5, 4.4, 4.4, hx('#f2c94c')).ell(0, -5, 2.6, 2.6, hx('#e0a92e')).set(0, -5, hx('#fff2b0')),
  // the four achievements of the measured history (twin: team violet, fastlane: boards blue, quiet and comeback: reliability green)
  twin: l => l.rect(-5, -9, -2, -7, hx('#8b62c9')).rect(-4, -10, -3, -10, hx('#8b62c9')).rect(-6, -6, -1, -1, hx('#8b62c9')).rect(2, -9, 5, -7, hx('#d9c7f7')).rect(3, -10, 4, -10, hx('#d9c7f7')).rect(1, -6, 6, -1, hx('#d9c7f7')).set(-4, -8, hx('#e6d8ff')).set(3, -8, hx('#8b62c9')),
  fastlane: l => {
    ;[[0, -10], [1, -9], [2, -8], [3, -7], [4, -6], [3, -5], [2, -4], [1, -3], [0, -2]].forEach(([x, y]) => l.set(x, y, hx('#3d7bfd')).set(x + 1, y, hx('#3d7bfd')))
    l.rect(-6, -8, -2, -8, hx('#9fd3f0')).rect(-5, -6, -1, -6, hx('#9fd3f0')).rect(-6, -4, -2, -4, hx('#9fd3f0'))
  },
  quiet: l => l.ell(0, -6, 5.2, 5.2, hx('#e6edc8'), (x, y) => (x - 2.4) ** 2 + (y + 7.4) ** 2 >= 16).set(4, -10, hx('#ffffff')).set(5, -5, hx('#ffffff')).set(2, -2, hx('#9fdcb4')),
  comeback: l => l.rect(-6, -3, -4, -1, hx('#d33a2c')).rect(-3, -5, -1, -1, hx('#e8863a')).rect(0, -7, 2, -1, hx('#9fdc6a')).rect(3, -10, 5, -1, hx('#2f9e6e')).set(4, -11, hx('#e6f7ea')),
  // the « Command » family (red): the orders given from the office
  pilot: l => l.rect(-6, -6, 5, -5, hx('#d33a2c')).rect(-4, -8, 3, -7, hx('#d33a2c')).rect(-2, -10, 1, -9, hx('#d33a2c')).rect(-4, -4, 0, -3, hx('#962d22')).rect(-1, -2, 1, -1, hx('#962d22')).rect(2, -4, 5, -3, hx('#f2efe9')),
  recruiter: l => l.ell(-2, -9, 2.2, 2.2, hx('#e8a35a')).rect(-5, -6, 1, -1, hx('#3d7bfd')).rect(3, -8, 3, -2, hx('#2f9e6e')).rect(1, -5, 5, -5, hx('#2f9e6e')),
  guardian: l => l.rect(-5, -11, 5, -7, hx('#3d7bfd')).rect(-5, -6, 5, -4, hx('#3d7bfd')).rect(-4, -3, 4, -3, hx('#3d7bfd')).rect(-2, -2, 2, -2, hx('#3d7bfd')).rect(-1, -1, 1, -1, hx('#3d7bfd')).rect(-4, -10, -1, -8, hx('#9fd3f0')).rect(-3, -7, 3, -7, hx('#f2efe9')).rect(0, -9, 0, -4, hx('#f2efe9')),
  hidden: l => l.rect(-3, -11, 3, -10, hx('#7a8592')).rect(-4, -10, -3, -8, hx('#7a8592')).rect(2, -10, 3, -7, hx('#7a8592')).rect(0, -7, 2, -6, hx('#7a8592')).rect(-1, -5, 0, -4, hx('#7a8592')).rect(-1, -2, 0, -1, hx('#7a8592')),
  star_bronze: l => l.rect(0, -10, 0, -2, hx('#d99a5b')).rect(-4, -6, 4, -6, hx('#d99a5b')).rect(-1, -8, 1, -4, hx('#e8b27a')).rect(-2, -7, 2, -5, hx('#d99a5b')),
  star_silver: l => l.rect(0, -10, 0, -2, hx('#aeb8c4')).rect(-4, -6, 4, -6, hx('#aeb8c4')).rect(-1, -8, 1, -4, hx('#e6edf5')).rect(-2, -7, 2, -5, hx('#aeb8c4')),
  star_gold: l => l.rect(0, -10, 0, -2, hx('#e0a92e')).rect(-4, -6, 4, -6, hx('#e0a92e')).rect(-1, -8, 1, -4, hx('#fff2b0')).rect(-2, -7, 2, -5, hx('#f2c94c')),
  office: l => l.rect(-5, -10, 5, -1, hx('#7f9db4')).rect(-5, -10, 5, -10, hx('#4b5d6e')).rect(-1, -3, 1, -1, hx('#5d4636')).rect(-3, -8, -2, -7, hx('#ffe08a')).rect(2, -8, 3, -7, hx('#ffe08a')).rect(-3, -5, -2, -4, hx('#ffe08a')).rect(2, -5, 3, -4, hx('#ffe08a')),
  camera: l => l.rect(-5, -7, 5, -1, hx('#3a3f4b')).rect(-2, -8, 0, -8, hx('#3a3f4b')).ell(0, -4, 2.4, 2.4, hx('#9fd3f0')).set(3, -6, hx('#ff5a4a')),
  sun: l => {
    l.ell(0, -6, 2.6, 2.6, hx('#ffc531'))
    ;[[0, -11], [0, -1], [-5, -6], [5, -6], [-4, -10], [4, -10], [-4, -2], [4, -2]].forEach(([x, y]) => l.set(x, y, hx('#ffb000')))
  },
  spark: l => l.rect(0, -12, 0, 0, hx('#8b62c9')).rect(-6, -6, 6, -6, hx('#8b62c9')).rect(-1, -8, 1, -4, hx('#b48cf2')).rect(-2, -7, 2, -5, hx('#b48cf2')).set(0, -6, hx('#ffffff')),
  flame: l => l.ell(0, -4, 3, 3.4, hx('#ff7a2c')).rect(0, -9, 0, -7, hx('#ff7a2c')).set(1, -8, hx('#ff7a2c')).ell(0, -3, 1.6, 2, hx('#ffd75e'))
}

/** One icon as a 14 x 14 RGBA buffer. An unknown id draws the first one (never throws). */
export function icon(id) {
  const px = new Px(14, 14)
  const l = new Lay()
  ;(ICON_ART[id] || ICON_ART.chain)(l)
  new Spr().add(l, PAL.outline).blit(px, 7, 13)
  return { W: 14, H: 14, d: px.d }
}
