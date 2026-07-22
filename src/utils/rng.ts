/**
 * Deterministic seeded PRNG (mulberry32). Used by the offline level generator
 * and — later — the daily-challenge seed. Same seed → identical stream, so
 * generated levels are reproducible in CI.
 */
export type Rng = () => number

export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mix two integers into a new 32-bit seed (for sub-streams per attempt). */
export function mixSeed(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

export function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1))
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]
}

/** Weighted choice; `weightOf` must return a positive number. */
export function weightedPick<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T {
  let total = 0
  for (const it of items) total += weightOf(it)
  let roll = rng() * total
  for (const it of items) {
    roll -= weightOf(it)
    if (roll <= 0) return it
  }
  return items[items.length - 1]
}
