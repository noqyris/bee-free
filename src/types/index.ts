/** Axial hex coordinate (pointy-top orientation). */
export interface Axial {
  readonly q: number
  readonly r: number
}

/**
 * dir0 = East, counterclockwise in 60° steps.
 * Matches the asset naming contract bee_{skin}_dir{0-5}_*.png exactly.
 */
export enum Direction {
  E = 0,
  NE = 1,
  NW = 2,
  W = 3,
  SW = 4,
  SE = 5,
}

/** M1 ships only 'bee'. Later: 'honey', 'wax', 'sleeping', 'queen', 'hornet'. */
export type OccupantKind = 'bee'

/**
 * Common contract for everything that can sit in a cell.
 * Obstacles in later milestones implement this same interface so BoardState
 * and the solver never special-case types.
 */
export interface CellOccupant {
  readonly id: number
  readonly kind: OccupantKind
  q: number
  r: number
  dir: Direction
  /** Whether tapping this occupant does anything right now. */
  isTappable(): boolean
  /** Whether a flying bee is stopped by this occupant. */
  blocksFlight(): boolean
  clone(): CellOccupant
}

export interface BeeSpec {
  readonly q: number
  readonly r: number
  readonly dir: Direction
  readonly kind: OccupantKind
}

export interface LevelData {
  readonly id: number
  /** Optional authoring label; never shown raw in UI (i18n rule). */
  readonly name?: string
  /** Axial coords [q, r] of every playable cell — defines the board shape. */
  readonly cells: ReadonlyArray<readonly [number, number]>
  readonly bees: ReadonlyArray<BeeSpec>
  readonly moveBudget: number
  /** Moves that must be left over (>=) on a win to earn 3 stars. */
  readonly threeStarSpare: number
  /** 1-based chapter (every 25 levels); set by the generator. */
  readonly chapter?: number
  /** Composite difficulty score from the solver (for tuning/telemetry). */
  readonly difficulty?: number
  /** Longest forced ordering chain from the solver. */
  readonly depDepth?: number
}

export type TapOutcome =
  | { readonly kind: 'escaped'; readonly path: ReadonlyArray<Axial> }
  | {
      readonly kind: 'blocked'
      readonly path: ReadonlyArray<Axial>
      readonly blocker: Axial
    }

export type GameStatus = 'playing' | 'won' | 'lost'
