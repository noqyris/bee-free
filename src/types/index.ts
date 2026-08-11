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

/**
 * Occupant kinds. 'bee' and 'queen' are goals (must leave to win); 'hornet' is
 * a permanent blocker. Deferred: 'honey', 'wax', 'sleeping'.
 */
export type OccupantKind = 'bee' | 'queen' | 'hornet'

/**
 * Common contract for everything that can sit in a cell. Obstacles implement
 * this same interface so BoardState and the solver never special-case types.
 */
export interface CellOccupant {
  readonly id: number
  readonly kind: OccupantKind
  q: number
  r: number
  dir: Direction
  /** Compass-mode gate color (palette index); undefined on campaign levels. */
  readonly color?: number
  /** Whether tapping this occupant does anything right now. */
  isTappable(): boolean
  /** Whether a flying bee is stopped by this occupant. */
  blocksFlight(): boolean
  /** Whether this occupant must be cleared for the level to be won. */
  isGoal(): boolean
  clone(): CellOccupant
}

export interface BeeSpec {
  readonly q: number
  readonly r: number
  readonly dir: Direction
  readonly kind: OccupantKind
  /**
   * Compass-mode gate color (palette index). A colored bee may only exit the
   * board through a gate of the same color. Absent on campaign levels.
   */
  readonly color?: number
}

export interface LevelData {
  readonly id: number
  /** Optional authoring label; never shown raw in UI (i18n rule). */
  readonly name?: string
  /** Axial coords [q, r] of every playable cell — defines the board shape. */
  readonly cells: ReadonlyArray<readonly [number, number]>
  /** Honey cells [q, r]: a bee flying through an empty one gets stuck there. */
  readonly honeyCells?: ReadonlyArray<readonly [number, number]>
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
  /**
   * "Sticky Hive" special level: the board starts part-flooded with honey and
   * landings carve it clean — drives the badge, the honey-payout cap, and the
   * hop-aware doomed/star estimators in the scene.
   */
  readonly flooded?: boolean
  /**
   * Compass-mode level: tapping a bee ROTATES it (free), tapping its lane
   * launches it, and every escape must pass through a gate of the bee's color
   * (any other rim is a wall). Campaign levels leave this unset.
   */
  readonly compass?: boolean
  /**
   * Compass gates: [q, r, dir, color] — an exit through board-edge cell (q,r)
   * flying in `dir` is a gate of `color`. All other rim crossings are blocked
   * in compass mode.
   */
  readonly gates?: ReadonlyArray<readonly [number, number, number, number]>
  /**
   * "Rush Hive" level — the unpark-the-cars variant.
   *
   * Three differences from the campaign, and they only make sense together:
   *  1. A blocked bee no longer bumps: it SLIDES as far as its lane allows and
   *     parks against whatever stopped it. Bees therefore become each other's
   *     traffic, which is what makes "who moves first" a real question.
   *  2. The rim is a wall except at a few universal exits (`gates` with colour
   *     -1), so leaving is a destination you must route to, not a direction you
   *     happen to face.
   *  3. A tap that cannot move the bee at all is refused and costs nothing —
   *     an impossible move is not a move.
   *
   * Direction stays FIXED and forward-only: a bee is a car on a one-way street.
   */
  readonly rush?: boolean
}

/** A universal rim exit in Rush Hive — `gates` colour meaning "any bee". */
export const GATE_ANY = -1

export type TapOutcome =
  | { readonly kind: 'escaped'; readonly path: ReadonlyArray<Axial> }
  | {
      readonly kind: 'blocked'
      readonly path: ReadonlyArray<Axial>
      readonly blocker: Axial
    }
  | {
      // Flew into an empty honey cell and got stuck there (relocated, still on
      // the board as a blocker). Consumes a move; a second tap flies it onward.
      readonly kind: 'stuck'
      readonly path: ReadonlyArray<Axial>
      readonly at: Axial
    }
  | {
      // Rush Hive only: slid down the lane and PARKED against whatever stopped
      // it (a bee, or a rim with no exit). Relocated, still a blocker, no honey
      // collected — parking is travel, not harvest. `at` is always a cell the
      // bee could actually reach, so this never reports a zero-length move.
      readonly kind: 'parked'
      readonly path: ReadonlyArray<Axial>
      readonly at: Axial
    }

export type GameStatus = 'playing' | 'won' | 'lost'
