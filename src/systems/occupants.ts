import type { BeeSpec, CellOccupant, OccupantKind } from '../types'
import { Direction } from '../types'

/** A normal worker bee: tappable, flies, blocks, and must escape to win. */
export class Bee implements CellOccupant {
  readonly kind: OccupantKind = 'bee'

  constructor(
    readonly id: number,
    public q: number,
    public r: number,
    public dir: Direction,
    readonly color?: number,
  ) {}

  isTappable(): boolean {
    return true
  }
  blocksFlight(): boolean {
    return true
  }
  isGoal(): boolean {
    return true
  }
  clone(): Bee {
    return new Bee(this.id, this.q, this.r, this.dir, this.color)
  }
}

/**
 * The Queen: behaves like a bee, but the level is lost if she escapes while any
 * other goal occupant remains — she must be the LAST to leave (spec §3).
 */
export class Queen implements CellOccupant {
  readonly kind: OccupantKind = 'queen'

  constructor(
    readonly id: number,
    public q: number,
    public r: number,
    public dir: Direction,
    readonly color?: number,
  ) {}

  isTappable(): boolean {
    return true
  }
  blocksFlight(): boolean {
    return true
  }
  isGoal(): boolean {
    return true
  }
  clone(): Queen {
    return new Queen(this.id, this.q, this.r, this.dir, this.color)
  }
}

/** A hornet: a permanent blocker that can never be tapped or removed (spec §3). */
export class Hornet implements CellOccupant {
  readonly kind: OccupantKind = 'hornet'
  readonly dir: Direction = Direction.E

  constructor(
    readonly id: number,
    public q: number,
    public r: number,
  ) {}

  isTappable(): boolean {
    return false
  }
  blocksFlight(): boolean {
    return true
  }
  isGoal(): boolean {
    return false
  }
  clone(): Hornet {
    return new Hornet(this.id, this.q, this.r)
  }
}

/**
 * Single construction point. The exhaustive switch means widening OccupantKind
 * fails to compile until the new kind is handled here — BoardState never changes.
 */
export function createOccupant(id: number, spec: BeeSpec): CellOccupant {
  switch (spec.kind) {
    case 'bee':
      return new Bee(id, spec.q, spec.r, spec.dir, spec.color)
    case 'queen':
      return new Queen(id, spec.q, spec.r, spec.dir, spec.color)
    case 'hornet':
      return new Hornet(id, spec.q, spec.r)
  }
}
