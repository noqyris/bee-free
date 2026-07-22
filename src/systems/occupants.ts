import type { BeeSpec, CellOccupant, OccupantKind } from '../types'
import { Direction } from '../types'

export class Bee implements CellOccupant {
  readonly kind: OccupantKind = 'bee'

  constructor(
    readonly id: number,
    public q: number,
    public r: number,
    public dir: Direction,
  ) {}

  isTappable(): boolean {
    return true
  }

  blocksFlight(): boolean {
    return true
  }

  clone(): Bee {
    return new Bee(this.id, this.q, this.r, this.dir)
  }
}

/**
 * Single construction point for occupants. The exhaustive switch means
 * widening OccupantKind (honey, wax, hornet, …) fails to compile until the
 * new kind is handled here — BoardState itself never changes.
 */
export function createOccupant(id: number, spec: BeeSpec): CellOccupant {
  switch (spec.kind) {
    case 'bee':
      return new Bee(id, spec.q, spec.r, spec.dir)
  }
}
