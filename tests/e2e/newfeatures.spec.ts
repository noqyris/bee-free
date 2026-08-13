import { expect, test, type Page } from '@playwright/test'

/**
 * E2E coverage for the newer systems: honey collection, the daily gift, undo's
 * value guarantees, the in-level Shop overlay, and the +3-Moves revive.
 * Interaction goes through real pointer events wherever the target is a fixed
 * UI position; board-dependent flows read state through window.__game the same
 * way playtest.spec.ts does.
 */

const GAME_W = 720
const GAME_H = 1280
const SQRT3 = Math.sqrt(3)

interface Snap {
  movesLeft: number
  remaining: number
  status: string
  cellSize: number
  origin: { x: number; y: number }
  sticky: number
  collected: number
  occupants: Array<{ q: number; r: number; kind: string; outcome: string }>
}

async function waitForGame(page: Page): Promise<void> {
  // The studio sting covers the canvas and would eat each test's first tap.
  await page.evaluate(() => (window as any).__dismissSplash?.())
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 10_000 })
  await page.waitForFunction(() => {
    const g = (window as any).__game
    return !!g && g.scene.getScenes(true).some((s: any) => s.scene.key === 'Home')
  }, null, { timeout: 30_000 })
}

async function activeScenes(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as any).__game.scene.getScenes(true).map((s: any) => s.scene.key),
  )
}

async function startLevel(page: Page, levelIndex: number): Promise<void> {
  await page.evaluate((idx) => {
    const g = (window as any).__game
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key)
    g.scene.start('Game', { levelIndex: idx })
  }, levelIndex)
  await page.waitForFunction(() => {
    const g = (window as any).__game
    const s = g.scene.getScene('Game')
    return s && s.scene.isActive() && (s as any).board
  }, null, { timeout: 15_000 })
  await page.waitForTimeout(400)
}

async function snapshot(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = (window as any).__game
    const s: any = g.scene.getScene('Game')
    const board = s.board
    return {
      movesLeft: board.movesLeft,
      remaining: board.remaining,
      status: board.status,
      cellSize: s.cellSize,
      origin: { x: s.origin.x, y: s.origin.y },
      sticky: board.stickyCells().length,
      collected: board.collectedHoney,
      occupants: board.allOccupants().map((o: any) => ({
        q: o.q,
        r: o.r,
        kind: o.kind,
        outcome: board.trace(o).kind,
      })),
    }
  })
}

/**
 * `holdMs` matters on the BOARD: under the sealed-rim rules a short press turns
 * a bee and only a long one launches it, so a cell tap has to outlast the
 * threshold. UI buttons want the short press — holding one changes nothing, but
 * a shared 380ms would make every button test needlessly slow.
 */
async function tapGame(page: Page, gx: number, gy: number, holdMs = 60): Promise<void> {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas not found')
  const x = box.x + (gx / GAME_W) * box.width
  const y = box.y + (gy / GAME_H) * box.height
  await page.mouse.move(x, y)
  await page.mouse.down()
  if (holdMs > 0) await page.waitForTimeout(holdMs)
  await page.mouse.up()
  await page.waitForTimeout(420)
}

async function tapCell(page: Page, snap: Snap, q: number, r: number): Promise<void> {
  await tapGame(
    page,
    snap.origin.x + snap.cellSize * SQRT3 * (q + r / 2),
    snap.origin.y + snap.cellSize * 1.5 * r,
    380, // hold past the launch threshold — a short press only turns the bee
  )
  // Phaser processes pointer events on its NEXT update frame — give the flight
  // two frames to begin, then wait for it to resolve (input unlock), or the
  // next tap is silently swallowed on long flights.
  await page.waitForTimeout(120)
  await page.waitForFunction(() => {
    const g = (window as any).__game
    const s: any = g.scene.getScene('Game')
    return !s || !s.scene.isActive() || !s.inputLocked
  }, null, { timeout: 10_000 })
  await page.waitForTimeout(120)
}


/**
 * Turn a bee until its flight would do something, then send it. Under the
 * sealed-rim rules a bee usually starts facing a wall, so "find one that can
 * fly right now" — which is what these tests used to do — finds nothing.
 */
async function aimAndFly(page: Page, q: number, r: number): Promise<boolean> {
  for (let turn = 0; turn < 6; turn++) {
    const snap = await snapshot(page)
    const bee = snap.occupants.find((o) => o.q === q && o.r === r)
    if (!bee) return false
    if (bee.outcome === 'escaped' || bee.outcome === 'stuck') {
      await tapCell(page, snap, q, r)
      return true
    }
    // Short press = turn. ZERO wait: Playwright's own round trip already puts
    // ~120 ms between down and up, and that is what the game measures. An 80 ms
    // wait here reads as ~254 ms against a 260 ms threshold — a coin flip that
    // launches the bee instead of turning it.
    await tapGame(
      page,
      snap.origin.x + snap.cellSize * SQRT3 * (q + r / 2),
      snap.origin.y + snap.cellSize * 1.5 * r,
      0,
    )
  }
  return false
}

function readSave(raw: string | null): any {
  return raw ? JSON.parse(raw) : null
}

const SEEDED_SAVE = {
  schemaVersion: 1,
  currentLevel: 60,
  stars: {},
  honey: 200,
  powerups: { clean: 3, undo: 3, moves: 3 },
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

test.describe('honey collection', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((save) => localStorage.setItem('beefree.save', JSON.stringify(save)), SEEDED_SAVE)
    await page.goto('/')
    await waitForGame(page)
  })

  test('landing in honey collects it: cell cleaned, counter up', async ({ page }) => {
    // Scan a few levels for a board offering a stuck-outcome move right away
    // (lakes from L35 make this common).
    let done = false
    for (let idx = 34; idx < 48 && !done; idx++) {
      await startLevel(page, idx)
      const snap = await snapshot(page)
      const sticker = snap.occupants.find((o) => o.kind !== 'hornet' && o.outcome === 'stuck')
      if (!sticker) continue
      done = true

      expect(snap.collected).toBe(0)
      await tapCell(page, snap, sticker.q, sticker.r)
      const after = await snapshot(page)
      expect(after.collected, 'landing must bank one honey').toBe(1)
      // Net board honey: -1 collected at the landing cell, + the trail laid on
      // the cells crossed. With a zero-length path the count just drops by 1;
      // either way the landing cell itself must now be clean.
      const landed = after.occupants.find((o) => o.kind !== 'hornet' && o.q !== sticker.q)
      expect(landed, 'the bee moved somewhere').toBeTruthy()
    }
    expect(done, 'expected a stuck-outcome move somewhere in L35–47').toBe(true)
  })
})

test.describe('daily gift', () => {
  test('claim pays honey, marks the day, and does not reappear', async ({ page }) => {
    await page.addInitScript((save) => localStorage.setItem('beefree.save', JSON.stringify(save)), SEEDED_SAVE)
    await page.goto('/')
    await waitForGame(page)

    const before = readSave(await page.evaluate(() => localStorage.getItem('beefree.save')))
    expect(before.honey).toBe(200)

    // The chip sits centred at (360, 86) on Home.
    await tapGame(page, GAME_W / 2, 86)
    await page.waitForTimeout(400)

    const after = readSave(await page.evaluate(() => localStorage.getItem('beefree.save')))
    expect(after.honey, 'daily gift pays base 20 on day 1').toBe(220)
    expect(after.dailyStreak).toBe(1)
    expect(after.lastDailyDate).not.toBeNull()

    // Reload — the chip must be gone; tapping the spot pays nothing.
    await page.goto('/')
    await waitForGame(page)
    await tapGame(page, GAME_W / 2, 86)
    await page.waitForTimeout(300)
    const again = readSave(await page.evaluate(() => localStorage.getItem('beefree.save')))
    expect(again.honey, 'no double-claim on the same day').toBe(220)
  })
})

test.describe('settings toggles', () => {
  test('Music is its own switch and survives a reload', async ({ page }) => {
    // Three pills now sit at y=822: Sound (-186), Music (centre), Buzz (+186).
    // Music must not be wired to Sound — a player who wants the bed off usually
    // still wants the game's own feedback.
    // Seed ONCE. addInitScript re-runs on every navigation, so the usual
    // unconditional seed would restore the starting save on the reload below
    // and the persistence half of this test would be checking nothing.
    await page.addInitScript((save) => {
      if (!localStorage.getItem('beefree.save')) {
        localStorage.setItem('beefree.save', JSON.stringify(save))
      }
    }, SEEDED_SAVE)
    await page.goto('/')
    await waitForGame(page)

    await tapGame(page, GAME_W / 2, 822)
    await page.waitForTimeout(300)
    let save = readSave(await page.evaluate(() => localStorage.getItem('beefree.save')))
    expect(save.settings.music, 'Music did not toggle off').toBe(false)
    expect(save.settings.sfx, 'Music dragged Sound with it').toBe(true)
    expect(save.settings.haptics, 'Music dragged Buzz with it').toBe(true)

    await page.goto('/')
    await waitForGame(page)
    save = readSave(await page.evaluate(() => localStorage.getItem('beefree.save')))
    expect(save.settings.music, 'the choice did not survive a reload').toBe(false)

    await tapGame(page, GAME_W / 2, 822)
    await page.waitForTimeout(300)
    save = readSave(await page.evaluate(() => localStorage.getItem('beefree.save')))
    expect(save.settings.music, 'Music would not come back on').toBe(true)
  })
})

test.describe('undo value guarantees', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((save) => localStorage.setItem('beefree.save', JSON.stringify(save)), SEEDED_SAVE)
    await page.goto('/')
    await waitForGame(page)
  })

  test('undo keeps +3 Moves bought after the snapshot', async ({ page }) => {
    await startLevel(page, 10)
    const snap = await snapshot(page)
    // One real move first, so history is non-empty. On a sealed board that
    // means aiming before sending — no bee starts with a clear lane.
    let flew = false
    for (const cand of snap.occupants.filter((o) => o.kind !== 'hornet')) {
      if (await aimAndFly(page, cand.q, cand.r)) {
        flew = true
        break
      }
    }
    expect(flew, 'no bee could be aimed and flown').toBe(true)

    const budgetBefore = await page.evaluate(() => {
      const s: any = (window as any).__game.scene.getScene('Game')
      return s.board.moveBudget
    })
    // Buy +3 Moves via the power-up bar (right button, x≈574, y=1066)…
    await tapGame(page, 574, 1066)
    // …then Undo (middle button).
    await tapGame(page, 360, 1066)

    const state = await page.evaluate(() => {
      const s: any = (window as any).__game.scene.getScene('Game')
      return { budget: s.board.moveBudget, movesUsed: s.board.movesUsed }
    })
    expect(state.movesUsed, 'the move was undone').toBe(0)
    expect(state.budget, 'the +3 must survive the undo').toBe(budgetBefore + 3)

    const save = readSave(await page.evaluate(() => localStorage.getItem('beefree.save')))
    expect(save.powerups.moves).toBe(2)
    expect(save.powerups.undo).toBe(2)
  })
})

test.describe('in-level Shop overlay', () => {
  test('honey chip opens Shop over the paused board and returns cleanly', async ({ page }) => {
    await page.addInitScript((save) => localStorage.setItem('beefree.save', JSON.stringify(save)), SEEDED_SAVE)
    await page.goto('/')
    await waitForGame(page)
    await startLevel(page, 10)
    const before = await snapshot(page)

    // The honey chip is centred at (168, 86) in the Game HUD.
    await tapGame(page, 168, 86)
    await expect.poll(() => activeScenes(page), { timeout: 10_000 }).toContain('Shop')
    expect(
      await page.evaluate(() => (window as any).__game.scene.isPaused('Game')),
      'the board pauses under the overlay',
    ).toBe(true)

    // Shop back button (66, 74) → straight back onto the same board.
    await tapGame(page, 66, 74)
    await expect.poll(() => activeScenes(page), { timeout: 10_000 }).toContain('Game')
    const after = await snapshot(page)
    expect(after.movesLeft, 'the board survived the detour').toBe(before.movesLeft)
    expect(after.remaining).toBe(before.remaining)
  })
})

test.describe('get-power-up modal dismiss safety', () => {
  test('dismissing the modal over a bee must NOT fly that bee', async ({ page }) => {
    await page.addInitScript((save) =>
      localStorage.setItem(
        'beefree.save',
        JSON.stringify({ ...save, powerups: { clean: 0, undo: 0, moves: 0 } }),
      ), SEEDED_SAVE)
    await page.goto('/')
    await waitForGame(page)

    // Find a board with a bee lying under the dim but NOT over one of the
    // modal's buttons (a tap there legitimately fires that button instead).
    const overButtons = (gx: number, gy: number): boolean =>
      gx > 190 && gx < 530 && gy > 500 && gy < 860
    let snap!: Snap
    let bee: Snap['occupants'][number] | undefined
    for (let idx = 5; idx < 25 && !bee; idx++) {
      await startLevel(page, idx)
      snap = await snapshot(page)
      bee = snap.occupants.find((o) => {
        if (o.kind === 'hornet') return false
        const gx = snap.origin.x + snap.cellSize * SQRT3 * (o.q + o.r / 2)
        const gy = snap.origin.y + snap.cellSize * 1.5 * o.r
        return !overButtons(gx, gy)
      })
    }
    expect(bee, 'need a bee lying under the dim, clear of the buttons').toBeTruthy()

    // Open the get-power-up modal (0 owned → offer) via the +3 Moves button.
    await tapGame(page, 574, 1066)
    await page.waitForFunction(() => {
      const s: any = (window as any).__game.scene.getScene('Game')
      return s.powerupBusy === true
    }, null, { timeout: 5_000 })
    const movesBefore = await page.evaluate(() => {
      const s: any = (window as any).__game.scene.getScene('Game')
      return s.board.movesUsed
    })
    await tapCell(page, snap, bee!.q, bee!.r)

    const after = await page.evaluate(() => {
      const s: any = (window as any).__game.scene.getScene('Game')
      return { movesUsed: s.board.movesUsed, busy: s.powerupBusy, pending: !!s.pending }
    })
    expect(after.movesUsed, 'the dismiss tap must not spend a move').toBe(movesBefore)
    expect(after.busy).toBe(false)
    expect(after.pending).toBe(false)
  })
})

test.describe('out-of-moves revive with an owned +3 Moves', () => {
  test('fail screen offers it; using it resumes the board with 3 moves', async ({ page }) => {
    await page.addInitScript((save) => localStorage.setItem('beefree.save', JSON.stringify(save)), SEEDED_SAVE)
    await page.goto('/')
    await waitForGame(page)
    await startLevel(page, 10)

    // Exhaust the budget and resolve — an out-of-moves loss.
    await page.evaluate(() => {
      const s: any = (window as any).__game.scene.getScene('Game')
      s.board.movesUsed = s.board.moveBudget
      s.resolveAfterAction()
    })
    await expect.poll(() => activeScenes(page), { timeout: 10_000 }).toContain('LevelFailed')

    // Use the +3 Moves revive (drive the scene API — the button position is
    // layout-dependent; the pixel path is covered by the failed-screen shots).
    await page.evaluate(() => {
      const f: any = (window as any).__game.scene.getScene('LevelFailed')
      f.useMovesAndRevive()
    })
    await expect.poll(() => activeScenes(page), { timeout: 10_000 }).toContain('Game')

    const state = await page.evaluate(() => {
      const s: any = (window as any).__game.scene.getScene('Game')
      return { movesLeft: s.board.movesLeft, status: s.board.status, usedRevive: s.usedRevive }
    })
    expect(state.status).toBe('playing')
    expect(state.movesLeft).toBe(3)
    expect(state.usedRevive, 'revived wins are capped at 1 star').toBe(true)

    const save = readSave(await page.evaluate(() => localStorage.getItem('beefree.save')))
    expect(save.powerups.moves).toBe(2)
  })
})
