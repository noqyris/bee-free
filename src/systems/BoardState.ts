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
  private budget = 0
  private occupants = new Map<string, CellOccupant>()

  constructor(level?: LevelData) {
    if (!level) return
    for (const [q, r] of level.cells) this.cellSet.add(axialKey(q, r))
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

  get moveBudget(): number {
    return this.budget
  }

  get status(): GameStatus {
    if (this.occupants.size === 0) return 'won'
    if (this.movesUsed >= this.budget) return 'lost'
    return 'playing'
  }

  get movesLeft(): number {
    return Math.max(0, this.budget - this.movesUsed)
  }

  get remaining(): number {
    return this.occupants.size
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
    if (outcome.kind === 'escaped') this.occupants.delete(axialKey(q, r))
    return outcome
  }

  /** Direct removal, used by the solver and future obstacle effects. */
  removeOccupant(q: number, r: number): void {
    this.occupants.delete(axialKey(q, r))
  }

  /** Deep-copies occupants; the immutable cell set is shared. */
  clone(): BoardState {
    const copy = new BoardState()
    copy.cellSet = this.cellSet
    copy.budget = this.budget
    copy.movesUsed = this.movesUsed
    for (const [key, occ] of this.occupants) copy.occupants.set(key, occ.clone())
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
