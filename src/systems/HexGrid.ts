import type { Axial } from '../types'
import { Direction } from '../types'

export const SQRT3 = Math.sqrt(3)

/**
 * Axial step vectors indexed by Direction: dir0 = E, counterclockwise.
 * Must stay in sync with the Direction enum and the asset dir{0-5} contract.
 */
export const DIRECTION_VECTORS: ReadonlyArray<Axial> = [
  { q: 1, r: 0 }, // E
  { q: 1, r: -1 }, // NE
  { q: 0, r: -1 }, // NW
  { q: -1, r: 0 }, // W
  { q: -1, r: 1 }, // SW
  { q: 0, r: 1 }, // SE
]

export function axialKey(q: number, r: number): string {
  return `${q},${r}`
}

export function step(pos: Axial, dir: Direction): Axial {
  const v = DIRECTION_VECTORS[dir]
  return { q: pos.q + v.q, r: pos.r + v.r }
}

/** Pointy-top axial → pixel, hex circumradius = size. */
export function axialToPixel(q: number, r: number, size: number): { x: number; y: number } {
  return {
    x: size * SQRT3 * (q + r / 2),
    y: size * 1.5 * r,
  }
}

/** Pixel → nearest axial cell (cube rounding). */
export function pixelToAxial(x: number, y: number, size: number): Axial {
  const qf = ((SQRT3 / 3) * x - (1 / 3) * y) / size
  const rf = ((2 / 3) * y) / size
  const sf = -qf - rf
  let q = Math.round(qf)
  let r = Math.round(rf)
  const s = Math.round(sf)
  const dq = Math.abs(q - qf)
  const dr = Math.abs(r - rf)
  const ds = Math.abs(s - sf)
  if (dq > dr && dq > ds) q = -r - s
  else if (dr > ds) r = -q - s
  // + 0 folds -0 into +0 — cells are string-keyed, so "0,-0" would never match.
  return { q: q + 0, r: r + 0 }
}

/**
 * Screen-space rotation (radians, y-down) for a sprite authored facing East.
 * Directions are counterclockwise, so each step is -60° on screen.
 */
export function directionAngle(dir: Direction): number {
  return -dir * (Math.PI / 3)
}

/** Distance between adjacent hex centers is SQRT3 * size for pointy-top. */
export function neighborDistance(size: number): number {
  return SQRT3 * size
}

/** All cells of a hexagon-shaped board with the given radius (radius 0 = 1 cell). */
export function hexagonCells(radius: number): Array<[number, number]> {
  const cells: Array<[number, number]> = []
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius)
    const rMax = Math.min(radius, -q + radius)
    for (let r = rMin; r <= rMax; r++) cells.push([q, r])
  }
  return cells
}

export interface PixelBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Bounds of cell *centers* in units of size=1. Caller adds hex margins. */
export function unitCenterBounds(cells: ReadonlyArray<readonly [number, number]>): PixelBounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [q, r] of cells) {
    const { x, y } = axialToPixel(q, r, 1)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}
