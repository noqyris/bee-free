# Status, history & next steps

A snapshot of where the project actually is — what's done, what's blocked on the
user, known issues, the design decisions worth knowing, and which older docs are
stale. Read this before assuming anything from `README.md` or `store/metadata.md`.

## Current release coordinates

| | |
|---|---|
| Version | **1.1** (`MARKETING_VERSION`) — 1.0 shipped; its ASC train is closed |
| Build | **25** (`CURRENT_PROJECT_VERSION`) — bump before every upload |
| Bundle id | `com.beefree.hiveescape` |
| Team | `YMN45WC2QR` (Automatic signing) |
| Device family | Universal (iPhone + iPad, `1,2`) |
| AdMob | account `pub-3307486877162157`; live app id in Info.plist |
| App Store id | `6793947665` |

## What's built and working

> **Ship-prep pass (Aug 9 2026).** Two "written but never run" gaps closed and
> the release blockers cleared:
> - **Compass Hive shipped a 1-level placeholder.** The mode was fully wired and
>   unlocked after campaign L40, but `compass.generated.json` held a single
>   `"placeholder": true` board — `genCompassLevels.ts` had never been run to
>   completion. Generated for real; `npm run gen:compass` now exists so it is a
>   command and not oral tradition.
> - **The planner floor had drifted ahead of the data.** A "round 5" rewrite of
>   `plannerFloor` (start L26 → L12, plateau 0.35 → 0.45) was never followed by
>   `gen:levels`, leaving **45 shipped levels below their own stated floor**. The
>   existing tests all checked chapter *averages*, so nothing failed. The curve is
>   back on the round-4 line the shipped set was actually built to (verified: 0
>   violations), and `difficultyCurve.test.ts` now pins **every level
>   individually** so the config can never silently outrun the content again.
> - **All 7 consumable IAPs created** in App Store Connect over the ASC API
>   (`inAppPurchases` **v2** — the old "the API can't create products" note was
>   out of date), each with en-US localization, USD price, 175 territories and a
>   review screenshot captured straight from the Shop scene
>   (`scripts/iapReviewShot.mts`). All 7 are **READY_TO_SUBMIT**; Remove Ads
>   remains APPROVED.
> - Also: the skipped `bumping a blocked bee` e2e test now runs — and proving it
>   possible turned up a real fact about the game (see Known issues).
>
> **Compass Hive mode (Aug 8 2026, user's rotate+numbered-exits proposal):**
> research showed the two halves only work TOGETHER and only as a separate
> mode (free rotation provably collapses the campaign's ordering puzzle;
> numbered exits without rotation present zero decisions; market ships
> matching as COLOR). Built: compass rules in BoardState (colors, gates,
> free 60° rotation; wrong rim = bump), mode solver pair, 50-level generated
> ladder, rotate-on-release/fly-on-lane-release input, colored gate chevrons,
> Home entry unlocked after campaign L40, own save track sharing the wallet
> and streak. Campaign's 300 levels untouched.
>
> **Round-4 difficulty pass (Aug 7 2026, "still too simple" after build 22):**
> the tuning bot was weaker than the player — with the aim preview a human is
> a de-facto ONE-PLY solver, and 12/25 chapter-2 levels fell to one-ply play
> in 100% of trials (measured). Added `plannerLossRate` (previewing-human
> proxy: simulates each move one ply, keeps the least-blocking one) and a
> rising `plannerFloor` (0.15 @ L26 → 0.35 @ L120, flooded ≥ 0.2/0.3) the
> generator must clear — greedy loss is now just a cheap screen. Every level
> after L25 now defeats one-ply play some share of the time; clearing one
> requires seeing 2+ moves ahead.
>
> **Sticky Hive pass (Aug 7 2026, user's "clean the honey" proposal):** 26
> flooded specials (every x5 from L45, `flooded` flag, 40–60% of free cells
> pre-honeyed, HUD badge, payout cap 6). Parameters are measured, not guessed:
> a research workflow simulated flooding on real shipped boards — 100%
> coverage collapses into an orderless crawl (loss 0–17%), ~50% is the hardest
> content in the game (loss 49–94%, carved lanes reseal on fly-through).
> Same pass: **hop-aware admissible solver heuristic** (goals + honey on the
> goals' exit rays) — all 300 levels re-verify in ~9s (was ~33s), and the
> in-game doomed alarm + star pips now use the same bound (bee-count fallback
> while a Honey Cleaner is owned).
>
> **Round-3 difficulty pass (Aug 7 2026, after "L36 still cruised" playtest):**
> bigger + denser boards and a much steeper swarm ramp — 7 bees @ L36, 8 @ L66,
> **9 @ L140** (walls retired made 9 viable, but only on dense 25–31-cell
> boards), slack 1 from L30, floor 0.18→0.38, forced-stop cap 6 (never 7 —
> chaos). Generator upgrades: shape density guard, deeper 9-bee candidate
> search (4M nodes), quick-accept in the 9-bee band, and a reseed round that
> rescues pathological seeds (L200 shipped 0.04-loss without it). Interleaved
> gen shards (round-robin) so one worker no longer grinds the whole 9-bee band.
> Shipped audit: **0 free levels after L25** (was 21), longest free run 0,
> all floors met, chapter loss 32%→64%, regen ~88 min.
>
> **Aug 2026 improvement pass** (this working tree): reworked curve + full
> regeneration (clean tutorial L1–8, hornet plateau 4, denser ch9–12 boards,
> saw-tooth un-inverted, ~⅔ fewer "free" levels in the back half), save
> hardening (Capacitor Preferences mirror + corrupt-save sanitizing, persisted
> fail counts), monetization integrity (rewarded ads survive Remove-Ads, no
> interstitial on retry-after-fail, StoreKit `transactionUpdated` delivery with
> a dedupe ledger), player-facing additions (daily gift streak, in-level Shop
> overlay, +3-Moves revive on the fail screen, win-screen bonus ad, 3-star pips
> in the HUD + hint on 2-star wins, in-level sound toggle, Menu swipe/dot
> navigation + per-chapter stars), and game-feel work (queen-fail staging,
> progressive honey laying, press-to-aim feedback, doomed-state alarm, hornet
> deny wobble, honest Honey-Cleaner preview, undo that steps back instantly and
> refunds/keeps what it should). Undo/star integrity bugs fixed (extra moves
> survive undo, cleaner refunded, stars measured against the real budget).
> The pass was then adversarially reviewed (20 verified findings, all fixed) —
> notably the StoreKit **grant-then-finish** delivery contract (a consumable
> can no longer be consumed before the player receives it), modal tap-through
> on the board, slide-release triggering icon buttons, refund revocation of
> Remove Ads, and a purchase-aware save-mirror restore.

- **Core loop** — hex grid, fixed-direction tap-to-fly, escape/bump/stuck,
  win/lose, stars. Single-source `BoardState`.
- **Permanent-honey mechanic** — honey under every bee, laid on every flight,
  never dries; the whole puzzle is the escape order.
- **300 levels / 12 chapters** — generated offline, verified solvable within
  budget by real search, shipped as static JSON. Full 300-level quality audit
  passed (all solvable; no too-easy / brutal / degenerate levels; difficulty rises
  across all chapters; "must think" from ~L11).
- **3 power-ups** (clean / undo / moves) + **honey soft-currency economy**,
  verified in-game.
- **Shop** — starter bundle, honey packs, power-up packs, Remove Ads, Restore,
  watch-ad-for-honey.
- **Ads** — interstitial + rewarded + banner, with **runtime test-vs-live**
  selection (one binary; TestFlight→test, App Store→live).
- **IAP** — custom Swift **StoreKit 2 bridge** (no third-party SDK); ownership from
  `currentEntitlements`; Restore works.
- **Bee art** — procedurally-drawn kawaii/chibi bees with a wing-flap flight
  animation, flight-facing rotation, and a streamline stretch; gold direction
  arrows; glossy honey pools; per-chapter theming (12 themes).
- **Release flags already at ship values:** `DEV_UNLOCK_ALL_LEVELS = false`
  ([devConfig.ts](../src/config/devConfig.ts)), `USE_TEST_ADS = false`
  ([monetization.ts](../src/config/monetization.ts)).
- Tests green across the rule/search/level suites; `npm run build` clean.

## Blocked on the user (must happen before the next ship)

1. ~~Create the 7 consumable IAP products~~ **done (Aug 9 2026)** — created over
   the ASC API, all **READY_TO_SUBMIT** with price, en-US localization, 175
   territories and a review screenshot. They still have to be **attached to a
   submission**: a new IAP is only reviewed alongside a build.
2. ~~Refresh the store copy~~ **done** — [store/metadata.md](../store/metadata.md)
   is rewritten for 300 levels + permanent honey + power-ups + Compass Hive, with
   a new What's New for 1.1. **Still needs pushing to ASC** (web UI; the
   `scripts/aso-push.mjs` the file used to reference no longer exists).
3. **Test the StoreKit `transactionUpdated` delivery path on a device** (sandbox
   Ask-to-Buy) before the consumables go live. Needs real hardware — cannot be
   done from here.
4. **Submit for review** when you are ready. Everything up to and including the
   TestFlight upload is automatable and done; the submission itself is
   deliberately left to you.

> Do **not** commit / build / ship unless the user explicitly says so. This has
> been gated by the user repeatedly.

## Known issues & rough edges

- **Vitest is flaky in the sandbox** (not the logic): the fork pool throws
  "Timeout calling onTaskUpdate" RPC errors after many runs and exits non-zero
  **with all tests passing**. Mitigations: run one file at a time, use
  `--reporter=basic`, or verify a module directly with `tsx`. A non-zero exit is
  not proof of a real failure — read the actual output.
- ~~Stale comments / cosmetics~~ **cleaned up (Aug 2026):** the `dryMoves`
  plumbing was fully removed (types, BoardState, scenes, generator, JSON), the
  "150 levels" headers now say 300, and the genLevels report covers all 12
  chapters with zero-loss ("free level") columns.
- **Remove-Ads price** shows `2.99` in `BeeFree.storekit` but older docs said
  `0.99` base — the real price is whatever ASC has; treat the config value as a
  display fallback only.
- **The bump rule never fires from a level's opening position.** Sweeping all 300
  starts gives 1570 `escaped` + 822 `stuck` and **zero** `blocked`: under
  permanent honey a bee's neighbours are reachable honey, so it sticks rather
  than bumping. Bumping only becomes reachable once a bee has landed mid-board
  and become a wall. Not a bug — the rule is real and the e2e test now
  manufactures the state to prove it — but worth knowing before writing copy
  that leans on "blocked → it bumps back" as an opening-move experience.

## Docs map (which file is the truth)

**Current & authoritative** (written for the shipping design):
`CLAUDE.md`, and everything under `docs/` — `ARCHITECTURE.md`, `GAMEPLAY.md`,
`LEVELS.md`, `MONETIZATION.md`, `RELEASE.md`, this file.

**Refreshed but historical framing:** the root `README.md` still uses the
M1–M6 milestone framing; its status list predates the 300-level / permanent-honey
/ power-up work. The header now points here.

**Stale — do not trust for gameplay or counts:** `store/metadata.md` (marketing
copy for the old 150-level drying-trail design; name/keywords still fine).

## Design decisions worth knowing (the "why")

- **Why one `BoardState`.** The runtime, the offline generator, and the solver all
  drive the same model so a rule can't be implemented twice and drift. It's the
  reason validation and gameplay can never disagree.
- **Why permanent honey (vs the old drying trail).** A drying trail made ordering a
  scheduling problem tuned by a `dryMoves` timer. Permanent honey makes each bee
  lay a permanent wall — simpler to read, and it makes a legal move able to
  *seal* a lane, so order genuinely matters. `dryMoves` was retired to `1`/inert.
- **Why the bee cap is low (8–9).** It's a *search-cost* limit, not a design one.
  Under permanent honey the forced-stop count and the verification search both
  blow up with bee count; past ~9 no clean-ish board survives generation. Late
  difficulty comes from walls + density + budget + queen instead.
- **Why "aim at the floor, don't maximise".** Always taking the meanest layout
  gives a jagged curve (a 96%-loss board next to a free one). The generator keeps
  the *gentlest* layout that still clears the rising `planningFloor`.
- **Why tune against `smartGreedyLossRate`, not careless play.** Random play loses
  ~96% even on levels that a competent "queen last, any clear bee" player always
  wins — it scores free levels as brutal. The honest signal is how often
  *competent-but-unplanned* play loses.
- **Walls-kill-crossings tension.** More walls late (a user request) shortens
  flights, which reduces order-forcing crossings, which lowers expert
  planning-depth. Accepted trade: late levels lean on management over look-ahead.
  If deeper late-game planning is ever wanted, trade some walls for longer
  crossing flights.
- **Why runtime test/live ad selection.** A compile-time flag would ship test ads
  to the store (earning nothing) or live ads to TestFlight (unfilled + invalid-
  traffic risk). Reading the StoreKit environment lets one binary do the right
  thing in both.
- **Why the custom StoreKit bridge.** No third-party purchase SDK / server;
  ownership straight from `currentEntitlements` makes Restore and reinstall
  work for free.

## History (condensed)

- **M1** core loop, **M2** level pipeline (originally 150 levels, 6 chapters,
  drying honey trail) — see `README.md` for that framing.
- Reworked to **permanent honey**, expanded to **300 levels / 12 chapters**.
- Fixed a **critical generator bug**: a fallback stamped `minMoves = beeCount`
  without searching and shipped unsolvable levels. Now every shipped board is
  re-verified clearable within its budget (`genLevels` fails the run otherwise).
- Iterated the **bee art** to kawaii/chibi with flight animation + rotation.
- Added **power-ups + honey economy + shop + 7 consumable IAPs**.
- Hardened **TestFlight sandbox detection** for the one-binary ad switch.
- Ran a **full 300-level quality audit** — passed.
