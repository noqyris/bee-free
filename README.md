# Bee Free: Hive Escape Puzzle

A hybrid-casual directional puzzle for **iOS** — Phaser 3 + TypeScript (strict) +
Vite, in a Capacitor 8 shell.

The hive is overcrowded. Tap a bee to send it flying out: each bee faces one
**fixed** direction and flies straight when tapped — clear path → it escapes;
blocked → it bumps back and the move is still spent. The twist is **permanent
honey**: every bee sits on honey and lays honey across every cell it flies over,
and honey never dries. Fly a bee **into** honey and it sticks there as a new wall.
So the whole game is the **order** — clear the hive in a sequence where no bee is
ever forced to cross the honey an earlier one left behind.

## Documentation

Start here — this repo is documented for fast onboarding:

- **[CLAUDE.md](CLAUDE.md)** — the on-ramp: what it is, the code shape, the rules
  that must never break, and the doc index. Read this first.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — layers, scene graph, data flow.
- **[docs/GAMEPLAY.md](docs/GAMEPLAY.md)** — full rules, permanent honey, occupants,
  power-ups.
- **[docs/LEVELS.md](docs/LEVELS.md)** — the 300-level curve, generator, solver.
- **[docs/MONETIZATION.md](docs/MONETIZATION.md)** — ads, IAP, honey economy, shop.
- **[docs/RELEASE.md](docs/RELEASE.md)** — build + ship, App Store checklist.
- **[docs/STATUS.md](docs/STATUS.md)** — current state, known issues, what's next.

## What's in the box

- **300 levels across 12 chapters**, generated offline and shipped as static JSON
  ([src/levels/levels.generated.json](src/levels/levels.generated.json)) — never
  generated at runtime. Every level is machine-verified solvable within its budget.
- **Occupants:** bees (goals) and a **queen** (must leave last, or you lose).
  (A **hornet** wall type exists in the engine but the shipped curve requests
  none — see [docs/GAMEPLAY.md](docs/GAMEPLAY.md).)
- **Sticky Hive specials** — every 5th level from 45 starts 40–60% flooded and
  inverts the game: carve the hive clean, while carved lanes reseal behind any
  bee that flies through them.
- **Compass Hive** — a separate 50-level mode unlocked after level 40: coloured
  bees, coloured rim gates, and free 60° rotation (only flights spend moves).
  Its own solver, generator and save track; the 300 campaign levels are untouched.
- **Power-ups** — Honey Cleaner, Undo, +3 Moves — spent from a **honey**
  soft-currency economy (earned by playing, bought, or watched-for).
- **Shop + IAP** — a starter bundle, honey packs, power-up packs, and Remove Ads,
  over a custom Swift **StoreKit 2 bridge**.
- **Ads** (AdMob) with a single binary that serves **test ads on TestFlight and
  live ads on the App Store**, decided at runtime.
- **All art drawn procedurally at boot** (kawaii bees with a flight animation,
  glossy honey, 12 per-chapter themes) — the only bundled image is the logo.

## Development

```bash
npm install
npm run dev         # play in browser (portrait viewport recommended)
npm run build       # typecheck + production bundle → dist/
npm run typecheck   # strict TS, no emit
npm run gen:levels  # regenerate all 300 levels → src/levels/levels.generated.json
npm run gen:compass # regenerate the 50 Compass Hive levels
npm test            # vitest units (see the flakiness note in docs/STATUS.md)
npm run test:e2e    # Playwright playtests

npm run verify:levels  # re-solve every shipped level against today's rules
npm run difficulty     # smart-greedy loss report for the shipped curve
```

## Run as a native iOS app (Capacitor 8)

The iOS shell is set up (`ios/`, appId `com.beefree.hiveescape`, portrait-locked
on iPhone). The **Capacitor 8 CLI needs Node ≥ 22**:

```bash
nvm use 22
npm run build
npx cap sync ios
```

Then open `ios/App/App.xcodeproj` in Xcode and Run (the bundled
`BeeFree.storekit` config makes IAP work locally), or archive for the App Store —
see [docs/RELEASE.md](docs/RELEASE.md).

## The one architectural rule

[src/systems/BoardState.ts](src/systems/BoardState.ts) is the **single source of
gameplay truth** — a pure model with no Phaser. The runtime scene, the offline
level generator, and the solver all drive this same class, so a rule can never be
implemented twice and disagree. Change gameplay there and nowhere else. See
[CLAUDE.md](CLAUDE.md) for the rest of the invariants.

---

> **Note on history:** this game began as a 6-chapter, 150-level design with a
> *drying* honey trail (the milestone framing that used to fill this README).
> It has since moved to **permanent honey** and **300 levels / 12 chapters**, plus
> power-ups, a honey economy, a shop, and the Compass Hive mode. Every doc in this
> repo — including [store/metadata.md](store/metadata.md) — now describes the
> shipping design; see [docs/STATUS.md](docs/STATUS.md) for what is still open.
