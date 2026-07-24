import { expect, test, type Page } from '@playwright/test'

/**
 * End-to-end playtest: drives the real game through real pointer events on the
 * canvas — press a bee to aim, release to fly — and checks the whole loop
 * (menu → level → win/lose → progression) rather than any internals.
 *
 * The dev build exposes `window.__game`, which we use only to READ state
 * (which scene is active, what is on the board) and to map hex cells to pixels.
 * Every actual interaction goes through the input system like a player's would.
 */

const GAME_W = 720
const GAME_H = 1280
const SQRT3 = Math.sqrt(3)

/** Minimal shape of what we read out of the running game. */
interface BoardSnapshot {
  scene: string
  movesLeft: number
  remaining: number
  status: string
  cellSize: number
  origin: { x: number; y: number }
  /** Cells currently covered in sticky honey — the trail. */
  sticky: number
  occupants: Array<{ q: number; r: number; kind: string; outcome: string }>
}

async function waitForGame(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const g = (window as any).__game
    return !!g && g.scene.getScenes(true).length > 0
  }, null, { timeout: 30_000 })
}

/** Name of the top-most active scene. */
async function activeScenes(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as any).__game.scene.getScenes(true).map((s: any) => s.scene.key),
  )
}

/** Jump straight into a level, bypassing menu navigation. */
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
  await page.waitForTimeout(400) // let the intro tweens settle
}

/** Read the live board, including what each occupant's flight would do. */
async function snapshot(page: Page): Promise<BoardSnapshot> {
  return page.evaluate(() => {
    const g = (window as any).__game
    const s: any = g.scene.getScene('Game')
    const board = s.board
    return {
      scene: g.scene.getScenes(true).map((x: any) => x.scene.key).join(','),
      movesLeft: board.movesLeft,
      remaining: board.remaining,
      status: board.status,
      cellSize: s.cellSize,
      origin: { x: s.origin.x, y: s.origin.y },
      sticky: board.stickyCells().length,
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
 * Press-and-release on a hex cell, translating game coordinates through the
 * FIT-scaled canvas to real screen pixels.
 */
async function tapCell(page: Page, snap: BoardSnapshot, q: number, r: number): Promise<void> {
  const gx = snap.origin.x + snap.cellSize * SQRT3 * (q + r / 2)
  const gy = snap.origin.y + snap.cellSize * 1.5 * r
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas not found')
  const x = box.x + (gx / GAME_W) * box.width
  const y = box.y + (gy / GAME_H) * box.height
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(60) // hold to show the aim preview
  await page.mouse.up()
  await page.waitForTimeout(420) // flight + resolution
}

test.describe('Bee Free — full playtest', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear())
    await page.goto('/')
    await waitForGame(page)
  })

  test('boots into the home screen', async ({ page }) => {
    expect(await activeScenes(page)).toContain('Home')
  })

  test('home → levels → board is reachable by tapping', async ({ page }) => {
    const box = await page.locator('canvas').boundingBox()
    if (!box) throw new Error('canvas not found')
    const tapGame = async (gx: number, gy: number) => {
      const x = box.x + (gx / GAME_W) * box.width
      const y = box.y + (gy / GAME_H) * box.height
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.waitForTimeout(60)
      await page.mouse.up()
      await page.waitForTimeout(400)
    }

    await tapGame(GAME_W / 2, 692) // "Levels"
    await expect.poll(() => activeScenes(page), { timeout: 10_000 }).toContain('Menu')

    await tapGame(112, 336) // first node in the grid
    await expect.poll(() => activeScenes(page), { timeout: 10_000 }).toContain('Game')
  })

  test('plays level 1 to a win and unlocks the next level', async ({ page }) => {
    await startLevel(page, 0)

    // Play the obvious competent line: fly out any bee whose path is clear,
    // and when none is, take a bee that merely gets stuck in the honey rather
    // than waste the move on a bump. Level 1 is generously budgeted, so this
    // always finishes it — the levels where it does NOT are the point of the
    // difficulty curve, and are covered by the unit tests.
    for (let i = 0; i < 30; i++) {
      const snap = await snapshot(page)
      if (snap.remaining === 0) break
      const goals = snap.occupants.filter((o) => o.kind !== 'hornet').length
      // Save the queen for last — leaving early is an instant loss.
      const usable = snap.occupants.filter(
        (o) =>
          o.kind !== 'hornet' &&
          (o.outcome === 'escaped' || o.outcome === 'stuck') &&
          !(o.kind === 'queen' && o.outcome === 'escaped' && goals > 1),
      )
      const pick = usable.find((o) => o.outcome === 'escaped') ?? usable[0]
      if (!pick) throw new Error(`no safe move at step ${i}`)
      await tapCell(page, snap, pick.q, pick.r)
    }

    await expect
      .poll(() => activeScenes(page), { timeout: 10_000 })
      .toContain('LevelComplete')

    // Progression persisted: level 2 is now unlocked.
    const unlocked = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('beefree.save') ?? '{}'),
    )
    expect(unlocked.currentLevel).toBeGreaterThanOrEqual(2)
    expect(Object.keys(unlocked.stars ?? {}).length).toBeGreaterThan(0)
  })

  test('bumping a blocked bee wastes a move', async ({ page }) => {
    // Find an early level that actually has a blocked bee to bump.
    let snap: BoardSnapshot | undefined
    for (const idx of [2, 3, 4, 5, 6]) {
      await startLevel(page, idx)
      const s = await snapshot(page)
      if (s.occupants.some((o) => o.kind !== 'hornet' && o.outcome === 'blocked')) {
        snap = s
        break
      }
    }
    test.skip(!snap, 'no blocked bee found in the early levels')

    const before = snap!.movesLeft
    const blocked = snap!.occupants.find((o) => o.kind !== 'hornet' && o.outcome === 'blocked')!
    await tapCell(page, snap!, blocked.q, blocked.r)

    const after = await snapshot(page)
    expect(after.movesLeft).toBe(before - 1)
    expect(after.remaining).toBe(snap!.remaining) // nobody escaped
  })

  test('the queen leaving early loses the level', async ({ page }) => {
    // Find a level where the queen can fly out immediately. She joins at L16
    // (index 15), but the generator seeds her first and packs bees around her,
    // so she is blocked at the start on nearly every queen level — a wide scan
    // is needed to reach a board where this rule is observable in the UI.
    let snap: BoardSnapshot | undefined
    for (let idx = 15; idx < 90; idx++) {
      await startLevel(page, idx)
      const s = await snapshot(page)
      const queen = s.occupants.find((o) => o.kind === 'queen')
      if (queen && queen.outcome === 'escaped' && s.remaining > 1) {
        snap = s
        break
      }
    }
    test.skip(!snap, 'no immediately-escapable queen found')

    const queen = snap!.occupants.find((o) => o.kind === 'queen')!
    await tapCell(page, snap!, queen.q, queen.r)

    await expect.poll(() => activeScenes(page), { timeout: 10_000 }).toContain('LevelFailed')
  })

  test('a flying bee lays a honey trail behind it', async ({ page }) => {
    await startLevel(page, 20)
    const snap = await snapshot(page)
    expect(snap.sticky, 'a fresh board starts clean').toBe(0)

    const flier = snap.occupants.find((o) => o.kind !== 'hornet' && o.outcome === 'escaped')
    if (!flier) throw new Error('no bee with a clear path on level 21')
    await tapCell(page, snap, flier.q, flier.r)

    const after = await snapshot(page)
    expect(after.sticky, 'the flight should have smeared honey').toBeGreaterThan(0)
  })

  test('a fresh trail catches the next bee to cross it', async ({ page }) => {
    // Fly a bee, then look for someone whose path now ends in the honey. Which
    // level offers that depends on the layout, so scan a few.
    let caught = false
    for (let idx = 20; idx < 34 && !caught; idx++) {
      await startLevel(page, idx)
      const snap = await snapshot(page)
      const flier = snap.occupants.find((o) => o.kind !== 'hornet' && o.outcome === 'escaped')
      if (!flier) continue
      await tapCell(page, snap, flier.q, flier.r)

      const mid = await snapshot(page)
      const sticky = mid.occupants.find((o) => o.kind !== 'hornet' && o.outcome === 'stuck')
      if (!sticky) continue
      caught = true

      const before = mid.remaining
      await tapCell(page, mid, sticky.q, sticky.r)
      const after = await snapshot(page)
      // It did not escape — it stopped in the honey and still counts as a goal.
      expect(after.remaining).toBe(before)
      expect(after.movesLeft).toBe(mid.movesLeft - 1)
      expect(after.occupants.some((o) => o.q !== sticky.q || o.r !== sticky.r)).toBe(true)
    }
    expect(caught, 'expected a trail to strand a bee somewhere in L21–L34').toBe(true)
  })

  test('no store row on web (native-only monetization)', async ({ page }) => {
    // The home screen must not offer purchases in a browser build.
    const hasStore = await page.evaluate(() => {
      const g = (window as any).__game
      const home: any = g.scene.getScene('Home')
      if (!home?.scene.isActive()) return false
      return home.children.list.some(
        (c: any) => typeof c?.text === 'string' && /Remove Ads|Restore/.test(c.text),
      )
    })
    expect(hasStore).toBe(false)
  })
})
