import { hexagonCells } from './HexGrid'

export type Cell = readonly [number, number]

/**
 * Board-shape descriptor stored in the level curve and resolved to cells by
 * `shapeCells`. All shapes are simply-connected (no interior holes), which
 * keeps the escape rule unambiguous: a bee's first off-board step always means
 * it left the board edge, never that it flew into a gap. (Rings / holed masks
 * would need a different escape check and are deferred.)
 */
export type ShapeSpec =
  | { kind: 'hexagon'; radius: number }
  | { kind: 'triangleUp'; size: number }
  | { kind: 'triangleDown'; size: number }
  | { kind: 'rhombus'; w: number; h: number }
  | { kind: 'hexTrimmed'; radius: number }

/** Upward triangle: q,r >= 0 and q + r <= size. */
function triangleUp(size: number): Cell[] {
  const cells: Cell[] = []
  for (let q = 0; q <= size; q++) {
    for (let r = 0; r <= size - q; r++) cells.push([q, r])
  }
  return cells
}

/** Downward triangle (point-down): q,r <= 0 and q + r >= -size. */
function triangleDown(size: number): Cell[] {
  const cells: Cell[] = []
  for (let q = 0; q >= -size; q--) {
    for (let r = 0; r >= -size - q; r--) cells.push([q, r])
  }
  return cells
}

function rhombus(w: number, h: number): Cell[] {
  const cells: Cell[] = []
  const q0 = -Math.floor(w / 2)
  const r0 = -Math.floor(h / 2)
  for (let q = 0; q < w; q++) {
    for (let r = 0; r < h; r++) cells.push([q0 + q, r0 + r])
  }
  return cells
}

/** Hexagon with its six single corner cells removed — a softer, rounded look. */
function hexTrimmed(radius: number): Cell[] {
  const corners = new Set([
    `${radius},0`,
    `${-radius},0`,
    `0,${radius}`,
    `0,${-radius}`,
    `${radius},${-radius}`,
    `${-radius},${radius}`,
  ])
  return hexagonCells(radius).filter(([q, r]) => !corners.has(`${q},${r}`))
}

export function shapeCells(spec: ShapeSpec): Cell[] {
  switch (spec.kind) {
    case 'hexagon':
      return hexagonCells(spec.radius)
    case 'triangleUp':
      return triangleUp(spec.size)
    case 'triangleDown':
      return triangleDown(spec.size)
    case 'rhombus':
      return rhombus(spec.w, spec.h)
    case 'hexTrimmed':
      return hexTrimmed(spec.radius)
  }
}

export function shapeCapacity(spec: ShapeSpec): number {
  return shapeCells(spec).length
}

export function shapeLabel(spec: ShapeSpec): string {
  switch (spec.kind) {
    case 'hexagon':
      return `hex${spec.radius}`
    case 'triangleUp':
      return `triUp${spec.size}`
    case 'triangleDown':
      return `triDown${spec.size}`
    case 'rhombus':
      return `rhomb${spec.w}x${spec.h}`
    case 'hexTrimmed':
      return `hexT${spec.radius}`
  }
}
