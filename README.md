# Bee Free: Hive Escape Puzzle

Hybrid-casual directional puzzle for iOS (Phaser 3 + TypeScript + Vite, Capacitor shell later).
The hive is overcrowded — tap bees to send them flying out. A bee flies in a straight line in
the direction it faces: clear path → it escapes; blocked → it bumps, returns, and the move is
still spent.

## Status

- [x] **M1 — Core loop**: hex grid, tap-to-fly, block/bump, win/lose, move counter + stars, programmatic placeholder art, solver-backed level tests
- [x] **M2 — Level pipeline**: reverse generator + solver/validator + 150 shipped levels (`levels.generated.json`), difficulty curve (6 chapters, saw-tooth), DifficultyDirector, chapter-paged level-select map, chapter theming, local save
- [ ] M3 — Game feel (audio manager + more juice, haptics)
- [ ] M4 — Meta (skins/collection, daily challenge; honey + progress map done)
- [ ] M5 — Monetization (AdMob UMP/ATT, rewarded + interstitial, RevenueCat)
- [ ] M6 — Ship prep (Capacitor iOS, icons/splash, App Store checklist)

Partial: honey currency, a progress/level map, and per-chapter theming already exist (built alongside M2).

### Obstacles & clarity pass (post-M2 tuning)

After playtesting showed the pure-bee levels were too easy and the flight
direction was unclear, the following were added:

- **Queen** (rose bee + crown): a goal that must be the **last** to leave — the
  level is lost the instant she escapes while any other bee remains. Introduced
  from L12. Creates real ordering puzzles with a fail state.
- **Hornet** (dark red): a permanent wall — never movable, never a goal, excluded
  from the win. Introduced from L22. The generator keeps every bee's path clear
  of hornets so no bee is ever trapped.
- **Aim preview**: press-and-hold a bee to see its exact flight path — a green
  arrow if it will escape, a red X if it will bump (or if it is the queen leaving
  early). Release on the bee to fly, release elsewhere to cancel. This teaches
  the fixed-direction mechanic directly.
- **Difficulty rebalanced**: tighter move budgets, faster ramp, deeper forced
  ordering. Trivial (orderless / over-slacked) levels dropped from 40/150 to 11
  (all in the tutorial). Run `npx tsx scripts/analyzeLevels.ts` for the diagnostics.

- **Honey cells** (23 "puzzle" levels, every 5th from L40): a bee flying through
  an empty honey cell gets **stuck** on it and becomes a new blocker. This is the
  one mechanic that breaks the "removing a bee only unblocks" monotonicity — so
  escape **order genuinely matters** and a legal move can strand you into an
  unsolvable state. Because solvability is no longer guaranteed by construction,
  `src/systems/SolverSearch.ts` runs a real BFS (over the actual BoardState
  rules) to validate every honey level and derive its move budget from the true
  minimum. The aim preview shows an amber "will stick" marker; a coach hint
  teaches it. Honey levels are kept small and queen/hornet-free so validation is
  fast (full generation ~9s).

Still deferred: wax-capped and sleeping bees (the `CellOccupant` interface is
ready for them).

## Development

```bash
npm install
npm run dev         # play in browser (portrait viewport recommended)
npm run gen:levels  # regenerate the 150 levels → src/levels/levels.generated.json
npm test            # unit tests incl. bump-free solvability of all 150 levels
npm run typecheck   # strict TS
npm run build       # production bundle (relative base, Capacitor-ready)
```

## Run as a native iOS app (Capacitor)

The Capacitor iOS shell is set up (`ios/`, `capacitor.config.ts`, appId
`com.beefree.hiveescape`, portrait-locked). The **Capacitor 8 CLI needs Node ≥ 22**
(the rest of the toolchain runs on Node 21 fine), so select it first:

```bash
nvm use 22
npm run build                       # web bundle → dist/
npx cap sync ios                    # copy dist into the iOS project
# build + install + launch on a booted simulator:
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination "id=<SIMULATOR_UDID>" \
  -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build
xcrun simctl install <SIMULATOR_UDID> ios/build/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch  <SIMULATOR_UDID> com.beefree.hiveescape
```

`xcrun simctl list devices booted` lists simulator UDIDs. Capacitor 8 uses Swift
Package Manager (no CocoaPods). After changing web code, re-run `npm run build`
then `npx cap sync ios`.

## Level generation (M2)

Levels are generated **offline** and shipped as static JSON — never generated at
runtime. `npm run gen:levels` builds all 150 from the difficulty curve
(`src/config/levelCurve.ts`) using solvability-guaranteed **reverse generation**
(`src/systems/LevelGenerator.ts`): the last-to-escape bee is placed first on an
empty board, and each earlier bee is placed so its straight path is clear of
every already-placed bee — so escaping in reverse-placement order is always a
valid, bump-free solution. `src/systems/Solver.ts` validates each board and
scores difficulty (dependency-chain depth, blocked-at-start count, fill,
bee count). The test suite re-verifies every level is solvable within budget, so
CI fails if a bad level ever ships.

Difficulty is 6 chapters × 25 levels with a saw-tooth ramp (a spike every 10th
level, a breather after), tightening move budgets and 3-star thresholds. The
runtime `DifficultyDirector` silently grants +2 moves after 3 consecutive fails.

## Architecture notes

- `src/systems/BoardState.ts` is the **pure** game model (no Phaser). The runtime scene, the
  M2 offline generator, and the solver all drive this one class — gameplay rules live in
  exactly one place. Obstacles implement the `CellOccupant` interface (`isTappable`,
  `blocksFlight`) so new types never require special-casing in the core.
- Direction contract: `dir0 = E`, counterclockwise, 60° steps — shared by the `Direction`
  enum, `DIRECTION_VECTORS`, and the future sprite naming `bee_{skin}_dir{0-5}_*.png`.
- All feel timings/eases live in `src/config/juiceConfig.ts`.
- All strings go through `src/i18n` (`t()`); EN table only for now.
- Placeholder art is generated at boot in `PreloadScene` — final Meshy/fal.ai assets replace
  texture keys via a load manifest with zero gameplay-code changes.

## Placeholder SFX list (to source for M3)

| Key | Sound | Notes |
|---|---|---|
| `sfx_pop` | Bright escape "pop" | Pitch rises per combo escape, resets after 2 s idle |
| `sfx_bonk` | Comedic bump | Dry, short, slightly rubbery |
| `sfx_whoosh` | Flight take-off | Layered under pop |
| `sfx_stuck` | Honey squelch | For honey cells (M2 obstacle) |
| `sfx_crack` | Wax cap cracking | Wax bee unlock |
| `sfx_win_fanfare` | Short win jingle | ≤ 2 s |
| `sfx_star_slam` | Star impact thud | ×3 with rising pitch |
| `sfx_fail` | Soft descending "aww" | Never punishing |
| `sfx_button` | UI tap | Subtle |
| `music_hive` | Menu/game loop | Warm, lazy swing, ~90 s loop |

## Ship-prep reminders (M6 — do not forget)

- Add **app-ads.txt** to the studio domain (AdMob publisher ID).
- Configure **SKAdNetworkItems** in `Info.plist` per current AdMob docs.
- ATT prompt needs a soft pre-prompt screen; UMP consent must run **before** any ad request.
- App Store privacy nutrition labels must cover AdMob + Firebase Analytics data collection.
