import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, saveManager, type SaveData } from '../src/systems/SaveManager'

/** In-memory localStorage so the singleton can load/persist under vitest. */
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string): string | null {
    return this.store.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v)
  }
  removeItem(k: string): void {
    this.store.delete(k)
  }
  clear(): void {
    this.store.clear()
  }
}

const storage = new MemoryStorage()
;(globalThis as { localStorage?: unknown }).localStorage = storage

/** Reset the singleton to a fresh save between tests. */
function freshSave(seed?: Partial<SaveData>): void {
  storage.clear()
  if (seed) storage.setItem('beefree.save', JSON.stringify(seed))
  const s = saveManager as unknown as { loaded: boolean }
  s.loaded = false
  saveManager.load()
}

beforeEach(() => freshSave())

describe('migrate — corrupt saves must degrade to sane values', () => {
  it('rejects wrong scalar types back to defaults', () => {
    const out = migrate({
      honey: 'abc',
      currentLevel: null,
      dailyStreak: Number.NaN,
      removeAdsPurchased: 'yes',
    })
    expect(out.honey).toBe(0)
    expect(out.currentLevel).toBe(1)
    expect(out.dailyStreak).toBe(0)
    expect(out.removeAdsPurchased).toBe(false)
  })

  it('clamps out-of-range numbers and truncates floats', () => {
    const out = migrate({ honey: -50, currentLevel: 7.9, stars: { 3: 99, 4: -2, x: 3 } })
    expect(out.honey).toBe(0)
    expect(out.currentLevel).toBe(7)
    expect(out.stars[3]).toBe(3) // clamped to the 0..3 star range
    expect(out.stars[4]).toBe(0)
    expect(Object.keys(out.stars)).toHaveLength(2) // non-numeric key dropped
  })

  it('keeps only known power-up keys, clamped to >= 0', () => {
    const out = migrate({ powerups: { clean: -3, undo: 2.7, bogus: 99 } })
    expect(out.powerups.clean).toBe(0)
    expect(out.powerups.undo).toBe(2)
    expect('bogus' in out.powerups).toBe(false)
  })

  it('NaN honey can never survive a load (the NaN-forever bug)', () => {
    freshSave({ honey: Number.NaN } as Partial<SaveData>)
    expect(Number.isFinite(saveManager.honey)).toBe(true)
    saveManager.addHoney(10)
    expect(saveManager.honey).toBe(10)
  })
})

describe('recordWin', () => {
  it('keeps the best star count and pays stars*5 on improvement, 1 on replays', () => {
    expect(saveManager.recordWin(1, 3, 300)).toBe(15)
    expect(saveManager.starsFor(1)).toBe(3)
    expect(saveManager.recordWin(1, 2, 300)).toBe(1) // worse replay: trickle
    expect(saveManager.starsFor(1)).toBe(3) // best kept
  })

  it('unlocks the next level but never past the last', () => {
    saveManager.recordWin(1, 2, 300)
    expect(saveManager.currentLevel).toBe(2)
    freshSave({ currentLevel: 300 } as Partial<SaveData>)
    saveManager.recordWin(300, 3, 300)
    expect(saveManager.currentLevel).toBe(300)
  })
})

describe('economy guards', () => {
  it('spendHoney refuses insufficient or negative amounts', () => {
    saveManager.addHoney(10)
    expect(saveManager.spendHoney(11)).toBe(false)
    expect(saveManager.spendHoney(-1)).toBe(false)
    expect(saveManager.spendHoney(10)).toBe(true)
    expect(saveManager.honey).toBe(0)
  })

  it('usePowerup at zero returns false and stays at zero', () => {
    freshSave({ powerups: { clean: 0, undo: 0, moves: 0 } } as Partial<SaveData>)
    expect(saveManager.usePowerup('undo')).toBe(false)
    expect(saveManager.powerupCount('undo')).toBe(0)
  })
})

describe('daily gift', () => {
  it('claims once per calendar day, then refuses', () => {
    const day1 = new Date(2026, 7, 6, 9, 0)
    const r = saveManager.claimDaily(day1)
    expect(r).toEqual({ honey: 20, streak: 1 })
    expect(saveManager.claimDaily(new Date(2026, 7, 6, 23, 59))).toBeNull()
  })

  it('climbs the 7-rung ladder on consecutive days; day 7 repeats', () => {
    saveManager.claimDaily(new Date(2026, 7, 6))
    expect(saveManager.claimDaily(new Date(2026, 7, 7))).toEqual({ honey: 30, streak: 2 })
    expect(saveManager.claimDaily(new Date(2026, 7, 8))).toEqual({ honey: 40, streak: 3 })
    saveManager.claimDaily(new Date(2026, 7, 9)) // 55
    expect(saveManager.claimDaily(new Date(2026, 7, 10))).toEqual({ honey: 70, streak: 5 })
    saveManager.claimDaily(new Date(2026, 7, 11)) // 90
    expect(saveManager.claimDaily(new Date(2026, 7, 12))).toEqual({ honey: 120, streak: 7 })
    // Day 8+ keeps paying the top rung while the streak holds.
    expect(saveManager.claimDaily(new Date(2026, 7, 13))?.honey).toBe(120)
  })

  it('a missed day drops ONE rung (soft reset), never back to day 1', () => {
    for (let d = 6; d <= 10; d++) saveManager.claimDaily(new Date(2026, 7, d)) // streak 5
    // Skip Aug 11; claim Aug 12 → streak drops to 4 (rung 55), not 1.
    expect(saveManager.claimDaily(new Date(2026, 7, 12))).toEqual({ honey: 55, streak: 4 })
  })

  it('win streak multiplies the haul (×1.5 from 3, ×2 from 5) and a loss breaks it', () => {
    // Wins on fresh levels: base = stars*5 = 15.
    expect(saveManager.recordWin(1, 3, 300)).toBe(15) // streak 1, ×1
    expect(saveManager.recordWin(2, 3, 300)).toBe(15) // streak 2, ×1
    expect(saveManager.recordWin(3, 3, 300)).toBe(23) // streak 3, ×1.5 → round(22.5)
    saveManager.recordWin(4, 3, 300) // streak 4
    expect(saveManager.recordWin(5, 3, 300)).toBe(30) // streak 5, ×2
    expect(saveManager.winStreak).toBe(5)
    saveManager.breakWinStreak()
    expect(saveManager.winStreak).toBe(0)
    expect(saveManager.recordWin(6, 3, 300)).toBe(15) // back to ×1
  })
})

describe('hostile-argument hardening', () => {
  it('economy mutators ignore NaN/Infinity/negative amounts', () => {
    saveManager.addHoney(10)
    saveManager.addHoney(Number.NaN)
    saveManager.addHoney(Number.POSITIVE_INFINITY)
    saveManager.addHoney(-5)
    expect(saveManager.honey).toBe(10)
    expect(saveManager.spendHoney(Number.NaN)).toBe(false)
    expect(saveManager.honey).toBe(10)
    saveManager.grantPowerup('undo', Number.NaN)
    saveManager.grantPowerup('undo', -3)
    expect(saveManager.powerupCount('undo')).toBe(3) // untouched default
  })

  it('claimDaily refuses when the stored date is in the future (clock rollback)', () => {
    saveManager.claimDaily(new Date(2026, 7, 10))
    // Device clock rolled back a day — the same calendar day must not pay again.
    expect(saveManager.claimDaily(new Date(2026, 7, 9))).toBeNull()
    // And the day after the ORIGINAL claim still works normally.
    expect(saveManager.claimDaily(new Date(2026, 7, 11))).not.toBeNull()
  })
})

describe('level fail tracking (difficulty easing)', () => {
  it('counts fails per level, clears on win, persists through reloads', () => {
    saveManager.recordLevelFail(42)
    saveManager.recordLevelFail(42)
    expect(saveManager.levelFailCount(42)).toBe(2)
    // Simulate an app restart: reload from storage.
    const s = saveManager as unknown as { loaded: boolean }
    s.loaded = false
    saveManager.load()
    expect(saveManager.levelFailCount(42)).toBe(2)
    saveManager.clearLevelFails(42)
    expect(saveManager.levelFailCount(42)).toBe(0)
  })
})

describe('transaction ledger (purchase dedupe)', () => {
  it('marks and dedupes transaction ids', () => {
    expect(saveManager.hasGrantedTransaction('tx1')).toBe(false)
    saveManager.markTransactionGranted('tx1')
    saveManager.markTransactionGranted('tx1')
    expect(saveManager.hasGrantedTransaction('tx1')).toBe(true)
    expect(saveManager.get().grantedTransactionIds.filter((t) => t === 'tx1')).toHaveLength(1)
  })
})
