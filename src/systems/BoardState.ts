import type { Axial, CellOccupant, GameStatus, LevelData, TapOutcome } from '../types'
import { axialKey, step } from './HexGrid'
import { createOccupant } from './occupants'

/** A cell currently covered in fresh honey, with the moves left before it dries. */
export interface WetCell {
  readonly q: number
  readonly r: number
  /** Moves remaining while it still catches bees. Infinity for level honey. */
  readonly movesLeft: number
}

/**
 * Pure game-state model: no Phaser, no rendering, no timing.
 * The runtime scene, the offline generator, and the solver all drive this
 * same class, so gameplay rules exist in exactly one place.
 *
 * THE CORE RULE — the honey trail. Every bee that flies smears honey over each
 * cell it crosses. That honey is sticky for `dryMoves` further moves and then
 * dries away. A bee that flies into sticky honey stops dead in it and becomes a
 * blocker until it is tapped onward, which costs a move it cannot spare.
 *
 * So the only question that matters is the ORDER: fly a bee too early and its
 * trail is still wet when the next one needs that lane. Note this needs the
 * drying — permanent trails would make ordering irrelevant, because the total
 * number of trail collisions is then fixed no matter what order you play (each
 * cell covered by k different flight paths costs exactly k-1 stops). Drying is
 * what turns the board into a scheduling puzzle instead of a fixed toll.
 */
export class BoardState {
  movesUsed = 0

  private cellSet = new Set<string>()
  /** Level-authored honey: permanent, never dries. */
  private honeySet = new Set<string>()
  /** Trail honey: cell key → the move index at which it dries out. */
  private wetUntil = new Map<string, number>()
  private dryMoves = 0
  private budget = 0
  private occupants = new Map<string, CellOccupant>()
  private queenViolated = false

  constructor(level?: LevelData) {
    if (!level) return
    for (const [q, r] of level.cells) this.cellSet.add(axialKey(q, r))
    for (const [q, r] of level.honeyCells ?? []) this.honeySet.add(axialKey(q, r))
    this.budget = level.moveBudget
    this.dryMoves = level.dryMoves ?? 0

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

  /** Level-authored (permanent) honey only. */
  get honey(): ReadonlySet<string> {
    return this.honeySet
  }

  /** How long this level's trails stay sticky; 0 means the trail is off. */
  get trailDryMoves(): number {
    return this.dryMoves
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

  /** Is this cell sticky right now — level honey, or a trail that has not dried? */
  isSticky(q: number, r: number): boolean {
    return this.stickyKey(axialKey(q, r))
  }

  private stickyKey(key: string): boolean {
    if (this.honeySet.has(key)) return true
    const until = this.wetUntil.get(key)
    return until !== undefined && until > this.movesUsed
  }

  /** Every sticky cell for rendering, newest trails included. */
  stickyCells(): WetCell[] {
    const out: WetCell[] = []
    for (const key of this.honeySet) {
      const [q, r] = key.split(',').map(Number)
      out.push({ q, r, movesLeft: Infinity })
    }
    for (const [key, until] of this.wetUntil) {
      if (until <= this.movesUsed) continue
      if (this.honeySet.has(key)) continue
      const [q, r] = key.split(',').map(Number)
      out.push({ q, r, movesLeft: until - this.movesUsed })
    }
    return out
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
      // Sticky honey catches the bee (its own start cell is never re-checked
      // since we step first, so a bee sitting in honey flies off it normally).
      if (this.stickyKey(key)) return { kind: 'stuck', path, at: { q: pos.q, r: pos.r } }
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
    // Honey is smeared over every cell the bee actually flew over — a bump
    // counts, because the bee still made the trip before bouncing back.
    this.layTrail(outcome.path)
    return outcome
  }

  private layTrail(path: ReadonlyArray<Axial>): void {
    if (this.dryMoves <= 0) return
    const until = this.movesUsed + this.dryMoves
    for (const cell of path) this.wetUntil.set(axialKey(cell.q, cell.r), until)
    // Drop dried entries so the map (and every stateKey built from it) stays
    // proportional to what is actually wet, not to the length of the game.
    for (const [key, dries] of this.wetUntil) {
      if (dries <= this.movesUsed) this.wetUntil.delete(key)
    }
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

  /** Deep-copies occupants and the wet trail; the immutable cell set is shared. */
  clone(): BoardState {
    const copy = new BoardState()
    copy.cellSet = this.cellSet
    copy.honeySet = this.honeySet
    copy.wetUntil = new Map(this.wetUntil)
    copy.dryMoves = this.dryMoves
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

  /**
   * Canonical key of the current position, for solver memoization: occupants
   * plus the wet trail expressed as moves REMAINING. Relative wetness is what
   * makes two search branches interchangeable — the absolute move counter must
   * stay out of the key or nothing would ever merge.
   */
  stateKey(): string {
    const occ = [...this.occupants.values()]
      .map((o) => `${o.kind}:${o.q},${o.r},${o.dir}`)
      .sort()
      .join('|')
    if (this.wetUntil.size === 0) return occ
    const wet: string[] = []
    for (const [key, dries] of this.wetUntil) {
      if (dries > this.movesUsed) wet.push(`${key}+${dries - this.movesUsed}`)
    }
    if (wet.length === 0) return occ
    return `${occ}#${wet.sort().join(',')}`
  }
}
