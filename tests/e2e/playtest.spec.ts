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
  occupants: Array<{ q: number; r: number; kind: string; outcome: string; pathLen: number }>
}

async function waitForGame(page: Page): Promise<void> {
  await dismissSplash(page)
  await page.waitForFunction(() => {
    const g = (window as any).__game
    return !!g && g.scene.getScenes(true).length > 0
  }, null, { timeout: 30_000 })
}

/**
 * The studio sting covers the canvas for its ~5 s and eats the first pointer
 * event as a skip. Every test drives real pointer events at the canvas, so it
 * has to be gone first — otherwise the opening tap of each test is spent
 * dismissing it.
 */
async function dismissSplash(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__dismissSplash?.())
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 10_000 })
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
        // How many cells the flight would CROSS. On a sealed board a bee can
        // sit right next to its door and leave without crossing anything, so
        // "it flew" and "it laid a trail" are no longer the same event.
        pathLen: board.trace(o).path.length,
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
  // HOLD past the launch threshold. Under the sealed-rim rules a short press
  // TURNS the bee and only a long one sends it, so a 60ms tap — which used to
  // fly it — now just rotates and the level never progresses.
  await page.waitForTimeout(380)
  await page.mouse.up()
  // Phaser processes pointer events on its NEXT update frame — checking
  // inputLocked immediately would pass before the flight even starts. Give it
  // two frames to begin, THEN wait for the flight to resolve (input unlock);
  // long flights on the bigger boards outlast any fixed delay.
  await page.waitForTimeout(120)
  await page.waitForFunction(() => {
    const g = (window as any).__game
    const s: any = g.scene.getScene('Game')
    return !s || !s.scene.isActive() || !s.inputLocked
  }, null, { timeout: 10_000 })
  await page.waitForTimeout(120)
}


/**
 * SHORT press on a cell — under the sealed-rim rules this TURNS the bee 60°
 * instead of launching it. Aiming and committing are the same gesture at two
 * durations, so a test that only ever holds can never aim.
 */
async function rotateCell(page: Page, snap: BoardSnapshot, q: number, r: number): Promise<void> {
  const gx = snap.origin.x + snap.cellSize * SQRT3 * (q + r / 2)
  const gy = snap.origin.y + snap.cellSize * 1.5 * r
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas not found')
  const x = box.x + (gx / GAME_W) * box.width
  const y = box.y + (gy / GAME_H) * box.height
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(80) // well under the launch threshold
  await page.mouse.up()
  await page.waitForTimeout(140)
}

/**
 * Turn a bee until its flight would actually do something, then send it.
 * Returns false if six turns bring it back where it started with no way out —
 * which on a sealed board is a real state, not a test failure.
 */
async function aimAndFly(page: Page, q: number, r: number): Promise<boolean> {
  for (let turn = 0; turn < 6; turn++) {
    const snap = await snapshot(page)
    const bee = snap.occupants.find((o) => o.q === q && o.r === r)
    if (!bee) return false
    const goals = snap.occupants.filter((o) => o.kind !== 'hornet').length
    const usable =
      (bee.outcome === 'escaped' || bee.outcome === 'stuck') &&
      !(bee.kind === 'queen' && bee.outcome === 'escaped' && goals > 1)
    if (usable) {
      await tapCell(page, snap, q, r)
      return true
    }
    await rotateCell(page, snap, q, r)
  }
  return false
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

    // Play the obvious competent line under the sealed-rim rules: for each bee
    // in turn, TURN it until its flight would do something, then send it. The
    // model confirms this greedy policy clears level 1 in its minimum 4 moves,
    // so a failure here is the INPUT path, which is exactly what an e2e is for.
    for (let i = 0; i < 30; i++) {
      const snap = await snapshot(page)
      if (snap.remaining === 0 || snap.status !== 'playing') break
      let moved = false
      for (const cand of snap.occupants.filter((o) => o.kind !== 'hornet')) {
        if (await aimAndFly(page, cand.q, cand.r)) {
          moved = true
          break
        }
      }
      if (!moved) throw new Error(`no bee could be aimed and flown at step ${i}`)
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
    // NOT a start-state property: no shipped level opens with a bumpable bee.
    // Sweeping all 300 openings gives 1570 'escaped' + 822 'stuck' and exactly
    // ZERO 'blocked' — under permanent honey a bee's neighbours are reachable
    // honey, so it sticks rather than bumping. The rule only becomes reachable
    // once a bee has landed mid-board and turned into a wall.
    //
    // So the test manufactures that state with a policy it can reproduce
    // without hard-coding coordinates (which any regeneration would break):
    // fly the bee whose flight ends 'stuck', then look for whoever it now
    // blocks. Verified to take a single tap on each level scanned below.
    let snap: BoardSnapshot | undefined
    const isBlocked = (s: BoardSnapshot) =>
      s.occupants.some((o) => o.kind !== 'hornet' && o.outcome === 'blocked')

    for (const idx of [40, 44, 100, 150, 200, 299]) {
      await startLevel(page, idx)
      let s = await snapshot(page)
      for (let tap = 0; tap < 3 && s.status === 'playing' && !isBlocked(s); tap++) {
        const stuck = s.occupants.find((o) => o.kind !== 'hornet' && o.outcome === 'stuck')
        if (!stuck) break
        await tapCell(page, s, stuck.q, stuck.r)
        s = await snapshot(page)
      }
      if (isBlocked(s)) {
        snap = s
        break
      }
    }
    expect(snap, 'no scanned level ever produced a bumpable bee').toBeDefined()

    const before = snap!.movesLeft
    const blocked = snap!.occupants.find((o) => o.kind !== 'hornet' && o.outcome === 'blocked')!
    await tapCell(page, snap!, blocked.q, blocked.r)

    const after = await snapshot(page)
    expect(after.movesLeft).toBe(before - 1) // the move is spent...
    expect(after.remaining).toBe(snap!.remaining) // ...and nobody escaped
    // The bumped bee is still exactly where it was — a bump is not a relocation.
    expect(after.occupants.some((o) => o.q === blocked.q && o.r === blocked.r)).toBe(true)
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
    // Permanent honey sits under every goal occupant from the start, PLUS the
    // lakes the generator seeds from L13 on. So a fresh board carries at least
    // one cell per bee — it used to be exactly one, before lakes existed.
    const goals = snap.occupants.filter((o) => o.kind !== 'hornet').length
    expect(snap.sticky, 'fresh board: honey under every bee, plus lakes').toBeGreaterThanOrEqual(
      goals,
    )
    const before = snap.sticky

    // Aim first: on a sealed board a bee usually starts facing a wall. And the
    // flight has to actually CROSS cells — a bee beside its door leaves without
    // touching anything, which is a fine move and a useless trail test.
    let flew = false
    for (const cand of snap.occupants.filter((o) => o.kind !== 'hornet')) {
      for (let turn = 0; turn < 6 && !flew; turn++) {
        const now = await snapshot(page)
        const bee = now.occupants.find((o) => o.q === cand.q && o.r === cand.r)
        if (!bee) break
        // Must ESCAPE, not stick. A landing COLLECTS the honey it lands in, so
        // a stuck flight nets +path −1 and a one-cell hop leaves the count
        // unchanged — which looks exactly like "no trail was laid".
        if (bee.outcome === 'escaped' && bee.pathLen > 0) {
          await tapCell(page, now, bee.q, bee.r)
          flew = true
          break
        }
        await rotateCell(page, now, bee.q, bee.r)
      }
      if (flew) break
    }
    expect(flew, 'no bee could be aimed into a flight that crosses cells').toBe(true)

    const after = await snapshot(page)
    expect(after.sticky, 'the flight should have smeared more honey').toBeGreaterThan(before)
  })

  test('a fresh trail catches the next bee to cross it', async ({ page }) => {
    // Fly a bee, then look for someone whose path now ends in the honey. Which
    // level offers that depends on the layout, so scan a few.
    let caught = false
    for (let idx = 20; idx < 34 && !caught; idx++) {
      await startLevel(page, idx)
      const snap = await snapshot(page)
      // Never fly the queen while others remain — that is an instant loss, and
      // on the current boards she is often the first bee with a clear path.
      const goals = snap.occupants.filter((o) => o.kind !== 'hornet').length
      // Aim before sending: on a sealed board nobody starts with a clear lane.
      let flew = false
      for (const cand of snap.occupants.filter(
        (o) => o.kind !== 'hornet' && !(o.kind === 'queen' && goals > 1),
      )) {
        if (await aimAndFly(page, cand.q, cand.r)) {
          flew = true
          break
        }
      }
      if (!flew) continue

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
      // The bee RELOCATED: its start cell is now empty (nobody else can have
      // moved onto it — only one bee flew), while the goal count held above.
      expect(
        after.occupants.some((o) => o.q === sticky.q && o.r === sticky.r),
        'the stuck bee should have left its start cell',
      ).toBe(false)
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
