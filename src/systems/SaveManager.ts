import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { DEV_UNLOCK_ALL_LEVELS } from '../config/devConfig'
import { POWERUP_KEYS, STARTING_POWERUPS, type PowerupKey } from '../config/powerups'

/**
 * Local save data (spec §9). localStorage is the fast synchronous source the
 * scenes read; on native every write is also mirrored into Capacitor
 * Preferences, because WKWebView website data can be purged by iOS under
 * storage pressure — and honey/power-ups bought with real money must survive
 * that. `hydrate()` (BootScene, before anything reads the save) restores the
 * mirror when localStorage came up empty or poorer.
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
  /** Owned power-ups by key. */
  powerups: Record<PowerupKey, number>
  unlockedSkins: string[]
  activeSkin: string
  dailyStreak: number
  lastDailyDate: string | null
  /** Consecutive wins with no loss in between — the win-streak flame. */
  winStreak: number
  /** Per-level fail counts for the silent difficulty easing (survives restarts). */
  levelFails: Record<number, number>
  /** Compass Hive mode: highest unlocked mode level (1-based) + its stars. */
  compassLevel: number
  compassStars: Record<number, number>
  /** StoreKit transaction ids already granted, so a re-delivery can't double-pay. */
  grantedTransactionIds: string[]
  removeAdsPurchased: boolean
  settings: Settings
  consentStatus: string | null
  /** Epoch ms of the last native review prompt, so we don't nag. */
  lastReviewPromptAt: number | null
}

export const SCHEMA_VERSION = 1
const STORAGE_KEY = 'beefree.save'
/**
 * Daily gift ladder, day 1 → 7 (day 7 repeats while the streak holds). An
 * escalating week is the highest effort-to-retention hook in current charts;
 * a missed day drops ONE rung (soft reset), never back to zero.
 */
const DAILY_LADDER = [20, 30, 40, 55, 70, 90, 120] as const

/** Win-streak honey multiplier: consecutive wins amplify the level's haul. */
export function winStreakMultiplier(streak: number): number {
  return streak >= 5 ? 2 : streak >= 3 ? 1.5 : 1
}

function startingPowerups(): Record<PowerupKey, number> {
  const out = {} as Record<PowerupKey, number>
  for (const k of POWERUP_KEYS) out[k] = STARTING_POWERUPS
  return out
}

function defaultSave(): SaveData {
  return {
    schemaVersion: SCHEMA_VERSION,
    currentLevel: 1,
    stars: {},
    honey: 0,
    powerups: startingPowerups(),
    unlockedSkins: ['classic'],
    activeSkin: 'classic',
    dailyStreak: 0,
    lastDailyDate: null,
    winStreak: 0,
    levelFails: {},
    compassLevel: 1,
    compassStars: {},
    grantedTransactionIds: [],
    removeAdsPurchased: false,
    settings: { sfx: true, music: true, haptics: true },
    consentStatus: null,
    lastReviewPromptAt: null,
  }
}

/** Integer with a finite check and clamp — corrupt saves must never poison math. */
function int(v: unknown, def: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def
  return Math.max(min, Math.min(max, Math.trunc(v)))
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def
}

/** Numeric-keyed record of clamped ints, dropping anything malformed. */
function intRecord(v: unknown, min: number, max: number): Record<number, number> {
  const out: Record<number, number> = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const key = Number(k)
    if (!Number.isInteger(key) || key < 1) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    out[key] = Math.max(min, Math.min(max, Math.trunc(raw)))
  }
  return out
}

/**
 * Bring any older/partial/corrupt payload up to the current schema. Every field
 * is type- and range-checked: a hand-edited or bit-rotted save must degrade to
 * sane values, never to NaN honey or a permanently broken economy.
 * Exported for the save-corruption unit tests.
 */
export function migrate(raw: unknown): SaveData {
  const base = defaultSave()
  if (!raw || typeof raw !== 'object') return base
  const data = raw as Partial<SaveData>
  // Future version-specific migrations branch on data.schemaVersion here.

  const powerups = startingPowerups()
  if (data.powerups && typeof data.powerups === 'object') {
    for (const k of POWERUP_KEYS) {
      powerups[k] = int((data.powerups as Record<string, unknown>)[k], powerups[k], 0, 9999)
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    currentLevel: int(data.currentLevel, base.currentLevel, 1, 100_000),
    stars: intRecord(data.stars, 0, 3),
    honey: int(data.honey, base.honey, 0, 99_999_999),
    powerups,
    unlockedSkins: Array.isArray(data.unlockedSkins)
      ? data.unlockedSkins.filter((s): s is string => typeof s === 'string')
      : base.unlockedSkins,
    activeSkin: typeof data.activeSkin === 'string' ? data.activeSkin : base.activeSkin,
    dailyStreak: int(data.dailyStreak, 0, 0, 100_000),
    lastDailyDate: typeof data.lastDailyDate === 'string' ? data.lastDailyDate : null,
    winStreak: int(data.winStreak, 0, 0, 100_000),
    levelFails: intRecord(data.levelFails, 0, 9999),
    compassLevel: int(data.compassLevel, 1, 1, 999),
    compassStars: intRecord(data.compassStars, 0, 3),
    grantedTransactionIds: Array.isArray(data.grantedTransactionIds)
      ? data.grantedTransactionIds.filter((s): s is string => typeof s === 'string').slice(-200)
      : [],
    removeAdsPurchased: bool(data.removeAdsPurchased, false),
    settings: {
      sfx: bool(data.settings?.sfx, true),
      music: bool(data.settings?.music, true),
      haptics: bool(data.settings?.haptics, true),
    },
    consentStatus: typeof data.consentStatus === 'string' ? data.consentStatus : null,
    lastReviewPromptAt:
      typeof data.lastReviewPromptAt === 'number' && Number.isFinite(data.lastReviewPromptAt)
        ? data.lastReviewPromptAt
        : null,
  }
}

/** Local calendar date as YYYY-MM-DD (daily gift compares calendar days). */
function localDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
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

  /**
   * Restore from the native Preferences mirror when it holds MORE progress than
   * localStorage (which iOS may have purged). Must run before the first scene
   * reads the save; BootScene awaits it. No-op on web and in tests.
   */
  async hydrate(): Promise<void> {
    this.load()
    if (!Capacitor.isNativePlatform()) return
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY })
      if (!value) return
      const mirror = migrate(JSON.parse(value))
      // Two axes, because a purge can hit a player who BOUGHT things before
      // winning anything: play progress first, then paid/earned value as the
      // tie-breaker. A mirror holding purchased honey/power-ups must win over
      // a freshly-defaulted localStorage even when star progress ties.
      const progress = (s: SaveData): number =>
        Object.keys(s.stars).length * 1000 + s.currentLevel
      const wealth = (s: SaveData): number =>
        s.honey +
        Object.values(s.powerups).reduce((a, b) => a + b, 0) +
        s.grantedTransactionIds.length * 10_000 +
        (s.removeAdsPurchased ? 1_000_000 : 0)
      const local = this.data
      if (
        progress(mirror) > progress(local) ||
        (progress(mirror) === progress(local) && wealth(mirror) > wealth(local))
      ) {
        this.data = mirror
        this.persist()
      }
    } catch {
      // Unreadable mirror — keep whatever localStorage gave us.
    }
  }

  private persist(): void {
    let json: string
    try {
      json = JSON.stringify(this.data)
    } catch {
      return // unserializable state should be impossible; never crash a scene
    }
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, json)
    } catch {
      // Ignore quota / privacy-mode failures; progress stays in memory.
    }
    if (Capacitor.isNativePlatform()) {
      // Fire-and-forget mirror; a failed write just means the mirror lags.
      void Preferences.set({ key: STORAGE_KEY, value: json }).catch(() => {})
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
   * The award = (star bonus + every honey the run COLLECTED by landing bees in
   * honey) × the WIN-STREAK multiplier. Consecutive wins fan the flame
   * (×1.5 from 3, ×2 from 5); a loss resets it — which is what makes the
   * fail-screen revive a "save your streak" moment.
   * Returns the honey granted (so the win screen can show it).
   */
  recordWin(levelId: number, stars: number, totalLevels: number, collectedHoney = 0): number {
    const prev = this.starsFor(levelId)
    this.data.stars[levelId] = Math.max(prev, stars)
    if (levelId >= this.data.currentLevel && levelId < totalLevels) {
      this.data.currentLevel = levelId + 1
    }
    this.data.winStreak += 1
    const base = (stars > prev ? stars * 5 : 1) + Math.max(0, Number.isFinite(collectedHoney) ? Math.trunc(collectedHoney) : 0)
    const gained = Math.round(base * winStreakMultiplier(this.data.winStreak))
    this.data.honey += gained
    this.persist()
    return gained
  }

  get winStreak(): number {
    return this.data.winStreak
  }

  // ── Compass Hive mode progress (its own ladder; campaign untouched) ────────

  /** Highest unlocked Compass level (1-based). */
  get compassLevel(): number {
    return this.data.compassLevel
  }

  compassStarsFor(levelId: number): number {
    return this.data.compassStars[levelId] ?? 0
  }

  /**
   * A Compass win: stars + unlock, feeding the SAME honey wallet and win
   * streak as the campaign (one economy, two ladders). Returns honey granted.
   */
  recordCompassWin(levelId: number, stars: number, totalLevels: number, collectedHoney = 0): number {
    const prev = this.compassStarsFor(levelId)
    this.data.compassStars[levelId] = Math.max(prev, stars)
    if (levelId >= this.data.compassLevel && levelId < totalLevels) {
      this.data.compassLevel = levelId + 1
    }
    this.data.winStreak += 1
    const base =
      (stars > prev ? stars * 5 : 1) +
      Math.max(0, Number.isFinite(collectedHoney) ? Math.trunc(collectedHoney) : 0)
    const gained = Math.round(base * winStreakMultiplier(this.data.winStreak))
    this.data.honey += gained
    this.persist()
    return gained
  }

  /** A loss breaks the win streak (called alongside the fail bookkeeping). */
  breakWinStreak(): void {
    if (this.data.winStreak === 0) return
    this.data.winStreak = 0
    this.persist()
  }

  // ── Fail tracking (difficulty easing; see DifficultyDirector) ──────────────

  recordLevelFail(levelId: number): void {
    this.data.levelFails[levelId] = (this.data.levelFails[levelId] ?? 0) + 1
    this.persist()
  }

  clearLevelFails(levelId: number): void {
    if (this.data.levelFails[levelId] === undefined) return
    delete this.data.levelFails[levelId]
    this.persist()
  }

  levelFailCount(levelId: number): number {
    return this.data.levelFails[levelId] ?? 0
  }

  // ── Daily gift ─────────────────────────────────────────────────────────────

  /** True when today's daily gift has not been claimed yet. */
  canClaimDaily(now = new Date()): boolean {
    return this.data.lastDailyDate !== localDateString(now)
  }

  /**
   * Claim the daily gift: consecutive calendar days climb the 7-rung ladder
   * (day 7 repeats while the streak holds); a missed day drops ONE rung — a
   * soft reset, never a punishing wipe. Returns null when today's gift was
   * already taken.
   */
  claimDaily(now = new Date()): { honey: number; streak: number } | null {
    const today = localDateString(now)
    // Also refuse when the stored claim date is in the FUTURE (device clock
    // rolled back / westward timezone hop) — no double-pay for one calendar
    // day. ISO dates compare correctly as strings.
    if (this.data.lastDailyDate !== null && this.data.lastDailyDate >= today) return null
    // Calendar arithmetic, not now-24h: a DST day is 23 or 25 hours long, and
    // the subtraction variant could skip or repeat a calendar day there.
    const yesterday = localDateString(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
    )
    const streak =
      this.data.lastDailyDate === yesterday
        ? this.data.dailyStreak + 1
        : Math.max(1, this.data.dailyStreak - 1)
    const honey = DAILY_LADDER[Math.min(streak, DAILY_LADDER.length) - 1]
    this.data.dailyStreak = streak
    this.data.lastDailyDate = today
    this.data.honey += honey
    this.persist()
    return { honey, streak }
  }

  // ── Power-ups + honey economy ──────────────────────────────────────────────

  powerupCount(key: PowerupKey): number {
    return this.data.powerups[key] ?? 0
  }

  /** Add power-ups (rewarded ad, shop pack, bundle). */
  grantPowerup(key: PowerupKey, n = 1): void {
    if (!Number.isFinite(n) || n <= 0) return
    this.data.powerups[key] = this.powerupCount(key) + Math.trunc(n)
    this.persist()
  }

  /** Consume one power-up if available; returns false when the player has none. */
  usePowerup(key: PowerupKey): boolean {
    if (this.powerupCount(key) <= 0) return false
    this.data.powerups[key] = this.powerupCount(key) - 1
    this.persist()
    return true
  }

  addHoney(n: number): void {
    // Finite-int guard: a NaN argument would poison the balance until reload.
    if (!Number.isFinite(n) || n <= 0) return
    this.data.honey += Math.trunc(n)
    this.persist()
  }

  /** Spend honey if the balance covers it; returns false otherwise. */
  spendHoney(n: number): boolean {
    if (!Number.isFinite(n) || n < 0 || this.data.honey < n) return false
    this.data.honey -= Math.trunc(n)
    this.persist()
    return true
  }

  // ── Purchases ──────────────────────────────────────────────────────────────

  /** Whether this StoreKit transaction id was already granted (dedupe). */
  hasGrantedTransaction(id: string): boolean {
    return this.data.grantedTransactionIds.includes(id)
  }

  markTransactionGranted(id: string): void {
    if (this.hasGrantedTransaction(id)) return
    this.data.grantedTransactionIds.push(id)
    // Cap the ledger; StoreKit ids are monotonic, old ones can't reappear.
    if (this.data.grantedTransactionIds.length > 200) {
      this.data.grantedTransactionIds = this.data.grantedTransactionIds.slice(-200)
    }
    this.persist()
  }

  updateSettings(patch: Partial<Settings>): void {
    this.data.settings = { ...this.data.settings, ...patch }
    this.persist()
  }

  /**
   * Cache of the store entitlement. StoreKit stays the source of truth (see
   * PurchaseService); this only lets the UI react instantly and offline.
   */
  setRemoveAdsPurchased(value: boolean): void {
    this.data.removeAdsPurchased = value
    this.persist()
  }

  updateConsentStatus(status: string | null): void {
    this.data.consentStatus = status
    this.persist()
  }

  markReviewPrompted(at: number): void {
    this.data.lastReviewPromptAt = at
    this.persist()
  }

  /** Levels the player has actually finished (used to pace the review prompt). */
  levelsCompleted(): number {
    return Object.keys(this.data.stars).length
  }

  totalStars(): number {
    return Object.values(this.data.stars).reduce((a, b) => a + b, 0)
  }
}

export const saveManager = new SaveManager()
