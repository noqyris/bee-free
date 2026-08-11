# Levels: curve, generator, solver

> **Tuning without regenerating (Aug 2026).** `minMoves` is recorded and
> verified for every shipped level, so the *budget* can be retuned in seconds
> where a *board* change costs ~90 minutes. Three tools use that:
>
> - `npx tsx scripts/sessionSim.mts [from] [to] [players]` — plays levels in
>   order with a realistic player (1-ply planning, 25% misjudged moves, the
>   sealed-hive rescue) and reports first-try win rate, tries per level, walls
>   and stars. `--no-rescue` and `--slack N` give before/after comparisons.
> - `npx tsx scripts/retuneBudgets.mts --apply` — grants up to two extra moves
>   to levels measuring under a 40% first-try win rate. Deliberately a **floor**
>   and not a target: aiming at real target rates wanted +3 moves on every level
>   and measured out as trivial for a competent player.
> - `npx tsx scripts/rescueWalls.mts --apply` — for boards a budget cannot fix,
>   regenerates them in place from their own curve slot at a softened planner
>   floor until a candidate both re-proves solvable and clears the win floor.
>   Levels stamp the floor they were actually built to, and
>   `difficultyCurve.test.ts` pins each one against that.

All 300 levels are generated **offline** and shipped as static JSON. They are
**never** generated at runtime. This doc covers the whole pipeline: the curve
that specs each level, the generator that builds it, the solver that proves it,
and how to regenerate.

## The pipeline in one picture

```
levelCurve.ts (slotFor)          ── the design: per-level spec (shape, bees, budget…)
        │
        ▼
scripts/genLevels.ts             ── offline runner, shards across CPU cores
        │  for each slot:
        ▼
LevelGenerator.generateLevel     ── reverse-placement + honest verification
        │  uses:
        ├── Solver.analyzeBoard   ── fast structural analysis (bump-free solvable? depth?)
        ├── SolverSearch.searchMinMoves   ── real IDA* over BoardState → true minimum
        └── SolverSearch.smartGreedyLossRate ── measures "how much must you plan?"
        │
        ▼
src/levels/levels.generated.json ── 300 levels, committed to the repo
        │
        ▼
levels/index.ts (getLevel)       ── typed LevelData at runtime
```

## The difficulty curve — [src/config/levelCurve.ts](../src/config/levelCurve.ts)

`slotFor(id)` deterministically produces a `LevelSlot` for each of the 300
levels. `LEVEL_COUNT = 300`, `CHAPTER_SIZE = 25`, so **12 chapters**.

Key axes (see the heavily-commented source for the full reasoning):

- **Board load** — a stepped bee ramp (see "felt difficulty" below): lerp 3→5
  across the tutorial, then **6 @ L26, 7 @ L36, 8 @ L66, 9 @ L140**.
- **Budget slack** above the minimum — 3 through the queen intro (≤L22), 2 to
  L29, **1 from L30 on** (breather +1). One spare move is what makes a wrong
  order actually lose.
- **Ray bias** — `lerp(2.6, 4.0, p)`. Long flights cross more lanes → more
  order-forcing crossings. 4.0 is the empirical mid-game sweet spot.
- **Ordering spice** — queen from `id >= 16`; two honey lakes from L35.
  **Hornets (walls) are RETIRED** — by construction no goal bee's lane could
  contain one, so the player never interacted with them, and they measurably
  lowered planning pressure. The curve requests 0 everywhere.
- **Planning floor** — the minimum share of competent-but-unplanned playthroughs
  that must **lose** (the "you must think to win" bar). `0` through L15, then
  ramps fast to a 0.35 plateau by ~L80.
- **Shape pools** — `SHAPE_POOLS[chapter-1]`, deliberately **modest** in size.
  `chooseShape` picks the *smallest adequate* shape (density is what makes flight
  paths overlap; a sparse board is *easier*, not harder) and carries a **density
  guard**: it never rotates onto a shape that overshoots the needed capacity by
  ~2× (a 9-bee trial on 36 cells measured **0.00 loss** — sparse is free). Each
  late pool's two smallest shapes are 25–31 cells so both rotor picks stay
  dense. Boards grow from ~7 cells (ch1) to 19–20 by L36 and 25–31 late.
- **Tutorial** (L1–5): one concept at a time, tiny boards, generous slack.
- **Saw-tooth**: a **spike** every 10th level (deeper chain, −1 slack) and a
  **breather** the level after (one bee lighter, +1 slack — never a *free*
  level).
- **Tutorial purity**: `maxForcedStops` caps how many forced honey-stops the
  optimal line may need — 0 through L6 (clean boards by construction via the
  generator's `noCrossings` placement), 1 through L10, 2 through L15, then 5
  (6 from L100). NOT 7: a 7-stop board is stumble-through chaos (an L200 trial
  at cap 7 measured 0.04 loss). The stuck-bee mechanic can no longer be
  REQUIRED before it is taught.
- **Felt difficulty = bee count** (playtest ground truth, three rounds: 51
  levels cleared "without thinking" on the 4-bee ramp; a 5-bee board at 0.51
  bot-loss still cruised; a 6-bee L36 with 2 spare still cruised). The loss bot
  UNDERSHOOTS a human with the aim preview, so the swarm itself must carry the
  difficulty: **6 bees @ L26, 7 @ L36, 8 @ L66, 9 @ L140** — 7 bees is 5040
  orders, past glance-range, and it arrives in chapter 2.
- **One spare move is the rule**: slack 3 through the queen intro, 2 from L23,
  **1 from L30**. A wrong order now actually loses the level; undo, +3 Moves
  and the silent fail-streak bonus are the frustration cushions.
- **Honey lakes** (`honeyLakes` → `honeyCells`): pre-placed honey seeded on
  empty cells — 0 through the teaching band, then always exactly **2**. Three
  was measurably WORSE: the extra lake cuts so many lanes that even unplanned
  play is forced into a good order (11 free levels in one chapter during the
  3-lake experiment). Lakes cut lanes from move one and are the first use of
  the schema's always-supported `honeyCells` field.
- **Sticky Hive specials** (`floodCoverage`, every x5 level from L45): the
  board starts with **40–60% of free cells honeyed** (supersedes lakes; ramps
  45→295) and the level ships flagged `flooded`. Parameters come from
  measurement: ~50% coverage measures 49–94% greedy loss (carved lanes reseal
  when flown through — order is everything), while ~100% collapses to a 0–17%
  orderless crawl. Flooded slots skip the forced-stop cap (collections ARE the
  game; ceiling = seeded + 8), search with the deep 4M-node cap, quick-accept
  the first above-floor board, and aim at floor 0.25 for the two intro
  specials, 0.4 after.
- **planningTarget** (aim) vs **planningFloor** (must-clear): spikes aim
  `floor+0.15`, breathers `floor+0.02`, the queen intro (L16–18) `floor+0.05`.
  The floor climbs 0.18 → a **0.38** plateau by ~L96.
- **restarts** scale with the floor (44 → 96 → 144; 192 for the queen intro;
  **232 in the 9-bee band from L140**): late candidate pools are bimodal (0% or
  0.6+), and more samples are what kills the 0%→74% whiplash between adjacent
  levels.

The **bee cap** (`beeCap = 9`) is a **search-cost limit, not a design choice**:
under permanent honey the number of forced honey-stops climbs fast with bee
count, and verifying a board means proving a perfect order exists. 9 became
viable only when walls were retired (with walls, 9-bee boards only generated as
forced-stop chaos — the old "L105" bug) and only on DENSE 25–31-cell boards;
the 9-bee band still costs 1–4 min of generation per level. Late difficulty
comes from **the 9-bee swarm + density + a 1-move budget + the queen**.

## The generator — [src/systems/LevelGenerator.ts](../src/systems/LevelGenerator.ts)

**Reverse placement with a bump-free order by construction, then honest
verification.**

1. `placeBees` seeds hornets first, then places bees one at a time. Each new
   bee's straight flight path must be clear of every already-placed bee's
   **origin** (no bump, no dead stop on start-cell honey), and no bee may
   **start** on a cell an earlier flight crosses. Paths MAY cross each other —
   that crossing is the puzzle (whoever flies second through a shared cell
   sticks in the first one's honey), so the reverse order is bump-free but can
   still include forced honey-stops; `searchMinMoves` measures the true
   minimum. Tutorial slots (`maxForcedStops: 0`) additionally forbid path
   crossings (`noCrossings`), which makes EVERY order clean — those boards
   solve in exactly one tap per bee. Long rays are weighted up (`weightedPick`
   by `len^rayBias`) because they wall off more of the board.
2. The first-placed bee (escapes last) optionally becomes the **queen** — since no
   later bee's path can contain her, she blocks nobody, so the queen-last solution
   always exists.
3. That construction only guarantees a **bump-free** order. Whether an order
   exists that also never flies into permanent honey is the *actual* puzzle — so
   **every candidate is run through the real search** (`searchMinMoves` over a
   true `BoardState`). Only boards that genuinely clear are eligible, and the
   shipped `minMoves` is the value the search **found**, never assumed.
4. **Aim at the floor, don't maximise.** Taking the meanest layout every time gives
   a jagged curve. `generateLevel` builds up to `restarts = 44` candidates and
   keeps the *gentlest* one that still clears the level's `planningFloor + 0.08`
   target (via `smartGreedyLossRate`, 100 trials), only reaching for the hardest
   when nothing clears the floor. Early-exits when it's close enough (`cost <=
   0.06`) so easy levels stay cheap.
5. `stopSlack = 5`: a board whose optimum needs more than 5 forced honey-stops
   above one-tap-per-bee plays as chaos, not a plan — skipped.
6. **Honest fallback:** if no candidate is clearable within `goals + stopSlack`,
   it searches one board as deep as needed (`goals + 12`, 8M node cap) for its
   *real* minimum and budgets off that. Only if even that can't resolve does it
   fall back to the goal count — and `genLevels`' final check then fails the run
   rather than ship an unwinnable level. **(This replaced the original bug where a
   fallback stamped `minMoves = beeCount` without searching and shipped
   unsolvable levels.)**

## The solver — two files, two jobs

### [src/systems/Solver.ts](../src/systems/Solver.ts) — fast structural analysis

`analyzeBoard` computes cheap metrics **ignoring honey**: goal count, fill %,
dependency-chain depth, blocked-at-start, and `solvable` via greedy queen-last
elimination (`isSolvable`). Used to *shape* candidates. `nextBumpFreeMove`
(formerly misleadingly named `nextSafeMove`) is a structural helper only — it
is honey-blind and must never be used as a gameplay hint; the honest hint API
is `SolverSearch.nextSolvingMove`, which plays the real BoardState rules.

### [src/systems/SolverSearch.ts](../src/systems/SolverSearch.ts) — the real search

- `searchMinMoves(board, maxMoves, cap=300_000)` — **iterative-deepening DFS**
  over the true `BoardState` (escape / bump / stuck / queen-last / permanent
  honey). Heuristic: `estimateMinMoves` (exported) — **hop-aware admissible
  bound** `h = goals + |honeyed cells on the union of the goals' exit rays|`.
  A bee only ever moves along its fixed ray, so every honeyed cell ahead of a
  goal costs somebody a landing before that goal can pass — one landing per
  distinct cell, landings are never escapes, so nothing double-counts. The
  deepening also STARTS at `h(root)`. This replaced the old one-tap-per-goal
  bound (which it strictly dominates): all 300 shipped levels re-solve to the
  exact recorded minimum in ~9s total (was ~33s), and flooded boards drop from
  ~20s to ~2s. Returns the true minimum, or `null` if unsolvable within
  `maxMoves` or if the node `cap` was hit (treat as unusable — never trust a
  guess). Because honey is part of the state key, different orders don't
  converge, so IDA* replaced the old BFS that degenerated into enumerating
  permutations.
  - `estimateMinMoves` is also the runtime's live lower bound: the doomed alarm
    and the star pips both use it (falling back to the bare goal count while
    the player holds a Honey Cleaner, since one clean flight wipes a lane
    without landings — the alarm must never call a savable board lost).
  - **Node cap matters:** default 300k is too low for hard boards. The generator
    uses `1_500_000` for candidate screening and `8_000_000` for the deep fallback
    and the ship-time safety check. Verification tests use 8M.
- `plannerLossRate(board, trials, seed)` — **the round-4 floor metric: a
  PREVIEWING-HUMAN proxy.** Playtest ground truth (round 4): a tester with the
  aim preview cruised levels smart-greedy scored at 50%+ — the preview shows
  every landing cell and the laid trail, making a human a de-facto one-ply
  solver. This bot plays exactly that: simulates every legal move one ply and
  picks the one leaving the board least blocked (min `estimateMinMoves`, ties
  → escapes). A level it still loses demands **2+ plies of real lookahead**.
  Strictly stronger than smart-greedy, ~9x pricier per trial. Before the floor
  existed, chapter 2 measured 21% with 12/25 levels at 0% against it; late
  chapters already measured 56–72%.
- `smartGreedyLossRate(board, trials, seed)` — the **cheap first-pass screen**
  (and the floor metric of rounds 1–3). A bot that plays the obvious good
  strategy (never bump, never free the queen early, prefer a clean escape over
  gluing into honey) but **does not look ahead**. Candidates must clear the
  greedy floor before the expensive planner measurement runs (planner loss ≤
  greedy loss on every board, so a greedy-free board can be skipped outright).
- `carelessLossRate(...)` — random-legal play. **Do NOT tune against this**; it
  wildly overstates difficulty (random play loses ~96% even where "tap any clear
  bee, queen last" always wins).
- `nextSolvingMove(board, maxMoves)` — a safe next tap for the runtime hint.

## The difficulty model (how to reason about hardness)

- Under permanent honey, a pairwise lane-crossing is **order-independent** — one
  of the two bees always sticks whichever goes first. So `smartGreedyLossRate`
  ("competent, unplanned") is naturally **low**, and it peaks in the **mid game**
  where long flights create many crossings.
- **Walls kill crossings:** every hornet shortens flights, so past ~4 hornets late
  levels get *easier* to plan, not harder. Late difficulty is execution/management
  (many pieces, tight budget, the queen), not deep look-ahead.
- **`carelessLossRate` stays high throughout** (mindless play loses ~73% on
  average from ch2 on), which is why the game "demands attention" even where
  expert planning-depth dips.
- Net: difficulty **rises smoothly** across all 12 chapters (goals, walls, budget
  tightness, forced stops all climb); "must think" from ~L11. This is the intended
  shape and was confirmed by a full 300-level audit.

## The generated JSON — [src/levels/levels.generated.json](../src/levels/levels.generated.json)

`{ schema: 1, count: 300, levels: [...] }`. Each level object:

```jsonc
{
  "id": 1, "chapter": 1, "shape": "triUp3",
  "cells": [[0,0],[0,1],...],        // every playable cell [q,r]
  "honeyCells": [],                   // pre-placed honey (usually empty; honey is under bees)
  "bees": [{"q":1,"r":1,"dir":4,"kind":"bee"}, ...],
  "moveBudget": 7,                    // = minMoves + slack
  "threeStarSpare": 2,                // spare moves needed for 3 stars
  "difficulty": 6.6,                  // composite score (telemetry only)
  "depDepth": 0,                      // vestigial: always 0 (bump-free construction), kept for schema stability
  "hornets": 0, "hasQueen": false,
  "minMoves": 4,                      // true search minimum
  "planningLoss": 0,                  // measured smart-greedy loss rate
  "planningFloor": 0                  // the floor this level had to clear
}
```

`levels/index.ts` maps this onto typed `LevelData` and exposes `getLevel(i)`
(0-based, clamped), `LEVEL_COUNT`, and `chapterOf(id)`.

## Regeneration — [scripts/genLevels.ts](../scripts/genLevels.ts)

```bash
npm run gen:levels     # ~60–90 min (the 9-bee band is 1–4 min/level); 8 workers
```

- The parent process **shards** the id space across cores by re-spawning itself
  with `--shard OFFSET STRIDE` — a **round-robin interleave** (`(id-1) % stride`),
  not contiguous ranges, because generation cost climbs steeply with id and
  contiguous shards left the last worker grinding the whole 9-bee band alone.
  Each shard writes its levels to a temp file (the payload exceeds the pipe
  buffer) and the parent merges in id order.
- **Ship-time safety check (critical):** for every level it rebuilds the *shipped*
  board and asserts `searchMinMoves(honeyBoard, moveBudget, 8_000_000) !== null`
  — i.e. the exact board is clearable within its exact budget under real
  permanent-honey rules. This is the check that actually stops an unwinnable level
  (`metrics.solvable` only proves a bump-free order exists). Any failure prints and
  **exits non-zero** — the bad JSON is never written.
- It also flags any level below its `planningFloor` and prints a per-chapter
  summary (all 12 chapters, with a free-level column and the longest zero-loss
  run after L25 — the "player coasts for half an hour" smell).
- **Cheap probe before a full run:** `npx tsx scripts/trialSlots.mts 36 66 141`
  generates just those slots under the current curve, timed, with measured
  loss — minutes instead of an hour when tuning the curve or the generator.

After regenerating, commit the updated `levels.generated.json` and run the level
tests (below).

## Tests that guard the levels

- [tests/generatedLevels.test.ts](../tests/generatedLevels.test.ts) — re-solves a
  sample of the 300 with an 8M node cap and checks they match the shipped budget;
  checks the per-chapter difficulty trend.
- [tests/difficultyCurve.test.ts](../tests/difficultyCurve.test.ts) — reads
  `planningLoss` from the JSON and asserts the curve shape.
- [tests/solver.test.ts](../tests/solver.test.ts),
  [tests/honey.test.ts](../tests/honey.test.ts),
  [tests/boardState.test.ts](../tests/boardState.test.ts),
  [tests/trail.test.ts](../tests/trail.test.ts),
  [tests/hexGrid.test.ts](../tests/hexGrid.test.ts) — the rule/search units.

(See the vitest flakiness note in [../CLAUDE.md](../CLAUDE.md) and
[STATUS.md](STATUS.md) before trusting a non-zero exit.)

## Other analysis scripts

`scripts/` also holds ad-hoc tools used during tuning:
`analyzeLevels.ts`, `humanDifficulty.ts`, `verifyBeatable.ts`. They are
diagnostics, not part of the build.
