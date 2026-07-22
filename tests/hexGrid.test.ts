import { describe, expect, it } from 'vitest'
import {
  DIRECTION_VECTORS,
  SQRT3,
  axialKey,
  axialToPixel,
  directionAngle,
  hexagonCells,
  pixelToAxial,
  step,
} from '../src/systems/HexGrid'
import { Direction } from '../src/types'

describe('DIRECTION_VECTORS', () => {
  it('is dir0 = E, counterclockwise (asset contract)', () => {
    expect(DIRECTION_VECTORS[Direction.E]).toEqual({ q: 1, r: 0 })
    expect(DIRECTION_VECTORS[Direction.NE]).toEqual({ q: 1, r: -1 })
    expect(DIRECTION_VECTORS[Direction.NW]).toEqual({ q: 0, r: -1 })
    expect(DIRECTION_VECTORS[Direction.W]).toEqual({ q: -1, r: 0 })
    expect(DIRECTION_VECTORS[Direction.SW]).toEqual({ q: -1, r: 1 })
    expect(DIRECTION_VECTORS[Direction.SE]).toEqual({ q: 0, r: 1 })
  })

  it('opposite directions cancel', () => {
    for (let d = 0; d < 3; d++) {
      const a = DIRECTION_VECTORS[d]
      const b = DIRECTION_VECTORS[d + 3]
      expect(a.q + b.q).toBe(0)
      expect(a.r + b.r).toBe(0)
    }
  })

  it('each step is 60° counterclockwise on screen', () => {
    const size = 10
    for (let d = 0; d < 6; d++) {
      const v = DIRECTION_VECTORS[d]
      const p = axialToPixel(v.q, v.r, size)
      const screenAngle = Math.atan2(p.y, p.x)
      const expected = directionAngle(d as Direction)
      // Compare as an angular difference so ±PI count as equal.
      const delta = Math.atan2(Math.sin(screenAngle - expected), Math.cos(screenAngle - expected))
      expect(delta).toBeCloseTo(0, 10)
      // All neighbor distances equal
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(SQRT3 * size, 10)
    }
  })
})

describe('axialToPixel / pixelToAxial', () => {
  it('round-trips every cell of a radius-4 board', () => {
    const size = 37
    for (const [q, r] of hexagonCells(4)) {
      const p = axialToPixel(q, r, size)
      expect(pixelToAxial(p.x, p.y, size)).toEqual({ q, r })
    }
  })

  it('round-trips with sub-cell jitter (tap tolerance)', () => {
    const size = 40
    for (const [q, r] of hexagonCells(2)) {
      const p = axialToPixel(q, r, size)
      // Jitter well within the hex in-radius (sqrt3/2 * size ≈ 34.6)
      expect(pixelToAxial(p.x + 15, p.y - 12, size)).toEqual({ q, r })
      expect(pixelToAxial(p.x - 14, p.y + 14, size)).toEqual({ q, r })
    }
  })
})

describe('step / axialKey / hexagonCells', () => {
  it('step moves one cell in the given direction', () => {
    expect(step({ q: 0, r: 0 }, Direction.NE)).toEqual({ q: 1, r: -1 })
    expect(step({ q: 2, r: -1 }, Direction.W)).toEqual({ q: 1, r: -1 })
  })

  it('axialKey is unique per cell', () => {
    const keys = new Set(hexagonCells(3).map(([q, r]) => axialKey(q, r)))
    expect(keys.size).toBe(37)
  })

  it('hexagon cell counts follow 3r(r+1)+1', () => {
    expect(hexagonCells(0)).toHaveLength(1)
    expect(hexagonCells(1)).toHaveLength(7)
    expect(hexagonCells(2)).toHaveLength(19)
    expect(hexagonCells(4)).toHaveLength(61)
  })
})
