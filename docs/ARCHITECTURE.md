# Architecture

How the code is layered, how scenes hand off to each other, and how data flows
from static JSON to pixels. Start with [../CLAUDE.md](../CLAUDE.md) for the
one-paragraph version.

## Layers

The codebase is deliberately split so that **gameplay logic never touches
Phaser** and Phaser never re-implements a rule.

```
┌──────────────────────────────────────────────────────────────┐
│  scenes/            Phaser: rendering, input, animation, HUD   │  ← only layer that imports Phaser
├──────────────────────────────────────────────────────────────┤
│  systems/           pure logic: BoardState, Solver, generator, │
│                     SaveManager, AdService, PurchaseService     │
├──────────────────────────────────────────────────────────────┤
│  config/ + levels/  data: difficulty curve, monetization,      │
│                     themes, the 300 generated levels            │
├──────────────────────────────────────────────────────────────┤
│  types/ + i18n/ + utils/   shared contracts, strings, helpers   │
└──────────────────────────────────────────────────────────────┘
```

`systems/*` (except the ad/purchase/save façades that call Capacitor) are pure
and unit-tested. `BoardState` in particular is imported by the scene, the
generator, **and** the solver — see [../CLAUDE.md](../CLAUDE.md) "the one rule".

## Boot sequence

`main.ts` constructs the `Phaser.Game` with the scene list and FIT scaling. In
dev only, it exposes `window.__game` for the Playwright harness.

0. **The studio sting** — a ~5 s clip (`public/splash.mp4`) played by a plain
   inline script in [../index.html](../index.html), i.e. **before Phaser is even
   fetched**, so it covers the whole boot instead of adding to it. It is not a
   scene and knows nothing about the game. Three properties matter:
   - **It can never strand anyone.** A decode error, a refused autoplay or a
     clip that never fires `ended` all dismiss it; there is a duration-derived
     backstop on top. Reduced motion skips it outright.
   - **It swallows the whole gesture.** The overlay keeps eating pointer events
     through its fade-out and is only then removed — Home's pills fire on
     `pointerup`, and Phaser listens for `pointerup` on `window`, so a skip tap
     that only ate the press would toggle whatever sat underneath.
   - **Nothing native draws over it.** The banner, the consent form and the ATT
     prompt are native views over the web view; `AdService` awaits
     [`splashDone`](../src/systems/bootSplash.ts) before any of them.
1. **BootScene** (`'Boot'`) — no UI. `saveManager.load()` (must run before any
   scene reads progress), then fire-and-forget `purchaseService.init()` →
   `adService.init()` (purchases first so a restored "remove ads" entitlement
   suppresses ad setup). Inert on web. → starts `Preload`.
2. **PreloadScene** (`'Preload'`) — loads the one bitmap (`logo.png`) and
   **generates every other texture procedurally** (see below). → starts `Home`.

## Scene navigation graph

```
Boot ──▶ Preload ──▶ Home
                       │
   ┌───────────────────┼───────────────────────────┐
   │                   │                            │
   ▼                   ▼                            ▼
 Menu ─────▶ Game                              Shop  { returnTo:'Home' }
   ▲          │  ├─ launch LevelComplete (Game paused)
   │          │  │      ├─▶ Game {levelIndex+1}   (Next)
   │          │  │      ├─▶ Game {levelIndex}     (Replay)
   │          │  │      └─▶ Menu
   │          │  └─ launch LevelFailed  (Game paused)
   │          │         ├─ resume Game via reviveWithExtraMoves (watch-ad revive)
   │          │         ├─▶ Game {levelIndex}     (Retry)
   │          │         └─▶ Menu
   └──────────┘
```

- `Game` starts with `{ levelIndex }` (0-based). Home passes `currentLevel-1`;
  Menu passes the tapped `levelId-1`.
- `LevelComplete` / `LevelFailed` are **launched as overlays** over a *paused*
  `Game`, not started. Their nav buttons `scene.stop('Game')` before starting the
  next scene — except the revive path, which `scene.resume('Game')`.
- `Shop` is entered from Home (tap the honey chip) or Menu; it returns via
  `scene.start(returnTo, returnData)`.

## Scenes in one line each

| Scene | Key | Role |
|---|---|---|
| BootScene | `Boot` | Load save, warm purchases+ads, no UI. |
| PreloadScene | `Preload` | Generate all textures/anims, then enter Home. |
| HomeScene | `Home` | Front door: stat pills, hero/logo, Continue/Levels CTAs, settings toggles, how-to, store row. |
| MenuScene | `Menu` | Chapter-paged level-select map (5×5 hex nodes, locks, star pips). |
| GameScene | `Game` | The puzzle board — layout, sprites, press-to-aim/release-to-fly input, animation, HUD, power-up bar, win/lose. |
| LevelCompleteScene | `LevelComplete` | Win overlay: stars slam in, honey reward, Next/Replay/Menu. Fires interstitial + review prompt. |
| LevelFailedScene | `LevelFailed` | Fail overlay: watch-ad revive (unless queen violation), Retry/Menu. |
| ShopScene | `Shop` | Buy/earn honey + power-up packs, remove-ads, restore, watch-ad-for-honey. |

### GameScene — the heart

- `init(data)` reads `data.levelIndex` (clamped). `create()` pipeline:
  `getLevel` → `themeForChapter(chapterOf(id))` →
  `difficultyDirector.bonusMovesFor(id)` added to the budget → `new BoardState`
  → paint background → `layoutBoard` / `drawCells` / `refreshHoney` →
  `createEmitters` → `spawnOccupants` → `buildHud` → `buildPowerupBar` →
  `showCoach` → pointer listeners → `adService.showBanner()`.
- **Input:** `onPointerDown` sets a pending bee and draws the aim preview
  (`board.trace`: green = will escape, amber = will stick in honey, red = will
  bump / queen-early). `onPointerUp` commits: push an undo snapshot
  (`board.clone()`), optionally consume a `clean` charge, call `board.tapClean`
  or `board.tap`, then dispatch the animation matching `outcome.kind`.
- **Animation** (all read the pure outcome, then tween sprites):
  `beginFlightPose` snaps rotation to `directionAngle(occ.dir)+π/2` and plays the
  wing-flap anim; `animateEscape` arcs the bee off-board with a streamline stretch
  (`setScale(fs*0.9, fs*1.16)`) + particle burst + camera shake; `animateBump`
  flies to the blocker, dust puff, springs back; `animateStuck` plops onto the
  honey cell and stays. `startIdle`/`stopIdle` toggle the breathe tween + arrow.
- **Revive hook:** `reviveWithExtraMoves(extra)` is public; `LevelFailedScene`
  calls it after a paid rewarded ad. It grants moves and sets `usedRevive`, which
  caps the subsequent win at 1 star.
- Drives `BoardState` (`tap`, `tapClean`, `trace`, `clone`, `grantExtraMoves`,
  `stickyCells`, `allOccupants`, `status`, `remaining`, `movesLeft`,
  `queenLeftEarly`), `SaveManager` (`recordWin`, honey + power-up methods),
  `AdService`, `DifficultyDirector`, `feedback`. **It does not import
  `LevelGenerator`** — levels arrive as data via `getLevel`.

### Power-up bar (in GameScene)

- `buildPowerupBar()` builds the honey chip (`🍯` + `honeyChip` text) and one
  `makePowerupButton` per `POWERUP_KEYS` (`clean`, `undo`, `moves`).
- `onPowerupTap(key)`: if the player owns 0, opens `offerGetPowerup(key)` (a modal
  with *buy-with-honey* if `honey ≥ honeyCost` and *watch-ad* if
  `adService.canOfferRewarded()`); otherwise dispatches:
  - **clean** → `armClean()` (arms a target-tap; the actual wipe is in
    `onPointerUp` via `usePowerup('clean')` + `board.tapClean(q,r)`).
  - **undo** → `doUndo()` (pop `history` snapshot, reassign `this.board`,
    `rebuildBoardView()`). Snapshots are pushed before every move; `history` is
    capped at 40.
  - **moves** → `useMoves()` (`board.grantExtraMoves(MOVES_POWERUP_AMOUNT)`).
- `refreshPowerupCounts()` re-reads `saveManager.powerupCount(key)` and honey.

## Procedural art (PreloadScene)

No sprite sheets are shipped; everything is drawn once at boot with Phaser
`Graphics` → `generateTexture`.

| Builder | Texture(s) | Notes |
|---|---|---|
| `makeHexTexture` | `hex` | White pointy-top hex, tinted per theme. |
| `makeBeeSheet(key, accent)` | `bee` (`0xffc633`), `beeQueen` (`0xff8ec2`) | 256×128 graphics with two poses drawn by `drawBee`, split into two 128×128 frames. Chibi/kawaii style: big glossy head, huge eyes with catch-lights, blush, antennae, striped chubby body, wings. Always upright — direction is the separate arrow. |
| `makeFlapAnim(key)` | anim `${key}-fly` | Frames 0→1, 18fps, loop; played only while flying. |
| `makeArrowTexture` | `arrow` | Gold direction arrowhead (points East / dir0), rotated per bee at runtime. |
| `makeHoneyTexture` | `honey` | Glossy amber hex-fill pool (rim, body, drips, specular). |
| `makeHornetTexture` | `hornet` | Grey stone block — deliberately *not* bee/honey colored. |
| `makeCrownTexture` | `crown` | Gold crown pinned above the queen. |
| `makeDotTexture` | `dot` | 16×16 white dot, tinted for trails/bursts/dust. |

Because gameplay refers to these by **texture key**, swapping in final art later
is a load-manifest change with zero gameplay-code impact.

## Data flow: JSON → screen

```
levels.generated.json ──(levels/index.ts maps to typed LevelData)──▶ getLevel(i)
        │                                                                  │
        └── produced offline by scripts/genLevels.ts (see docs/LEVELS.md)  ▼
                                                          GameScene.create → new BoardState(level)
                                                                             │
                                            renders cells/honey/occupants ◀──┘
                                            input → board.tap/tapClean → outcome → animate
```

## Shared UI + theming

- **UI helpers** ([src/utils/ui.ts](../src/utils/ui.ts)): `makeButton`,
  `makeIconButton`, `makeRestartButton`, `drawHoneyDrop`, `FONT_STACK`.
- **Backgrounds** ([src/utils/background.ts](../src/utils/background.ts)):
  `paintBackground` returns a `Background` with `retint(theme)`.
- **Theming** ([src/config/theme.ts](../src/config/theme.ts)): 12 `ChapterTheme`
  entries (one per chapter of 25 levels), resolved by `themeForChapter` /
  `chapterOf`. Keys: `golden-hive`, `amber-sunset`, `lavender-dusk`, `teal-deep`,
  `rose-bloom`, `midnight-swarm`, `emerald-grove`, `crimson-ember`,
  `violet-nebula`, `glacier-ice`, `coral-sunset`, `royal-abyss`.
- **Layout constants** ([src/config/gameConfig.ts](../src/config/gameConfig.ts)):
  720×1280 canvas; `hudTopY 86`, `movesPillY 198`, `boardTop 286`,
  `boardBottom 1002`, `powerupBarY 1066`, `bannerSafeBottom 1130`. Nothing draws
  below `bannerSafeBottom` (native ad bar territory).
- **Motion tuning** ([src/config/juiceConfig.ts](../src/config/juiceConfig.ts)):
  all feel timings/eases (`juice.*`).
- **Feedback façade** ([src/systems/feedback.ts](../src/systems/feedback.ts)):
  `tap`/`escape`/`stuck`/`bump`/`win`/`fail`/`star`/`unlock` — scenes call these
  instead of touching audio/haptics directly.

## Save / persistence

[src/systems/SaveManager.ts](../src/systems/SaveManager.ts) is a singleton over
`localStorage` (key `beefree.save`), with a **versioned schema + migration hook**
(`SCHEMA_VERSION = 1`). The async `load()` surface lets a Capacitor Preferences
backend drop in later with no scene changes. It owns progress (`currentLevel`,
`stars`), the **honey balance**, **power-up counts**, settings, the remove-ads
cache flag, consent status, and the review-prompt timestamp. See
[GAMEPLAY.md](GAMEPLAY.md) and [MONETIZATION.md](MONETIZATION.md) for the economy
methods.
