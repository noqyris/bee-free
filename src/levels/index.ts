import type { BeeSpec, Direction, LevelData, OccupantKind } from '../types'
import generated from './levels.generated.json'

/**
 * The shipped 300 levels, produced offline by `npm run gen:levels` and loaded
 * as static JSON (spec §4 — never generated at runtime). The JSON stores plain
 * numbers; we map them onto the typed LevelData shape here.
 */
const LEVELS: ReadonlyArray<LevelData> = generated.levels.map((l) => ({
  id: l.id,
  chapter: l.chapter,
  cells: l.cells.map((c) => [c[0], c[1]] as readonly [number, number]),
  honeyCells: (l.honeyCells ?? []).map((c) => [c[0], c[1]] as readonly [number, number]),
  bees: l.bees.map(
    (b): BeeSpec => ({ q: b.q, r: b.r, dir: b.dir as Direction, kind: b.kind as OccupantKind }),
  ),
  moveBudget: l.moveBudget,
  threeStarSpare: l.threeStarSpare,
  difficulty: l.difficulty,
  depDepth: l.depDepth,
  flooded: (l as { flooded?: boolean }).flooded ?? false,
}))

export { LEVELS }

export const LEVEL_COUNT = LEVELS.length

/** 0-based index → level; clamped to valid range. */
export function getLevel(index: number): LevelData {
  const i = Math.max(0, Math.min(LEVELS.length - 1, index))
  return LEVELS[i]
}

/** 1-based chapter for a level id (every 25 levels). */
export function chapterOf(levelId: number): number {
  return Math.ceil(levelId / 25)
}
