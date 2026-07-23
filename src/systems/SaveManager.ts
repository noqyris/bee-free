import { DEV_UNLOCK_ALL_LEVELS } from '../config/devConfig'

/**
 * Local save data (spec §9). Backed by localStorage for the web/dev build; the
 * async surface (load) lets a Capacitor Preferences backend drop in later with
 * no scene changes. Versioned schema with a migration hook from day one.
 */
export interface Settings {
  sfx: boolean
  music: boolean
  haptics: boolean
}

export interface SaveData {
  schemaVersion: number
  currentLevel: number // highest unlocked level (1-based)
  stars: Record<number, number> // levelId -> 0..3
  honey: number
  unlockedSkins: string[]
  activeSkin: string
  dailyStreak: number
  lastDailyDate: string | null
  removeAdsPurchased: boolean
  settings: Settings
  consentStatus: string | null
}

export const SCHEMA_VERSION = 1
const STORAGE_KEY = 'beefree.save'

function defaultSave(): SaveData {
  return {
    schemaVersion: SCHEMA_VERSION,
    currentLevel: 1,
    stars: {},
    honey: 0,
    unlockedSkins: ['classic'],
    activeSkin: 'classic',
    dailyStreak: 0,
    lastDailyDate: null,
    removeAdsPurchased: false,
    settings: { sfx: true, music: true, haptics: true },
    consentStatus: null,
  }
}

/** Bring any older/partial payload up to the current schema. */
function migrate(raw: unknown): SaveData {
  const base = defaultSave()
  if (!raw || typeof raw !== 'object') return base
  const data = raw as Partial<SaveData>
  // Future version-specific migrations branch on data.schemaVersion here.
  return {
    ...base,
    ...data,
    schemaVersion: SCHEMA_VERSION,
    stars: { ...base.stars, ...(data.stars ?? {}) },
    settings: { ...base.settings, ...(data.settings ?? {}) },
    unlockedSkins: data.unlockedSkins ?? base.unlockedSkins,
  }
}

class SaveManager {
  private data: SaveData = defaultSave()
  private loaded = false

  load(): void {
    if (this.loaded) return
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
      this.data = raw ? migrate(JSON.parse(raw)) : defaultSave()
    } catch {
      this.data = defaultSave()
    }
    this.loaded = true
  }

  private persist(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.data))
    } catch {
      // Ignore quota / privacy-mode failures; progress stays in memory.
    }
  }

  get(): Readonly<SaveData> {
    return this.data
  }

  starsFor(levelId: number): number {
    return this.data.stars[levelId] ?? 0
  }

  isUnlocked(levelId: number): boolean {
    // Dev toggle: every level playable for testing (see config/devConfig.ts).
    if (DEV_UNLOCK_ALL_LEVELS) return true
    return levelId <= this.data.currentLevel
  }

  get currentLevel(): number {
    return this.data.currentLevel
  }

  get honey(): number {
    return this.data.honey
  }

  /**
   * Record a win: keep the best star count, unlock the next level, award honey.
   * Returns the honey granted (so the win screen can show it).
   */
  recordWin(levelId: number, stars: number, totalLevels: number): number {
    const prev = this.starsFor(levelId)
    this.data.stars[levelId] = Math.max(prev, stars)
    if (levelId >= this.data.currentLevel && levelId < totalLevels) {
      this.data.currentLevel = levelId + 1
    }
    const gained = stars > prev ? stars * 5 : 1 // replays still trickle a little
    this.data.honey += gained
    this.persist()
    return gained
  }

  updateSettings(patch: Partial<Settings>): void {
    this.data.settings = { ...this.data.settings, ...patch }
    this.persist()
  }

  totalStars(): number {
    return Object.values(this.data.stars).reduce((a, b) => a + b, 0)
  }
}

export const saveManager = new SaveManager()
