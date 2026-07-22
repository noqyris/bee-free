import type { LevelData } from '../types'
import { Direction } from '../types'
import { hexagonCells } from '../systems/HexGrid'

const { E, NE, NW, W, SW } = Direction

const R1 = hexagonCells(1) // 7 cells
const R2 = hexagonCells(2) // 19 cells

/**
 * Hand-made reference levels retained as regression fixtures for the unit
 * tests. The shipped game uses the generated set (see ./index.ts); these
 * exercise specific mechanics (forced ordering, chains) with known answers.
 */
export const HAND_LEVELS: ReadonlyArray<LevelData> = [
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
