import type { LevelData } from '../types'
import { Direction } from '../types'
import { hexagonCells } from '../systems/HexGrid'

const { E, NE, NW, W, SW } = Direction

const R1 = hexagonCells(1) // 7 cells
const R2 = hexagonCells(2) // 19 cells

/**
 * Hand-made M1 test levels. tests/levels.test.ts proves each is solvable
 * within budget and that 3 stars are achievable. The M2 generator replaces
 * these with 150 validated levels using the same LevelData shape.
 */
export const TEST_LEVELS: ReadonlyArray<LevelData> = [
  {
    id: 1,
    name: 'First Flight',
    cells: R1,
    bees: [
      { q: 0, r: 0, dir: E, kind: 'bee' },
      { q: -1, r: 1, dir: SW, kind: 'bee' },
      { q: 1, r: -1, dir: NE, kind: 'bee' },
    ],
    moveBudget: 5,
    threeStarSpare: 2,
  },
  {
    id: 2,
    name: 'Excuse Me',
    cells: R1,
    bees: [
      { q: -1, r: 0, dir: E, kind: 'bee' },
      { q: 1, r: 0, dir: E, kind: 'bee' },
    ],
    moveBudget: 3,
    threeStarSpare: 1,
  },
  {
    id: 3,
    name: 'Conga Line',
    cells: R2,
    bees: [
      { q: -2, r: 0, dir: E, kind: 'bee' },
      { q: -1, r: 0, dir: E, kind: 'bee' },
      { q: 0, r: 0, dir: E, kind: 'bee' },
      { q: 1, r: 0, dir: E, kind: 'bee' },
      { q: 2, r: 0, dir: E, kind: 'bee' },
      { q: 0, r: -2, dir: NE, kind: 'bee' },
    ],
    moveBudget: 8,
    threeStarSpare: 2,
  },
  {
    id: 4,
    name: 'Crossroads',
    cells: R2,
    bees: [
      { q: 2, r: 0, dir: NE, kind: 'bee' },
      { q: 0, r: 0, dir: E, kind: 'bee' },
      { q: 0, r: -1, dir: W, kind: 'bee' },
      { q: 0, r: 1, dir: NW, kind: 'bee' },
      { q: -2, r: 1, dir: E, kind: 'bee' },
    ],
    moveBudget: 7,
    threeStarSpare: 2,
  },
  {
    id: 5,
    name: 'Traffic Jam',
    cells: R2,
    bees: [
      { q: 0, r: -2, dir: NW, kind: 'bee' },
      { q: 1, r: -2, dir: W, kind: 'bee' },
      { q: -1, r: -1, dir: E, kind: 'bee' },
      { q: -2, r: 0, dir: NE, kind: 'bee' },
      { q: 0, r: 0, dir: W, kind: 'bee' },
      { q: 0, r: 1, dir: NW, kind: 'bee' },
      { q: 1, r: 1, dir: SW, kind: 'bee' },
      { q: -1, r: 2, dir: NE, kind: 'bee' },
    ],
    moveBudget: 10,
    threeStarSpare: 2,
  },
]
