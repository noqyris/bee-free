/**
 * Screenshot audit: drive the running dev build through every scene/state and
 * save PNGs for a visual polish review.  Usage: npx tsx polish-shots.ts
 */
import { chromium, type Page } from '@playwright/test'

const OUT = process.argv[2] ?? "./polish-shots"
const URL = 'http://localhost:5173/'

const PROGRESSED_SAVE = {
  schemaVersion: 1,
  currentLevel: 47,
  stars: Object.fromEntries(Array.from({ length: 46 }, (_, i) => [i + 1, (i % 3) + 1])),
  honey: 340,
  powerups: { clean: 3, undo: 2, moves: 1 },
  unlockedSkins: ['classic'],
  activeSkin: 'classic',
  dailyStreak: 2,
  lastDailyDate: null, // daily gift claimable
  levelFails: {},
  grantedTransactionIds: [],
  removeAdsPurchased: false,
  settings: { sfx: true, music: true, haptics: true },
  consentStatus: null,
  lastReviewPromptAt: null,
}

async function waitGame(page: Page): Promise<void> {
  // Wait for HOME specifically: Boot/Preload count as active scenes too, and
  // driving away from Preload before it generates the textures leaves every
  // sprite as a missing-texture square.
  await page.waitForFunction(() => {
    const g = (window as any).__game
    return !!g && g.scene.getScenes(true).some((s: any) => s.scene.key === 'Home')
  }, null, { timeout: 60_000 })
}

async function startScene(page: Page, key: string, data?: unknown): Promise<void> {
  await page.evaluate(([k, d]) => {
    const g = (window as any).__game
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key)
    g.scene.start(k, d)
  }, [key, data] as const)
  await page.waitForTimeout(900)
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('shot:', name)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } })

// ---------- State A: fresh save ----------
await page.addInitScript(() => localStorage.removeItem('beefree.save'))
await page.goto(URL)
await waitGame(page)
await page.waitForTimeout(1200)
await shot(page, '01-home-fresh')
await startScene(page, 'Menu')
await shot(page, '02-menu-ch1-fresh')
await startScene(page, 'Game', { levelIndex: 0 })
await shot(page, '03-game-L1-tutorial')

// ---------- State B: progressed save ----------
await page.addInitScript((save) => localStorage.setItem('beefree.save', JSON.stringify(save)), PROGRESSED_SAVE)
await page.goto(URL)
await waitGame(page)
await page.waitForTimeout(1200)
await shot(page, '04-home-progressed')

await startScene(page, 'Menu')
await shot(page, '05-menu-ch2')

await startScene(page, 'Game', { levelIndex: 39 }) // L40: 6 bees, lakes, slack 1
await shot(page, '06-game-L40')

// Press-hold aim preview on the first tappable bee with a clean escape.
{
  const target = await page.evaluate(() => {
    const g = (window as any).__game
    const s: any = g.scene.getScene('Game')
    const b = s.board
    for (const o of b.allOccupants()) {
      if (!o.isTappable()) continue
      const kind = b.trace(o).kind
      if (kind === 'escaped' || kind === 'stuck') {
        const SQRT3 = Math.sqrt(3)
        return {
          x: s.origin.x + s.cellSize * SQRT3 * (o.q + o.r / 2),
          y: s.origin.y + s.cellSize * 1.5 * o.r,
          kind,
        }
      }
    }
    return null
  })
  if (target) {
    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    await page.waitForTimeout(350)
    await shot(page, `07-game-aim-preview-${target.kind}`)
    await page.mouse.move(target.x + 200, target.y + 200) // slide off = cancel dim
    await page.waitForTimeout(200)
    await shot(page, '08-game-aim-cancel-dim')
    await page.mouse.up()
  }
}

// Doomed state (fewer moves than bees left).
await page.evaluate(() => {
  const g = (window as any).__game
  const s: any = g.scene.getScene('Game')
  s.board.movesUsed = s.board.moveBudget - 1
  s.updateMovesHud()
})
await page.waitForTimeout(700)
await shot(page, '09-game-doomed')

// Power-up get-modal (zero owned → offer modal).
await startScene(page, 'Game', { levelIndex: 39 })
await page.evaluate(() => {
  const g = (window as any).__game
  const s: any = g.scene.getScene('Game')
  void s.offerGetPowerup('clean')
})
await page.waitForTimeout(500)
await shot(page, '10-powerup-modal')

// Shop (standalone).
await startScene(page, 'Shop', { returnTo: 'Home' })
await shot(page, '11-shop')

// Level complete overlay (staged data, incl. collected honey in the total).
await startScene(page, 'Game', { levelIndex: 39 })
await page.evaluate(() => {
  const g = (window as any).__game
  g.scene.getScene('Game').scene.pause()
  g.scene.start('LevelComplete', {
    levelIndex: 39, chapter: 2, stars: 2, honey: 13, movesUsed: 11, budget: 12, threeStarSpare: 1,
  })
})
await page.waitForTimeout(1400)
await shot(page, '12-level-complete-2stars')

// Level failed overlay with both revive rows (owns +3 Moves; ad unavailable on web).
await startScene(page, 'Game', { levelIndex: 39 })
await page.evaluate(() => {
  const g = (window as any).__game
  g.scene.getScene('Game').scene.pause()
  g.scene.start('LevelFailed', { levelIndex: 39, chapter: 2, beesLeft: 3, queenLeftEarly: false })
})
await page.waitForTimeout(900)
await shot(page, '13-level-failed')

// Queen-early fail variant.
await page.evaluate(() => {
  const g = (window as any).__game
  g.scene.start('LevelFailed', { levelIndex: 39, chapter: 2, beesLeft: 2, queenLeftEarly: true })
})
await page.waitForTimeout(900)
await shot(page, '14-level-failed-queen')

// Late-chapter look (theme + 8 bees): unlock far, load L160.
await page.addInitScript((save) => localStorage.setItem('beefree.save', JSON.stringify({ ...save, currentLevel: 200 })), PROGRESSED_SAVE)
await page.goto(URL)
await waitGame(page)
await startScene(page, 'Game', { levelIndex: 159 })
await shot(page, '15-game-L160-late')
await startScene(page, 'Menu')
await shot(page, '16-menu-late-chapter')

await browser.close()
console.log('done')
