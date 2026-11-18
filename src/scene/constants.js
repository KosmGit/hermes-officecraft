/* Scene geometry: 2:1 isometric, one tile = 32 x 16 art pixels. */
export const TW2 = 16
export const TH2 = 8
export const WH = 80          // wall height
export const SLAB = 7         // floor slab thickness
export const CAP = 0.2        // wall cap thickness
export const TY = 2.5         // first pod row (y)
export const TD = 1.5         // desk depth
export const SW = 1.9         // seat width
export const DESK_Z = 14
export const SEAT_Z = 9

/** Tile coordinates (x, y, height z) -> art pixels, for an origin (ox, oy). */
export const projectAt = (ox, oy, x, y, z = 0) => [ox + (x - y) * TW2, oy + (x + y) * TH2 - z]
