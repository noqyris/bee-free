/**
 * Capture the Shop screen at an App Store Connect **IAP review screenshot**
 * size. Every in-app purchase needs one attached or the product sits in
 * MISSING_METADATA and can never be submitted.
 *
 * The game canvas is 720x1280 (9:16) and 1242x2208 is the same aspect ratio,
 * so a 1242x2208 viewport yields a full-bleed shot with no letterboxing — an
 * accepted review-screenshot size that needs no post-processing.
 *
 * Needs the dev server up (it is the build that exposes `window.__game`):
 *   npm run dev -- --port 5173 --strictPort
 *   npx tsx scripts/iapReviewShot.mts [outPath]
 */
import { chromium } from '@playwright/test'

const OUT = process.argv[2] ?? './iap-review-shot.png'
const URL = 'http://localhost:5173/'

/** A save with honey and power-ups so the Shop renders in its normal state. */
const SAVE = {
  schemaVersion: 1,
  currentLevel: 47,
  stars: Object.fromEntries(Array.from({ length: 46 }, (_, i) => [i + 1, (i % 3) + 1])),
  honey: 340,
  powerups: { clean: 3, undo: 2, moves: 1 },
  unlockedSkins: ['classic'],
  activeSkin: 'classic',
  dailyStreak: 2,
  // Already claimed today: the daily-gift modal must not cover the Shop.
  lastDailyDate: '2099-01-01',
  levelFails: {},
  grantedTransactionIds: [],
  removeAdsPurchased: false,
  settings: { sfx: true, music: true, haptics: true },
  consentStatus: null,
  lastReviewPromptAt: null,
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1242, height: 2208 } })
await page.addInitScript((save) => {
  window.localStorage.setItem('beefree.save', JSON.stringify(save))
}, SAVE)
await page.goto(URL)

// Wait for HOME specifically — Boot/Preload count as active scenes too, and
// leaving Preload early ships a screenshot full of missing-texture squares.
await page.waitForFunction(
  () => {
    const g = (window as any).__game
    return !!g && g.scene.getScenes(true).some((s: any) => s.scene.key === 'Home')
  },
  null,
  { timeout: 60_000 },
)

await page.evaluate(() => {
  const g = (window as any).__game
  for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key)
  g.scene.start('Shop')
})
await page.waitForFunction(
  () => {
    const g = (window as any).__game
    const s = g.scene.getScene('Shop')
    return s && s.scene.isActive()
  },
  null,
  { timeout: 30_000 },
)
await page.waitForTimeout(2500) // let the entry tweens settle

await page.screenshot({ path: OUT })
console.log(`saved ${OUT} (1242x2208)`)
await browser.close()
