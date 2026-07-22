# Bee Free: Hive Escape Puzzle

Hybrid-casual directional puzzle for iOS (Phaser 3 + TypeScript + Vite, Capacitor shell later).
The hive is overcrowded — tap bees to send them flying out. A bee flies in a straight line in
the direction it faces: clear path → it escapes; blocked → it bumps, returns, and the move is
still spent.

## Status

- [x] **M1 — Core loop**: hex grid, tap-to-fly, block/bump, win/lose, move counter + stars, 5 hand-made test levels, programmatic placeholder art, solver-backed level tests
- [ ] M2 — Level pipeline (generator + solver + 150 levels + DifficultyDirector)
- [ ] M3 — Game feel (full juice pass, AudioManager, haptics)
- [ ] M4 — Meta (honey, skins, collection, daily challenge, progress map)
- [ ] M5 — Monetization (AdMob UMP/ATT, rewarded + interstitial, RevenueCat)
- [ ] M6 — Ship prep (Capacitor iOS, icons/splash, App Store checklist)

## Development

```bash
npm install
npm run dev        # play in browser (portrait viewport recommended)
npm test           # unit tests incl. solver validation of all levels
npm run typecheck  # strict TS
npm run build      # production bundle (relative base, Capacitor-ready)
```

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
