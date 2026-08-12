import type { Axial, CellOccupant, GameStatus, LevelData, TapOutcome } from '../types'
import { GATE_ANY } from '../types'
import { axialKey, step } from './HexGrid'
import { createOccupant } from './occupants'

/**
 * Pure game-state model: no Phaser, no rendering, no timing.
 * The runtime scene, the offline generator, and the solver all drive this
 * same class, so gameplay rules exist in exactly one place.
 *
 * THE CORE RULE — permanent honey. Every cell a bee sits on is honey from the
 * start, and every cell a bee flies over turns to honey too. Honey never dries
 * on its own. A bee that flies into any honey stops dead in it — and COLLECTS
 * it: the landing cell's honey is soaked up (removed from the board) and counts
 * toward the honey currency the run earns. So a stuck bee's cell is clean once
 * it flies onward.
 *
 * The puzzle is the ORDER: each bee lays a honey wall behind it, so you must
 * clear the hive in a sequence where no bee is forced through an earlier bee's
 * honey — and a deliberate landing is the pressure valve: it costs a move but
 * eats one honey cell (reopening that cell) and pays one honey.
 */
export class BoardState {
  movesUsed = 0

  private cellSet = new Set<string>()
  /** All honey on the board: level honey + honey under bees + laid trails. */
  private honeySet = new Set<string>()
  /** Honey cells collected this run (a bee landing on honey soaks it up). */
  private collected = 0
  private budget = 0
  private occupants = new Map<string, CellOccupant>()
  private queenViolated = false
  /** Compass mode: rotation is legal and every escape must pass a color gate. */
  private compassMode = false
  /** Rush mode: blocked bees PARK instead of bumping; the rim is a wall. */
  private rushMode = false
  /** Gate colors keyed `cellKey|dir` — the rim crossing they guard. */
  private gateMap = new Map<string, number>()

  constructor(level?: LevelData) {
    if (!level) return
    this.compassMode = level.compass === true
    this.rushMode = level.rush === true
    for (const [q, r] of level.cells) this.cellSet.add(axialKey(q, r))
    for (const [q, r, dir, color] of level.gates ?? []) {
      const key = axialKey(q, r)
      if (!this.cellSet.has(key)) {
        throw new Error(`Level ${level.id}: gate at (${q},${r}) is off the board`)
      }
      this.gateMap.set(`${key}|${dir}`, color)
    }
    for (const [q, r] of level.honeyCells ?? []) {
      const key = axialKey(q, r)
      if (!this.cellSet.has(key)) {
        throw new Error(`Level ${level.id}: honey at (${q},${r}) is off the board`)
      }
      this.honeySet.add(key)
    }
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
      // A bad dir (hand-authored level, corrupted JSON) would otherwise index
      // DIRECTION_VECTORS as undefined and silently "escape" through NaN-land.
      if (spec.kind !== 'hornet' && (!Number.isInteger(spec.dir) || spec.dir < 0 || spec.dir > 5)) {
        throw new Error(`Level ${level.id}: bee at (${spec.q},${spec.r}) has invalid dir ${spec.dir}`)
      }
      const occ = createOccupant(nextId++, spec)
      this.occupants.set(key, occ)
      // Honey sits under every bee/queen from the start (walls-to-be). Hornets
      // are stone, not honey.
      // Rush Hive runs DRY: there, the bees are the traffic and honey would
      // only add a second, slower blocking system on top of the one the mode
      // exists to test. Ordering pressure has to come from the bees themselves.
      if (occ.isGoal() && !this.rushMode) this.honeySet.add(key)
    }
  }

  get cells(): ReadonlySet<string> {
    return this.cellSet
  }

  /** All honey (permanent). */
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

  /** Honey cells collected this run — a bee landing on honey soaks it up. */
  get collectedHoney(): number {
    return this.collected
  }

  /** Is this cell honey right now? */
  isSticky(q: number, r: number): boolean {
    return this.honeySet.has(axialKey(q, r))
  }

  private stickyKey(key: string): boolean {
    return this.honeySet.has(key)
  }

  /** Every honey cell, for rendering. */
  stickyCells(): Axial[] {
    const out: Axial[] = []
    for (const key of this.honeySet) {
      const [q, r] = key.split(',').map(Number)
      out.push({ q, r })
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
    const start: Axial = { q: occ.q, r: occ.r }
    let pos: Axial = start
    let prev: Axial = pos
    // Rush: stopping short is a MOVE (the bee parks where it stopped), not a
    // bump. `prev` is the last cell it actually reached, so a bee already flush
    // against its blocker yields prev === start — a zero-length slide, which is
    // no move at all and is refused by `tap`.
    const parkOrBlock = (blocker: Axial): TapOutcome =>
      this.rushMode ? { kind: 'parked', path, at: { q: prev.q, r: prev.r } } : { kind: 'blocked', path, blocker }
    for (;;) {
      prev = pos
      pos = step(pos, occ.dir)
      const key = axialKey(pos.q, pos.r)
      if (!this.cellSet.has(key)) {
        // Compass rule: the rim is a wall except at a gate of the bee's color —
        // a wrong-colored crossing bounces exactly like a bump.
        // Rush rule: the rim is a wall except at a universal exit; a bee that
        // reaches a solid rim parks against it rather than bouncing home.
        if ((this.compassMode || this.rushMode) && !this.gateMatches(prev, occ.dir, occ.color))
          return parkOrBlock(pos)
        return { kind: 'escaped', path }
      }
      const blocker = this.occupants.get(key)
      if (blocker?.blocksFlight()) return parkOrBlock(pos)
      // Honey catches the bee. Its own start cell is never re-checked (we step
      // first), so a bee sitting in honey flies off it normally.
      if (this.stickyKey(key)) return { kind: 'stuck', path, at: { q: pos.q, r: pos.r } }
      path.push(pos)
    }
  }

  private gateMatches(lastCell: Axial, dir: number, color: number | undefined): boolean {
    const gate = this.gateMap.get(`${axialKey(lastCell.q, lastCell.r)}|${dir}`)
    if (gate === undefined) return false
    // GATE_ANY is Rush Hive's universal exit: the hive has a mouth, not a
    // colour lock. Compass gates keep matching on colour.
    return gate === GATE_ANY || gate === color
  }

  /** Whether this board plays under Compass rules (rotation + color gates). */
  get isCompass(): boolean {
    return this.compassMode
  }

  /** Gate entries as [q, r, dir, color] — for rendering and tooling. */
  get gates(): Array<[number, number, number, number]> {
    return [...this.gateMap.entries()].map(([k, color]) => {
      const [cell, dir] = k.split('|')
      const [q, r] = cell.split(',').map(Number)
      return [q, r, Number(dir), color]
    })
  }

  /**
   * Compass-mode rotation: turn the bee 60° counter-clockwise (one direction
   * step). FREE — the cost model of the mode charges flights, not aiming; the
   * puzzle is the route, not the dexterity. No-op outside compass mode.
   */
  rotate(q: number, r: number): number | undefined {
    if (!this.compassMode || this.status !== 'playing') return undefined
    const occ = this.occupantAt(q, r)
    if (!occ || !occ.isTappable()) return undefined
    occ.dir = (occ.dir + 1) % 6
    return occ.dir
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
    // Rush: a bee flush against its blocker has nowhere to slide. Refusing the
    // tap (rather than charging a move for nothing) is what keeps the mode a
    // planning puzzle instead of a poking one — an illegal move in Rush Hour is
    // simply not offered.
    if (outcome.kind === 'parked' && outcome.at.q === occ.q && outcome.at.r === occ.r) {
      return undefined
    }
    this.movesUsed++
    if (outcome.kind === 'escaped') {
      this.occupants.delete(axialKey(q, r))
      // Queen must be last: if she leaves with any goal still on the board, lose.
      if (occ.kind === 'queen' && this.goalRemaining > 0) this.queenViolated = true
    } else if (outcome.kind === 'stuck') {
      // Relocate the occupant onto the honey cell; it stays as a blocker — and
      // it COLLECTS the honey it landed in: the cell is clean from now on and
      // the run banks one honey. Landing is how honey is harvested.
      this.occupants.delete(axialKey(q, r))
      occ.q = outcome.at.q
      occ.r = outcome.at.r
      this.occupants.set(axialKey(occ.q, occ.r), occ)
      this.honeySet.delete(axialKey(occ.q, occ.r))
      this.collected++
    } else if (outcome.kind === 'parked') {
      // Slide to the last cell reached. No honey is collected: the bee stopped
      // against traffic, it did not land in a pool.
      this.occupants.delete(axialKey(q, r))
      occ.q = outcome.at.q
      occ.r = outcome.at.r
      this.occupants.set(axialKey(occ.q, occ.r), occ)
    }
    // Permanent honey is smeared over every cell the bee actually flew over — a
    // bump counts, because the bee still made the trip before bouncing back.
    // Rush Hive lays none (see the constructor): it is a dry board by design.
    if (!this.rushMode) this.layTrail(outcome.path)
    return outcome
  }

  /** Whether this board plays under Rush Hive rules (park-on-block, walled rim). */
  get isRush(): boolean {
    return this.rushMode
  }

  private layTrail(path: ReadonlyArray<Axial>): void {
    for (const cell of path) this.honeySet.add(axialKey(cell.q, cell.r))
  }

  /**
   * Trace a HONEY-CLEAN flight: the bee flies straight through honey (it does not
   * stick), stopping only at the board edge or a solid blocker. Used by the Honey
   * Cleaner power-up. Returns the crossed cells and whether it left the board.
   */
  private traceClean(occ: CellOccupant): { escaped: boolean; path: Axial[]; blocker?: Axial } {
    const path: Axial[] = []
    let pos: Axial = { q: occ.q, r: occ.r }
    let prev: Axial = pos
    for (;;) {
      prev = pos
      pos = step(pos, occ.dir)
      const key = axialKey(pos.q, pos.r)
      if (!this.cellSet.has(key)) {
        // The cleaner obeys gates too: no power-up may smuggle a bee through a
        // wrong-colored rim.
        if (this.compassMode && !this.gateMatches(prev, occ.dir, occ.color))
          return { escaped: false, path, blocker: { q: pos.q, r: pos.r } }
        return { escaped: true, path }
      }
      const blocker = this.occupants.get(key)
      if (blocker?.blocksFlight()) return { escaped: false, path, blocker: { q: pos.q, r: pos.r } }
      path.push(pos) // fly THROUGH honey rather than sticking
    }
  }

  /**
   * Non-mutating preview of a Honey Cleaner flight, for the aim UI. Mirrors
   * exactly what tapClean would do: fly THROUGH honey, stop only at the board
   * edge or a solid blocker. Without this the preview would show the normal
   * sticky trace — the opposite of what the armed power-up will actually do.
   */
  previewClean(occ: CellOccupant): TapOutcome {
    const { escaped, path, blocker } = this.traceClean(occ)
    if (escaped) return { kind: 'escaped', path }
    return { kind: 'blocked', path, blocker: blocker! }
  }

  /**
   * Honey Cleaner power-up: fly the occupant, wiping honey off its start cell and
   * every cell it crosses instead of laying more. If the lane clears to the edge
   * the bee escapes; if a wall/bee blocks it, the bee stays but the honey it flew
   * over is still gone (so a sealed lane can be reopened for the others).
   */
  tapClean(q: number, r: number): TapOutcome | undefined {
    if (this.status !== 'playing') return undefined
    const occ = this.occupantAt(q, r)
    if (!occ || !occ.isTappable()) return undefined
    const { escaped, path, blocker } = this.traceClean(occ)
    this.movesUsed++
    // Wipe honey from the start cell and the whole flown path.
    this.honeySet.delete(axialKey(occ.q, occ.r))
    for (const cell of path) this.honeySet.delete(axialKey(cell.q, cell.r))
    if (escaped) {
      this.occupants.delete(axialKey(q, r))
      if (occ.kind === 'queen' && this.goalRemaining > 0) this.queenViolated = true
      return { kind: 'escaped', path }
    }
    return { kind: 'blocked', path, blocker: blocker! }
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

  /**
   * Is the hive SEALED — is there no tap left that both moves something and
   * does not lose on the spot?
   *
   * Two ways a tap can be worthless. It can BUMP: costs a move, smears more
   * honey, leaves the piece where it was. Or it can be the QUEEN escaping while
   * workers remain, which is an instant loss. When every remaining option is
   * one of those, the board is finished as a puzzle even though the move
   * counter still says otherwise.
   *
   * Both clauses are needed, and the second is the one that matters. Measured
   * over the shipped campaign: 99% of losses are this position rather than a
   * spent budget, the player still holds ~3.8 moves when it happens — and of
   * those dead positions, **100%** are "workers all jammed, only the queen can
   * fly, and flying her loses". A predicate that only checked for bumps found
   * literally none of them.
   */
  isSealed(): boolean {
    if (this.status !== 'playing') return false
    // A hive with rotation in it can never be sealed: turning is free and always
    // available, so there is always a legal action that changes the position.
    // Without this the rescue fires on boards that are perfectly alive — it was
    // measured true at the OPENING of 15 of the 50 compass levels, where the
    // player had not even moved yet.
    if (this.compassMode) return false
    const goals = this.goalRemaining
    for (const occ of this.occupants.values()) {
      if (!occ.isTappable()) continue
      const out = this.trace(occ)
      if (out.kind === 'blocked') continue // moves nothing
      // Releasing the queen early ends the run; it is not an escape route.
      if (occ.kind === 'queen' && out.kind === 'escaped' && goals > 1) continue
      return false
    }
    return true
  }

  /**
   * Spend one move without moving anything — the price of a rewound mistake.
   * Without this the rescue would be free, and free rewinds turn the puzzle
   * into "tap everything until something works", which is no puzzle at all.
   */
  chargeMove(): void {
    if (this.status !== 'playing') return
    this.movesUsed++
  }

  /** Deep-copies occupants and the honey set; the immutable cell set is shared. */
  clone(): BoardState {
    const copy = new BoardState()
    copy.cellSet = this.cellSet
    copy.honeySet = new Set(this.honeySet)
    copy.collected = this.collected
    copy.budget = this.budget
    copy.movesUsed = this.movesUsed
    copy.queenViolated = this.queenViolated
    copy.compassMode = this.compassMode
    copy.rushMode = this.rushMode
    copy.gateMap = this.gateMap // immutable after construction — safe to share
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
   * plus the honey set. Two branches are interchangeable only when both the
   * pieces AND the honey walls they have laid so far match — honey is permanent,
   * so the order that produced it is what a later branch inherits.
   */
  stateKey(): string {
    const occ = [...this.occupants.values()]
      .map((o) => `${o.kind}:${o.q},${o.r},${o.dir}`)
      .sort()
      .join('|')
    return `${occ}#${[...this.honeySet].sort().join(',')}`
  }
}
