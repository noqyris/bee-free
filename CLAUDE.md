# Bee Free: Hive Escape Puzzle — project guide

> This file is auto-loaded into context. It is the fast on-ramp: what the game
> is, how the code is shaped, the rules that must never break, and where to read
> more. Deeper detail lives in [docs/](docs/) — see the index at the bottom.
>
> **Currency of this doc:** the older [README.md](README.md) and
> [store/metadata.md](store/metadata.md) were written for an earlier design
> (150 levels, a *drying* honey trail). The game now ships **300 levels** with
> **permanent honey**. When something disagrees, the source files and this guide
> win. See [docs/STATUS.md](docs/STATUS.md) for what is stale.

## What it is

A hybrid-casual directional puzzle for **iOS**. The hive is overcrowded; you tap
bees to fly them out. Each bee faces one fixed direction and flies in a straight
line when tapped: clear path → it escapes; blocked → it bumps back and the move
is still spent. Free every bee within the move budget to win (1–3 stars by how
many moves you had to spare).

**The core mechanic is honey + collection** (this is the whole game):

- Every cell a bee/queen **starts on is honey**, and every cell a bee **flies
  over turns to honey**. Honey never dries on its own.
- A bee that flies **into** any honey stops dead in it ("stuck") — and
  **COLLECTS it**: the landing cell's honey is removed from the board and banks
  **+1 honey currency** (paid out on the win via `recordWin`). A second tap
  flies the bee onward, leaving its takeoff cell clean.
- So the puzzle is the **ORDER**: each bee lays a honey wall behind it, and a
  deliberate landing is the pressure valve — it costs a move but eats one honey
  cell (reopening that lane cell) and earns honey. Levels also start with 2
  pre-placed honey "lakes" (from L35) that double as pickups.
- **Sticky Hive specials** (every x5 level from L45, `LevelData.flooded`): the
  board starts 40–60% honeyed and the game inverts — carve the hive clean in
  the right order (carved lanes RESEAL when flown through). Coverage is capped
  at 0.6 by measurement (full floods play as orderless grind); their honey
  payout is capped (`FLOODED_HONEY_CAP`) so they can't be farmed.
- **Compass Hive mode** (`LevelData.compass`, own 50-level ladder in
  `src/levels/compass.generated.json`, unlocked after campaign L40): bees wear
  COLORS, the rim is a wall except at matching colored GATES, and rotation is
  free (release on the bee = turn 60°, release on its lane = fly; only flights
  spend moves). Multi-hop routing through honey. Own solver pair
  (`searchCompassMinMoves` / `compassPlannerLossRate`), own generator
  (`scripts/genCompassLevels.ts`), own save track (`recordCompassWin`).
  NEVER retrofit rotation onto the 300 campaign levels — free rotation
  provably collapses the fixed-direction ordering puzzle.

**You cannot lose to a dead board.** A move that leaves the hive *sealed* —
every remaining tap either bumps or is the queen escaping early — is rewound and
**costs a move** (`BoardState.isSealed()` / `chargeMove()`,
`GameScene.rescueIfSealed`). Measured session sims found 99% of losses were
sealed boards with ~3.8 moves still in hand, which made every loss a dead end
and the move budget an inert dial. Mistakes now cost moves, not the run. Full
numbers in [docs/GAMEPLAY.md](docs/GAMEPLAY.md).

Three occupant kinds ([src/systems/occupants.ts](src/systems/occupants.ts)):
- **bee** — goal, tappable, blocks, flies.
- **queen** — goal that must leave **LAST**; the level is lost the instant she
  escapes while any other goal remains.
- **hornet** — permanent stone wall; never tappable, never a goal, blocks
  flight. **Retired from the shipped levels** (curve requests 0): by
  construction no goal bee's lane could ever contain one, so players never
  interacted with them — the type survives in the engine only.

## Tech stack

- **Phaser 3.90** + **TypeScript (strict)** + **Vite 6**. Portrait, 720×1280
  canvas, `Phaser.Scale.FIT`.
- **Capacitor 8** iOS shell (`ios/`). Bundle id `com.beefree.hiveescape`.
- Native plugins: `@capacitor-community/admob` (ads), `@capacitor/haptics`,
  `@capacitor/preferences`, `@capawesome/capacitor-app-review`, plus a **custom
  StoreKit 2 bridge** written in Swift ([ios/App/App/StoreKitBridgePlugin.swift](ios/App/App/StoreKitBridgePlugin.swift)) — no third-party purchase SDK.
- No art binaries except `logo.png` and the boot clip `public/splash.mp4`:
  **all textures are drawn procedurally at boot** in
  [src/scenes/PreloadScene.ts](src/scenes/PreloadScene.ts).
- **The studio sting** (noqyris) plays from an inline script in
  [index.html](index.html), before Phaser is fetched, so it covers the boot
  rather than adding to it. It is skippable, can never strand the player, and
  nothing native (banner / consent / ATT) draws while it is up — see
  [src/systems/bootSplash.ts](src/systems/bootSplash.ts) and the boot section of
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The native launch screen is
  plain black to match its first frame.

## Commands

```bash
npm run dev         # play in browser (portrait viewport)
npm run build       # tsc --noEmit + vite build → dist/ (Capacitor-ready)
npm run typecheck   # strict TS, no emit
npm run gen:levels  # regenerate all 300 levels → src/levels/levels.generated.json
npm run gen:compass # regenerate the 50 Compass Hive levels (~2h)
npm test            # vitest unit tests (see flakiness note below)
npm run test:e2e    # Playwright playtests (drive window.__game)
```

Native build/ship (needs **Node ≥ 22** for the Capacitor 8 CLI): see
[docs/RELEASE.md](docs/RELEASE.md).

## The one rule that shapes the whole codebase

**[src/systems/BoardState.ts](src/systems/BoardState.ts) is the single source of
gameplay truth.** It is a pure model — no Phaser, no rendering, no timing. The
runtime scene, the offline level generator, and the solver **all drive this same
class**, so a rule can never be implemented twice and disagree. Obstacles satisfy
the `CellOccupant` interface (`isTappable` / `blocksFlight` / `isGoal`) so new
types never require special-casing in the core or the solver.

Consequences you must respect when editing:
- Change a gameplay rule → change it in `BoardState`, nowhere else. The generator
  and solver inherit it for free.
- **Direction contract:** `dir0 = E`, counter-clockwise, 60° steps. Shared by the
  `Direction` enum, `DIRECTION_VECTORS`, and the sprite-facing math. Don't reorder.
- **Coordinates:** pointy-top **axial** hexes, cells string-keyed `"q,r"`
  ([src/systems/HexGrid.ts](src/systems/HexGrid.ts)).
- **All UI strings** go through `t()` / `tp()` ([src/i18n/](src/i18n/)); EN only
  for now. Never hardcode display text in a scene.

## Repository map

```
src/
  main.ts                 Phaser game config + scene list (+ dev-only window.__game)
  types/index.ts          Axial, Direction, CellOccupant, LevelData, TapOutcome…
  systems/                pure logic (no Phaser)
    BoardState.ts         THE game model — permanent honey, tap/trace/tapClean
    occupants.ts          Bee / Queen / Hornet + createOccupant factory
    HexGrid.ts            axial math, DIRECTION_VECTORS, pixel<->axial
    boardShapes.ts        board shape specs → cells (hexagon/triangle/rhombus/…)
    Solver.ts             fast structural analysis (bump-free solvability, depth)
    SolverSearch.ts       real IDA* search (searchMinMoves) + loss-rate bots
    LevelGenerator.ts     reverse-placement generator (offline only)
    SaveManager.ts        localStorage save + honey/power-up economy
    PurchaseService.ts    IAP over the StoreKit bridge
    AdService.ts          AdMob wrapper (interstitial/rewarded/banner)
    appEnv.ts             sandbox-vs-production detection (test vs live ads)
    DifficultyDirector.ts silent +moves after repeated fails
    feedback.ts           audio+haptics façade used by scenes
  scenes/                 Phaser scenes (Boot→Preload→Home→Menu→Game→…→Shop)
  config/                 levelCurve, powerups, monetization, theme, gameConfig, juiceConfig, devConfig
  levels/
    levels.generated.json THE 300 shipped levels (static; never generated at runtime)
    index.ts              loads the JSON into typed LevelData
  i18n/                   t()/tp() + en.ts string table
scripts/genLevels.ts      offline generator entry (sharded across cores)
tests/                    vitest units + Playwright e2e
ios/App/                  Capacitor iOS project (Swift StoreKit bridge, Info.plist)
docs/                     the detailed docs indexed below
```

Scene flow: `Boot → Preload → Home → {Menu → Game → LevelComplete/LevelFailed}`,
with `Shop` reachable from Home/Menu. Full graph + per-scene detail in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Monetization at a glance

- **Ads** (AdMob): banner on every screen, interstitial every 3rd level result
  (none before level 6, 90s cooldown, and **never on the retry-after-fail
  path**), rewarded ads for revive / free power-ups / free honey / win-screen
  bonus. **"Remove Ads" kills banner + interstitial only — rewarded stays** (it
  is opt-in value; paying must never make the game poorer). **One binary picks
  test vs live ads at runtime**: TestFlight/sandbox → Google TEST ads, App Store
  → LIVE ads (via `appEnv.isSandboxBuild()` reading the StoreKit
  `AppTransaction` environment). `USE_TEST_ADS` in
  [src/config/monetization.ts](src/config/monetization.ts) forces test ads only
  when developing.
- **IAP**: one non-consumable "Remove Ads", plus **7 consumables** (a starter
  bundle, 3 honey packs, 3 power-up packs) — see
  [src/config/powerups.ts](src/config/powerups.ts) `SHOP_PRODUCTS`. Backed by the
  Swift StoreKit 2 bridge; ownership always read from `currentEntitlements`.
  **Grant-then-finish contract**: no transaction is ever `finish()`ed until JS
  confirms delivery (`finishTransaction`); cold-start/Ask-to-Buy purchases are
  drained via `getPendingTransactions()` and deduped by the
  `grantedTransactionIds` ledger — no path loses paid goods or double-grants.
- **Honey economy**: honey is the soft currency, earned by winning
  (`recordWin`), from the **daily gift** (streak, HomeScene), from rewarded ads
  (shop, win-screen bonus), or bought. Power-ups: **clean** (fly through honey
  wiping it), **undo** (revert a move; refunds a reverted clean, keeps granted
  moves), **moves** (+3, also usable as a revive on the fail screen). The shop
  is reachable from Home, Menu, and mid-level (honey chip → Shop overlay over
  the paused board). Details in [docs/GAMEPLAY.md](docs/GAMEPLAY.md) and
  [docs/MONETIZATION.md](docs/MONETIZATION.md).

## Gotchas that will bite you

- **`npm test` is flaky in the sandbox**, not in the logic: vitest's fork pool
  throws RPC timeouts after many runs and exits non-zero *with all tests passing*.
  Run a single file, use `--reporter=basic`, or verify a module with `tsx`
  directly. A non-zero exit is not proof of a real failure — read the output.
- **Levels are static.** Never generate at runtime. Editing the curve means
  re-running `npm run gen:levels` and committing the regenerated JSON.
- **Capacitor 8 CLI needs Node ≥ 22** (`nvm use 22` before `npx cap sync ios`).
  The rest of the toolchain is fine on Node 21.
- **Bump the iOS build number before every upload** — App Store Connect rejects a
  duplicate. Currently at **v1.1, build 33** (the shipped 1.0's train is closed
  on ASC — new builds must ride 1.1+).
- **Never point Playwright at `localhost:5173`.** Several games in this folder
  run Vite on the default port; `localhost` resolves to `::1` first on macOS and
  `reuseExistingServer` then adopts whichever project got there first, so the
  suite passes or fails against *another game*. The config is pinned to
  `127.0.0.1:5273`.
- **iPad orientation must list all four** in Info.plist or Apple rejects the
  portrait-only app (error 90474). iPhone stays portrait-locked.
- **The AdMob banner is a native bar over the web view** — it ignores canvas
  coords. No scene may draw below `layout.bannerSafeBottom` (1130 of 1280).

## Current status & what's next

Core loop, 300 levels, power-ups, honey economy, shop, ads, and the Swift
StoreKit bridge are all **built and working**. Difficulty went through **four playtest-driven passes**
(Aug 2026) — the final curve ships **bigger, denser boards** with a steep swarm
ramp (7 bees @ L36, 8 @ L66, 9 @ L140), slack 1 from L30, walls retired, and a
**previewing-human floor**: the aim preview makes a player a de-facto one-ply
solver, so every level from L26 is generated to defeat a one-ply proxy bot
(`plannerLossRate`) some share of the time — clearing one takes 2+ plies of
lookahead. Regen ≈ 20–40 min (hop-aware solver heuristic). The same passes
hardened the save (Preferences mirror, corrupt-save sanitizing), fixed
undo/star/preview integrity bugs, added the daily gift, in-level shop overlay,
fail-screen +3-moves revive, win-screen bonus ad, and a pile of game-feel work
(queen-fail staging, progressive honey, press feedback, doomed-state alarm).
The release flags (`DEV_UNLOCK_ALL_LEVELS`, `USE_TEST_ADS`) are at their
**release values**.

**Blocked on the user** before the next ship (Aug 9 2026 — 1 and 2 are now done):
1. ~~Create the 7 consumable IAP products~~ **done**: created over the ASC API
   (`inAppPurchases` **v2** — it *can* create products, contrary to the old note),
   all **READY_TO_SUBMIT** with price, localization, 175 territories and a review
   screenshot from `scripts/iapReviewShot.mts`. They must still be **attached to a
   submission** — a new IAP is only reviewed alongside a build.
2. ~~Refresh the store copy~~ **done**: [store/metadata.md](store/metadata.md) is
   rewritten for the shipping design, with a 1.1 What's New. Still needs
   **pushing to ASC** by hand.
3. Test the StoreKit `transactionUpdated` delivery path on a device (sandbox
   Ask-to-Buy) before the consumables go live — needs real hardware.
4. Submit for review when ready. Everything up to the TestFlight upload is
   automated; the submission itself is deliberately left to the user.

Do not commit / build / ship unless the user explicitly asks. Full state,
history, and design rationale in [docs/STATUS.md](docs/STATUS.md).

## Docs index

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module layers, scene navigation graph, per-scene responsibilities, data flow, procedural art |
| [docs/GAMEPLAY.md](docs/GAMEPLAY.md) | Full rules, permanent-honey model, occupants, stars, power-ups, difficulty director |
| [docs/LEVELS.md](docs/LEVELS.md) | Difficulty curve, reverse generator, solver + IDA* search, difficulty model, JSON format, regeneration |
| [docs/MONETIZATION.md](docs/MONETIZATION.md) | Ads (runtime test/live), StoreKit bridge, IAP catalogue, honey economy, review prompt |
| [docs/RELEASE.md](docs/RELEASE.md) | Build + ship steps, release switches, App Store gotchas, current coordinates |
| [docs/STATUS.md](docs/STATUS.md) | Done vs pending, known issues, design decisions, stale-docs list, next steps |
```
