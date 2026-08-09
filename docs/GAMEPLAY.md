# Gameplay & rules

The exact rules, as implemented in
[src/systems/BoardState.ts](../src/systems/BoardState.ts) — the single source of
truth. If you want to change how the game *plays*, this is the file; the
generator and solver inherit whatever it does.

## The board

A board is a set of pointy-top **axial hex cells** (`"q,r"` keys). Shapes are
always simply-connected (no interior holes) so a bee's first off-board step
unambiguously means "left the edge", never "flew into a gap". Shapes come from
[src/systems/boardShapes.ts](../src/systems/boardShapes.ts): `hexagon`,
`triangleUp`, `triangleDown`, `rhombus`, `hexTrimmed` (a hexagon with its six
corner cells removed for a rounder look).

## Directions

`Direction` enum, `dir0 = E`, counter-clockwise in 60° steps
([src/types/index.ts](../src/types/index.ts),
[src/systems/HexGrid.ts](../src/systems/HexGrid.ts)):

```
dir 0 E  (+1, 0)      dir 3 W  (-1, 0)
dir 1 NE (+1,-1)      dir 4 SW (-1,+1)
dir 2 NW ( 0,-1)      dir 5 SE ( 0,+1)
```

A bee's direction is **fixed** — it can only ever fly that one way. That is the
whole skill of the game: you don't choose *where* a bee goes, only *when*.

## Occupant kinds

From [src/systems/occupants.ts](../src/systems/occupants.ts); all satisfy the
`CellOccupant` interface so `BoardState` never special-cases them.

| Kind | `isTappable` | `blocksFlight` | `isGoal` | Behaviour |
|---|---|---|---|---|
| **bee** | yes | yes | yes | Tap to fly it; must escape to win. |
| **queen** | yes | yes | yes | Like a bee, but must be the **LAST** goal to leave. If she escapes while any other goal remains → instant, unrecoverable loss. Introduced from L16; rendered rose + crown. |
| **hornet** | no | yes | no | Permanent stone wall. Never tappable, never a goal, excluded from the win. Shortens flights and splits the board. Introduced from L12; count ramps to 6 late. |

## A tap, precisely

`BoardState.tap(q, r)` ([BoardState.ts](../src/systems/BoardState.ts)):

1. Ignored (no move spent) if the game is over, the cell is empty, or the
   occupant is untappable (hornet).
2. Otherwise `trace()` walks the bee's ray one cell at a time:
   - Steps **off the board** → `escaped`. Bee removed. If it was the queen and
     any goal remains → `queenViolated` (loss).
   - Hits an occupant that `blocksFlight()` → `blocked` ("bump"). Bee stays.
   - Hits a **honey** cell → `stuck`. The bee **relocates onto that honey cell**
     and stays there as a blocker.
   - (A bee sitting *in* honey flies off it normally — its own start cell is never
     re-checked, because `trace` steps first.)
3. **Every tap costs a move** — escape, bump, *and* stuck all increment
   `movesUsed`. Spending a move on a bump is the core tension.
4. Honey is smeared over **every cell the bee actually flew over** (a bump counts
   — the bee made the trip before bouncing back).

`TapOutcome` is `escaped | blocked | stuck` (each carries the `path`; `blocked`
adds `blocker`, `stuck` adds `at`).

## Permanent honey — the core mechanic

This is the entire puzzle. Read it carefully.

- Honey sits under **every bee/queen from the start** (their start cells are
  walls-to-be). Hornets are stone, not honey. From L35 every level also seeds
  two pre-placed honey **lakes** (`honeyCells`).
- Every cell a bee **flies over becomes honey**.
- **Honey never dries on its own.** (The legacy drying-trail plumbing —
  `dryMoves`, `WetCell.movesLeft` — has been fully removed; `stickyCells()`
  returns plain axial coordinates.)
- Flying **into** honey = stuck — **and the bee COLLECTS that honey**: the
  landing cell is wiped (`BoardState.collected++`) and the run banks +1 honey
  currency, paid out by `recordWin(..., collectedHoney)` on the win. When the
  stuck bee flies onward its takeoff cell stays clean. A deliberate landing is
  therefore a real tactic: one move buys one reopened cell plus one honey.

So each bee lays a **permanent honey wall behind it**. To clear the hive you must
find an **order** where no bee is ever forced to cross the honey an earlier bee
left. Fly the wrong bee first and you seal a lane forever — a legal move can make
the level unwinnable.

Why the difficulty comes out where it does (important for anyone re-tuning — see
[LEVELS.md](LEVELS.md) for the full model): pairwise lane-crossings are
order-independent under permanent honey (one bee always sticks either way), so
the hardest planning is in the **mid game**, where long flights cross many lanes.
Walls (hornets) shorten flights → fewer crossings → *less* order-dependence, so
late levels lean on "manage many pieces + walls + a tight budget" more than on
deep look-ahead.

## Sticky Hive specials (flooded levels)

Every **x5 level from L45** (45, 55 … 295 — 26 in all) is a **Sticky Hive**
special (`LevelData.flooded`, yellow badge in the HUD): the board *starts* with
**40–60% of its free cells already honeyed**, and the game inverts — instead of
laying walls you **carve the hive clean**, landing by landing, in an order that
leaves every later bee a way out. Two rules make it a puzzle rather than a
grind:

- Carved lanes **reseal**: a bee that flies *through* a cell you cleaned lays
  honey on it again (normal trail rule — nothing special-cased). Wrong order =
  the corridor you paid for is gone.
- Coverage is capped at 0.6 by design. Measured on real boards: at ~100%
  coverage every tap is a forced one-hex crawl and ANY no-bump order wins
  (planning-loss collapses to 0–17%), while at ~50% the greedy bot loses
  49–94% — the sweet spot where order is everything. Never ship full floods.

Their honey payout is **capped at `FLOODED_HONEY_CAP` (6)** — carving
force-collects 8–15 cells, and an uncapped special would be a honey farm that
deflates the shop (see [MONETIZATION.md](MONETIZATION.md)).

## Compass Hive (rotation mode — its own 50-level ladder)

Unlocked from the Home screen after campaign L40. Everything honey still
applies, but three rules invert the read
([src/levels/compass.ts](../src/levels/compass.ts), `LevelData.compass`):

- **Bees wear colors** and the rim is a WALL except at **colored gates**
  (`LevelData.gates`, `[q, r, dir, color]`): a bee only escapes through a gate
  of its own color — any other crossing bounces like a bump (move spent).
- **Rotation is free**: releasing a tap ON a bee turns it 60° and re-aims the
  preview; releasing on its previewed lane launches it. Only flights spend
  moves — the puzzle is the ROUTE (fly → stick in honey → rotate → fly on),
  not the aiming.
- Multi-hop navigation is the game: honey landings are waypoints, carved lanes
  reseal when overflown, and the queen (from C12) still leaves last.

Difficulty is generated against `compassPlannerLossRate` (a one-ply
previewing-human bot over all bee×direction moves) with `searchCompassMinMoves`
proving the true minimum. Progress lives in its own save track
(`compassLevel`/`compassStars`, `recordCompassWin`) but feeds the same honey
wallet and win streak.

## Win / lose / stars

- **Win** when no goal occupants remain (hornets don't count).
- **Lose** the instant the queen leaves early (`queenViolated`), or when
  `movesUsed >= moveBudget` with goals still on the board.
- `moveBudget = minMoves + slack` (set offline by the generator). `minMoves` is
  the real minimum found by search; `slack` shrinks from ~3 early to 1 late.
- **Stars** (win screen): 3 stars requires finishing with at least
  `threeStarSpare` moves to spare, measured **against the level's real budget**
  (`level.moveBudget - movesUsed`) — neither the silent DifficultyDirector bonus
  nor a bought +3 Moves can inflate the score. A revived win (see below) is
  capped at 1 star. In-level, three **star pips** under the moves pill show
  what the run can still earn (the 3rd greys out the moment perfect play can no
  longer keep the spare), and a 2-star win screen says exactly what 3 would
  have taken.

## Power-ups

Three, usable mid-level. Config:
[src/config/powerups.ts](../src/config/powerups.ts). Every new player starts with
`STARTING_POWERUPS = 3` of each.

| Key | Name | Effect | Honey cost |
|---|---|---|---|
| `clean` | Honey Cleaner 🧽 | Arms a target; the tapped bee flies **through** honey, **wiping** it off its start cell and whole path instead of laying more. Reopens a sealed lane; escapes if the lane clears, else stays but the honey is gone. (`BoardState.tapClean`; the aim preview uses `previewClean` so it shows the real clean flight, with a cool "will be wiped" tint.) | 60 |
| `undo` | Undo ↩️ | Revert the last move. GameScene keeps `history: {board, cleanSpent}` snapshots (`clone()` before each move, capped 40). Undo **tops the restored budget up** to the live one (bought/earned extra moves survive), **refunds a Honey Cleaner** the reverted move consumed, and rebuilds the board instantly (no spawn stagger) so it reads as a step back, not a level restart. | 40 |
| `moves` | +3 Moves ➕ | `board.grantExtraMoves(MOVES_POWERUP_AMOUNT=3)`. Also offered on the out-of-moves fail screen as a revive (1-star cap). | 30 |

When the player owns 0 of a power-up, tapping it opens a modal to **buy it with
honey** (a greyed "not enough honey" row when broke), **watch a rewarded ad**
for +1, or **open the Shop** (launched as an overlay over the paused board) —
there is never a dead end. Power-ups are also sold as real-money packs
(10-for-$0.99) in the Shop — see [MONETIZATION.md](MONETIZATION.md).

## Honey (soft currency)

- **Earned** by winning: `SaveManager.recordWin` grants `stars * 5` on a new best,
  or a trickle of `1` on a replay.
- **Spent** on power-ups (the honey costs above).
- **Bought** as IAP honey packs, or earned by watching a rewarded ad
  (`AD_HONEY_REWARD = 50`).

Balance/counters live in the save (`honey`, `powerups`) via
`addHoney` / `spendHoney` / `grantPowerup` / `usePowerup` / `powerupCount`.

## Revive (rewarded ad or owned +3 Moves)

On an out-of-moves loss (but **not** a queen violation — that is permanent by
design), `LevelFailedScene` offers a "watch ad to keep going" AND — when the
player owns one — "use +3 Moves". Either calls
`GameScene.reviveWithExtraMoves(3)`, which grants moves (to the live board and
every undo snapshot, so an undo can't evaporate them) and resumes play. The
resulting win is capped at 1 star (`usedRevive`).

## Win streak (the flame)

Consecutive wins fan a flame shown beside the moves pill (from 2 wins):
`recordWin` multiplies the level's whole honey haul ×1.5 from 3 wins and ×2
from 5 (`winStreakMultiplier`). The streak breaks only when the player GIVES UP
on the fail screen (retry/menu) — reviving preserves it, which is what the
fail screen's "your streak is on the line" line is about. The win screen also
offers a rewarded **2× doubler** of the shown haul (one per win).

## Difficulty Director (rubber-banding)

[src/systems/DifficultyDirector.ts](../src/systems/DifficultyDirector.ts) silently
grants a small **bonus move budget** after repeated fails on the same level
(`bonusMovesFor(id)`, updated by `recordWin` / `recordFail`), so a stuck player
gets a gentle, invisible hand rather than a difficulty wall. It never changes the
level data — only the runtime budget in `GameScene.create`. Fail counts persist
in the save (`SaveManager.levelFails`), so quitting the app in frustration no
longer resets the help; stars are still measured against the real budget, so
the bonus can't buy a flattering score.

## Aim preview & coach

Press-and-hold a bee to preview its flight (`board.trace`): green arrow = will
escape, amber = will stick in honey, red = will bump or is a queen leaving
early; the amber overlay shows the honey the flight will LEAVE behind. With the
Honey Cleaner armed the preview flips to `previewClean` — the real
fly-through-honey flight, with a cool tint over the honey it will wipe.
Pressing lifts the bee slightly with a soft tick; sliding off the bee dims the
preview (release there cancels). Release on the bee to fly. Tapping a hornet
wall answers with a dull thud and a stubborn wobble. When moves left drop below
the bees remaining, the moves pill turns red and pulses with a one-time toast
(the way out: +3 Moves or restart). A per-mechanic coach hint (`showCoach`)
teaches the rules the first time each concept appears. This is how the
fixed-direction + honey rules are taught without a text wall.
