/* =====================================================================
   WARDROBE: the six trades the first 16 roles did not cover, with the garments they wear. Same rules as wardrobe.js:
   keywords normalised (lower case, accents stripped), English first then fr / es / de / it / pt and a few CJK terms; Latin keys match at
   the START of a word, keys under 4 letters and keys written "=word" match whole words only; ties go to the most specific keyword;
   several palettes per look, picked from the name.
   Pixel art in the same idiom as the other garments: overlays on the 12 x 13 torso (x -6..5, rows -16 neck .. -4 hem), `y()` maps a
   row for the facing, `c` = { main, shade, light, acc }. Pure module: no DOM, no storage.
   `wire` = the closest of the agent half's 16 roles (it only knows those: see wardrobe.js).
   Why these six (each is a trade common setups name, with no home in the 16):
     assistant  - personal assistant / secretariat (not « support »: that one answers customers)
     product    - product management (roadmap, backlog), apart from « coordination » (running a team)
     hr         - human resources / recruiting
     translator - translation and localisation, apart from « writing »
     comms      - communication / press relations, apart from « marketing » (acquisition)
     logistics  - purchasing, suppliers, stock, shipping
   ===================================================================== */
import { hx } from './color.js'

const SILVER = '#e6e8ea'

export const EXTRA_GARMENTS = {
  blouse: { label: 'chemisier à nœud', front: (l, y, c) => {
    for (const x of [-3, -2, 1, 2]) l.set(x, y(-16), hx('#ffffff'))
    l.rect(-1, y(-15), 0, y(-15), c.acc).set(-2, y(-14), c.acc).set(1, y(-14), c.acc).rect(-1, y(-14), 0, y(-14), c.shade)
    for (let k = -12; k <= -5; k += 3) l.set(-1, y(k), c.light)
  }, back: (l, y, c) => { l.rect(-3, y(-16), 2, y(-16), hx('#ffffff')) } },
  quarterZip: { label: 'pull à col zippé', front: (l, y, c) => {
    l.rect(-3, y(-16), 2, y(-16), c.shade)
    for (let k = -15; k <= -10; k++) l.set(-1, y(k), c.acc)
    l.rect(2, -10, 3, -9, c.acc).rect(-6, -4, 5, -4, c.shade)
  }, back: (l, y, c) => { l.rect(-3, y(-16), 2, y(-16), c.shade).rect(-6, -4, 5, -4, c.shade) } },
  vneck: { label: 'pull à col en V sur chemise', front: (l, y, c) => {
    for (let i = 0; i < 3; i++) l.rect(-3 + i, y(-16 + i), 2 - i, y(-16 + i), hx('#f4f4f6'))
    l.set(-1, y(-13), c.shade).set(0, y(-13), c.shade)
    l.rect(-6, -5, 5, -5, c.acc).rect(-6, -4, 5, -4, c.shade)
  }, back: (l, y, c) => { l.rect(-6, -5, 5, -5, c.acc).rect(-6, -4, 5, -4, c.shade) } },
  striped: { label: 'marinière', front: (l, y, c) => {
    for (let k = -16; k <= -4; k += 2) l.rect(-6, y(k), 5, y(k), c.acc)
    l.rect(-2, y(-16), 1, y(-16), c.shade)
  }, back: (l, y, c) => { for (let k = -16; k <= -4; k += 2) l.rect(-6, y(k), 5, y(k), c.acc) } },
  scarf: { label: 'écharpe', front: (l, y, c) => {
    for (let k = -16; k <= -14; k++) l.rect(-5, y(k), 4, y(k), c.acc)
    for (let k = -13; k <= -6; k++) l.rect(1, y(k), 2, y(k), c.acc)
    l.rect(1, -5, 2, -5, c.shade).set(-3, y(-15), c.shade).set(0, y(-14), c.shade).set(2, -9, c.light)
  }, back: (l, y, c) => { for (let k = -16; k <= -14; k++) l.rect(-5, y(k), 4, y(k), c.acc) } },
  hiVis: { label: 'gilet de chantier', sleeve: 'acc', front: (l, y, c) => {
    const s = hx(SILVER)
    l.rect(-2, y(-16), 1, y(-16), c.acc)
    for (let k = -15; k <= -4; k++) l.set(-4, y(k), s).set(3, y(k), s)
    l.rect(-6, -9, 5, -9, s)
  }, back: (l, y, c) => {
    const s = hx(SILVER)
    for (let k = -16; k <= -4; k++) l.set(-4, y(k), s).set(3, y(k), s)
    l.rect(-6, -9, 5, -9, s)
  } }
}

export const EXTRA_ROLES = {
  assistant: { label: 'Secrétariat', wire: 'support',
    keys: ['secretar', 'secretaire', 'personal assistant', 'executive assistant', 'administrative assistant', 'assistant personnel', 'assistant administratif', 'assistante', 'receptionist', 'concierge', 'asistente personal', 'asistente administrativ', 'sekretar', 'segretar', 'assistente pessoal', '秘書', '秘书'],
    looks: [{ g: 'blouse', main: ['#c9d6e8', '#e8d6dc', '#d3e2d0'], acc: ['#8a3b4a', '#2c3e66'], headset: true }] },
  product: { label: 'Produit', wire: 'manager',
    keys: ['=product', 'product manager', 'product management', 'roadmap', 'backlog', 'user stories', '=prd', '=produit', 'chef de produit', 'feuille de route', '=producto', 'gerente de producto', 'hoja de ruta', '=produkt', 'produktmanager', '=prodotto', '=produto', 'プロダクト', '产品'],
    looks: [{ g: 'quarterZip', main: ['#3b5b7a', '#5b4c70', '#2f6b5c'], acc: ['#e9c46a', '#f2ede4'] }] },
  hr: { label: 'RH', wire: 'manager',
    keys: ['recruit', 'hiring', '=hr', '=rh', 'human resources', 'candidate', 'ressources humaines', 'recrut', 'embauche', 'recursos humanos', 'rrhh', 'reclut', 'personalwesen', 'risorse umane', '人事', '招聘'],
    looks: [{ g: 'vneck', main: ['#6b8f71', '#8a6bb0', '#c97b63'], acc: ['#3d7bfd', '#e9c46a'], lanyard: true }] },
  translator: { label: 'Traduction', wire: 'writer',
    keys: ['translat', 'traduc', 'traduz', 'ubersetz', 'traduttor', 'tradutor', 'localiz', 'localis', '翻訳', '翻译', '通訳'],
    looks: [{ g: 'striped', main: ['#2c3e66', '#8a3b4a'], acc: ['#f2ede4'], glasses: 'round' }] },
  comms: { label: 'Communication', wire: 'marketer',
    keys: ['communications', 'communication', 'public relations', '=pr', 'press release', 'press office', 'media relations', 'spokes', 'comms', 'newsroom', 'communiqu', 'relations presse', 'attache de presse', 'relaciones publicas', 'comunicacion', 'prensa', 'kommunikation', 'pressearbeit', 'comunicazione', 'ufficio stampa', 'comunicacao', 'imprensa', '広報', '公关'],
    looks: [{ g: 'scarf', main: ['#3b3f4f', '#6b3b4f', '#2f4a5a'], acc: ['#e76f51', '#e9c46a'] }] },
  logistics: { label: 'Achats', wire: 'sales',
    keys: ['procurement', 'purchas', 'logistic', 'supply chain', 'supplier', 'vendor', 'inventory', 'shipping', 'warehouse', 'sourcing', 'achat', 'approvisionnement', 'fournisseur', 'livraison', 'compra', 'proveedor', 'abastecimiento', 'inventario', 'einkauf', 'beschaffung', 'lieferant', 'acquisti', 'fornitor', 'magazzino', 'fornecedor', '購買', '物流', '采购'],
    looks: [{ g: 'hiVis', main: ['#e8872a', '#cfd63a'], acc: ['#dfe3e8'], cap: true }] }
}
