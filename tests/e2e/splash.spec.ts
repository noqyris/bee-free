import { test, expect, type Page } from '@playwright/test'

/**
 * The studio sting that plays over the boot.
 *
 * The property worth testing is not that it looks right — it is that it can
 * never trap anyone. It sits on top of the canvas at z-index 10 and swallows
 * pointer events, so a sting that fails to end is a game that cannot be played.
 * Every test below is some version of "it goes away".
 */

const SAVE_WITH_SOUND_ON = {
  schemaVersion: 1,
  currentLevel: 1,
  stars: {},
  honey: 0,
  powerups: { clean: 1, undo: 1, moves: 1 },
  unlockedSkins: ['classic'],
  activeSkin: 'classic',
  dailyStreak: 0,
  lastDailyDate: null,
  levelFails: {},
  grantedTransactionIds: [],
  removeAdsPurchased: false,
  settings: { sfx: true, music: true, haptics: true },
  consentStatus: null,
  lastReviewPromptAt: null,
}

const splashGone = (page: Page): Promise<boolean> =>
  page.evaluate(() => !document.getElementById('splash'))

async function atHome(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const g = (window as any).__game
    return !!g && g.scene.getScenes(true).some((s: any) => s.scene.key === 'Home')
  })
}

test.describe('boot sting', () => {
  test('covers the screen and actually plays', async ({ page }) => {
    await page.goto('/')

    const box = await page.locator('#splash').boundingBox()
    const view = page.viewportSize()!
    expect(box, 'sting is not on screen').not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(view.width)
    expect(box!.height).toBeGreaterThanOrEqual(view.height)

    // Muted + playsinline, so autoplay is allowed everywhere without a gesture
    // — the same reason it works in the WKWebView. If the clip is ever swapped
    // for one with an audio track, this is what fails.
    const muted = await page.locator('#splash-video').evaluate((v: HTMLVideoElement) => v.muted)
    expect(muted, 'an unmuted clip will not autoplay').toBe(true)

    await page.waitForFunction(
      () => {
        const v = document.getElementById('splash-video') as HTMLVideoElement | null
        return !!v && !v.paused && v.currentTime > 0.2
      },
      null,
      { timeout: 10_000 },
    )
  })

  test('ends on its own and leaves the game playable', async ({ page }) => {
    await page.goto('/')
    // The clip is ~5.2 s; the inline backstop adds 1.2 s on top of its real
    // duration. Anything past that and the sting has hung.
    await expect.poll(() => splashGone(page), { timeout: 12_000 }).toBe(true)
    // Polled, not asserted outright: on a cold dev server Vite pre-bundles
    // Phaser on the first request and the boot can trail the sting by seconds.
    // That is the harness, not the game — on device the bundle is already built.
    await expect.poll(() => atHome(page), { timeout: 30_000 }).toBe(true)
    // Nothing invisible left over the canvas: Home must take a tap.
    await expect.poll(() => page.locator('#splash').count(), { timeout: 2_000 }).toBe(0)
  })

  test('a tap skips it', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(700) // past the 400 ms arming delay
    await page.mouse.click(200, 300)
    await expect.poll(() => splashGone(page), { timeout: 4_000 }).toBe(true)
  })

  test('reduced motion skips it entirely', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect.poll(() => splashGone(page), { timeout: 4_000 }).toBe(true)
  })

  test('the skip tap never reaches the button underneath', async ({ page }) => {
    // Home's setting pills fire on POINTERUP, and Phaser listens for pointerup
    // on `window` as well as on the canvas — so a skip tap that only swallowed
    // the press would release onto whatever sits under the finger. Home is
    // already built and listening ~130 ms in, long before the sting ends.
    await page.addInitScript(
      (save) => localStorage.setItem('beefree.save', JSON.stringify(save)),
      SAVE_WITH_SOUND_ON,
    )
    await page.goto('/')
    await page.waitForTimeout(700) // past the 400 ms arming delay

    // Dead centre of the "Sound" pill: game (360 - 98, 822).
    const box = await page.locator('canvas').boundingBox()
    if (!box) throw new Error('canvas not found')
    await page.mouse.move(box.x + (262 / 720) * box.width, box.y + (822 / 1280) * box.height)
    await page.mouse.down()
    await page.waitForTimeout(70)
    await page.mouse.up()

    await expect.poll(() => splashGone(page), { timeout: 4_000 }).toBe(true)
    await page.waitForTimeout(400)
    const sfx = await page.evaluate(
      () => JSON.parse(localStorage.getItem('beefree.save') || '{}')?.settings?.sfx,
    )
    expect(sfx, 'the skip tap toggled the Sound pill behind the sting').toBe(true)
  })

  test('signals the game while it owns the screen', async ({ page }) => {
    // The flag the native side gates on: no banner, no consent form and no ATT
    // prompt may be drawn over the sting, and all three wait on this.
    await page.goto('/')
    expect(await page.evaluate(() => window.__splashActive)).toBe(true)
    await expect
      .poll(() => page.evaluate(() => window.__splashActive), { timeout: 12_000 })
      .toBe(false)
    // Flag and DOM agree — a false "all clear" with the clip still up would put
    // an ad bar across it.
    expect(await splashGone(page)).toBe(true)
  })

  test('a broken clip does not block the boot', async ({ page }) => {
    // The failure that would otherwise ship silently: the file is missing from
    // the build, `ended` never fires, and the player stares at black.
    await page.route('**/splash.mp4', (r) => r.abort())
    await page.goto('/')
    await expect.poll(() => splashGone(page), { timeout: 10_000 }).toBe(true)
    await expect.poll(() => atHome(page), { timeout: 15_000 }).toBe(true)
  })
})
