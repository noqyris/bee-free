import type { Axial, CellOccupant, GameStatus, LevelData, TapOutcome } from '../types'
import { axialKey, step } from './HexGrid'
import { createOccupant } from './occupants'

/**
 * Pure game-state model: no Phaser, no rendering, no timing.
 * The runtime scene, the offline generator, and the solver all drive this
 * same class, so gameplay rules exist in exactly one place.
 */
export class BoardState {
  movesUsed = 0

  private cellSet = new Set<string>()
  private honeySet = new Set<string>()
  private budget = 0
  private occupants = new Map<string, CellOccupant>()
  private queenViolated = false

  constructor(level?: LevelData) {
    if (!level) return
    for (const [q, r] of level.cells) this.cellSet.add(axialKey(q, r))
    for (const [q, r] of level.honeyCells ?? []) this.honeySet.add(axialKey(q, r))
    this.budget = level.moveBudget

    let nextId = 1
    for (const spec of level.bees) {
      const key = axialKey(spec.q, spec.r)
      if (!this.cellSet.has(key)) {
        throw new Error(`Level ${level.id}: bee at (${spec.q},${spec.r}) is off the board`)
      }
      if (this.occupants.has(key)) {
        throw new Error(`Level ${level.id}: two occupants share cell (${spec.q},${spec.r})`)
      }
      this.occupants.set(key, createOccupant(nextId++, spec))
    }
  }

  get cells(): ReadonlySet<string> {
    return this.cellSet
  }

  get honey(): ReadonlySet<string> {
    return this.honeySet
  }

  get moveBudget(): number {
    return this.budget
  }

  get status(): GameStatus {
    // The Queen leaving early is an immediate, unrecoverable loss.
    if (this.queenViolated) return 'lost'
    // Win when no goal occupants remain (hornets are permanent, don't count).
    if (this.goalRemaining === 0) return 'won'
    if (this.movesUsed >= this.budget) return 'lost'
    return 'playing'
  }

  get movesLeft(): number {
    return Math.max(0, this.budget - this.movesUsed)
  }

  /** Goal occupants left to clear (bees + queen); hornets excluded. */
  get remaining(): number {
    let n = 0
    for (const o of this.occupants.values()) if (o.isGoal()) n++
    return n
  }

  private get goalRemaining(): number {
    return this.remaining
  }

  /** True when the loss was specifically the Queen leaving before the others. */
  get queenLeftEarly(): boolean {
    return this.queenViolated
  }

  occupantAt(q: number, r: number): CellOccupant | undefined {
    return this.occupants.get(axialKey(q, r))
  }

  allOccupants(): CellOccupant[] {
    return [...this.occupants.values()]
  }

  /**
   * Simulate the flight of an occupant without mutating anything.
   * `path` holds the empty board cells crossed (excludes start and blocker).
   */
  trace(occ: CellOccupant): TapOutcome {
    const path: Axial[] = []
    let pos: Axial = { q: occ.q, r: occ.r }
    for (;;) {
      pos = step(pos, occ.dir)
      const key = axialKey(pos.q, pos.r)
      if (!this.cellSet.has(key)) return { kind: 'escaped', path }
      const blocker = this.occupants.get(key)
      if (blocker?.blocksFlight()) return { kind: 'blocked', path, blocker: pos }
      // An empty honey cell catches the bee (its own start cell is never re-checked
      // since we step first, so a bee already on honey flies off it normally).
      if (this.honeySet.has(key)) return { kind: 'stuck', path, at: { q: pos.q, r: pos.r } }
      path.push(pos)
    }
  }

  /**
   * Tap the occupant at (q, r). Consumes a move whether the bee escapes or
   * bumps — that cost is the core tension of the game.
   * Returns undefined for taps that do nothing (empty cell, untappable
   * occupant, game already over); those do NOT consume a move.
   */
  tap(q: number, r: number): TapOutcome | undefined {
    if (this.status !== 'playing') return undefined
    const occ = this.occupantAt(q, r)
    if (!occ || !occ.isTappable()) return undefined
    const outcome = this.trace(occ)
    this.movesUsed++
    if (outcome.kind === 'escaped') {
      this.occupants.delete(axialKey(q, r))
      // Queen must be last: if she leaves with any goal still on the board, lose.
      if (occ.kind === 'queen' && this.goalRemaining > 0) this.queenViolated = true
    } else if (outcome.kind === 'stuck') {
      // Relocate the occupant onto the honey cell; it stays as a blocker.
      this.occupants.delete(axialKey(q, r))
      occ.q = outcome.at.q
      occ.r = outcome.at.r
      this.occupants.set(axialKey(occ.q, occ.r), occ)
    }
    return outcome
  }

  /** Direct removal, used by the solver and future obstacle effects. */
  removeOccupant(q: number, r: number): void {
    this.occupants.delete(axialKey(q, r))
  }

  /**
   * Extend the move budget — the rewarded-ad "keep going" revive. This can lift
   * a board back out of an out-of-moves loss, but deliberately cannot undo a
   * queen violation: that loss is permanent by design.
   */
  grantExtraMoves(n: number): void {
    if (n > 0) this.budget += n
  }

  /** Deep-copies occupants; the immutable cell set is shared. */
  clone(): BoardState {
    const copy = new BoardState()
    copy.cellSet = this.cellSet
    copy.honeySet = this.honeySet
    copy.budget = this.budget
    copy.movesUsed = this.movesUsed
    copy.queenViolated = this.queenViolated
    for (const [key, occ] of this.occupants) copy.occupants.set(key, occ.clone())
    return copy
  }

  /** Like clone(), but with an overridden move budget (for unbounded search). */
  cloneWithBudget(budget: number): BoardState {
    const copy = this.clone()
    copy.budget = budget
    return copy
  }

  /** Canonical key of the current occupant configuration, for solver memoization. */
  stateKey(): string {
    return [...this.occupants.values()]
      .map((o) => `${o.kind}:${o.q},${o.r},${o.dir}`)
      .sort()
      .join('|')
  }
}
