# App Store metadata — Bee Free (ASO)

Everything App Store search indexes, with the character limits Apple enforces.
The app **name** and **keywords** field carry almost all of the search weight;
the **subtitle** is the next strongest. Words are indexed once — never repeat a
word across name + subtitle + keywords, that just wastes the 100-char budget.

Push these by hand in the App Store Connect web UI (English (U.S.) locale).
*(An earlier `scripts/aso-push.mjs` is referenced in old notes but no longer
exists in the repo.)*

> **Rewritten Aug 2026 for the shipping design.** The previous copy described a
> 150-level game with a honey trail that *dried on a timer*. The game now ships
> **300 levels across 12 chapters** with **permanent honey**, honey you
> **collect**, power-ups, and the **Compass Hive** bonus mode. Name / subtitle /
> keywords carried over unchanged — they were never design-specific.
> **Everything below still needs pushing to ASC.**

## Name — 30 char limit
```
Bee Free: Hive Escape Puzzle
```
(28) Carries the strongest terms: bee, hive, escape, puzzle.

## Subtitle — 30 char limit
```
Tricky honeycomb logic puzzle
```
(29) Adds: tricky, honeycomb, logic — none repeat the name.

## Keywords — 100 char limit, comma-separated, NO spaces
```
hexagon,brain,teaser,bees,swarm,honey,unblock,arrow,direction,offline,strategy,tile,board,relax,iq
```
(98) New terms only — nothing already in the name or subtitle. Singular/plural
are indexed separately by Apple, so "bee"(name)+"bees"(here) both count.

## Promotional text — 170 char limit (editable without review)
```
300 levels of pure order-of-operations. Every bee you free lays honey behind it — so the lane you open now is the lane you close forever. No timers, play at your pace.
```
(168)

## Description — 4000 char limit
```
Free the bees, one clever move at a time.

Every bee faces one direction. Tap it and it flies straight out — escaping the
hive if the path is clear, or bumping back and wasting a move if something is in
the way. That is the entire control scheme. One tap.

The twist is the honey. Every bee sits on honey, and lays honey across every cell
it flies over — and that honey never dries. So each bee you free leaves a
permanent wall behind it. Fly a bee INTO honey and it stops dead, stuck in the
middle of the board as a new obstacle of its own — but it scoops that honey up,
clearing the cell and paying you for it.

So the whole game is the ORDER. Free this bee first and the trail it leaves seals
the lane the next one needed. Free it third and everything walks out clean. A
deliberate landing costs you a move but eats a honey cell and banks currency — the
pressure valve when a board looks locked. You are never reacting, never rushed:
you are reading the hive and choosing the sequence.

300 LEVELS, TWELVE CHAPTERS
Every board is generated and then verified solvable inside its move budget by a
real solver — there is no such thing as an impossible level here. The difficulty
is measured, not guessed: from chapter two on, every level is built to defeat a
player who only looks one move ahead. Swarms grow from three bees to nine, boards
get bigger and tighter, and the spare moves run out.

STICKY HIVE
Every fifth level from 45 turns the game inside out: the hive starts half-drowned
in honey and you have to carve it clean — while the lanes you carve reseal behind
every bee that flies through them.

COMPASS HIVE
Unlocks after level 40. The bees wear colours, the rim of the hive is sealed
except for matching coloured gates, and turning a bee is free — only flying costs
a move. A completely different puzzle built out of the same pieces.

• 300 levels, all verified solvable, plus a 50-level bonus mode
• Queen bees that must leave LAST, or you lose on the spot
• Power-ups when you want them: clean a lane, undo a move, or buy three more
• Honey you earn by playing — from wins, from a daily gift, from smart landings
• No timers on YOU. Think for as long as you like
• Plays fully offline
• One-handed, portrait, pick-up-and-go

Free to play, with optional purchases. A one-time "Remove Ads" turns off the
banner and the between-level ads forever — the optional reward videos stay, so
buying it never leaves you with less.

Can you free the whole hive?
```
(≈2380)

## Support / Marketing / Privacy URLs — live and already set

Served by GitHub Pages from the `noqyris/noqyris.github.io` repo:

| | |
|---|---|
| Support + Marketing | <https://noqyris.github.io/bee-free/> |
| Privacy policy | <https://noqyris.github.io/bee-free/privacy.html> |
| app-ads.txt | <https://noqyris.github.io/app-ads.txt> |

`app-ads.txt` was already on that domain for the other games. Because the file is
per-DOMAIN and not per-app, its existing
`google.com, pub-3307486877162157, DIRECT, f08c47fec0942fa0` line already covers
Bee Free — what mattered was pointing Bee Free's **Marketing URL** at that domain
so AdMob's crawler looks there.

## What's New — version 1.1
```
The hive got a lot bigger.

• 300 levels across 12 chapters, rebuilt around honey that never dries — the
  order you free the bees in is now the whole puzzle
• Land a bee in honey to collect it: the cell clears and you get paid
• Sticky Hive: every fifth level from 45 starts flooded. Carve it clean
• Compass Hive: a new mode after level 40 — coloured bees, coloured gates,
  free rotation
• Power-ups, a honey shop, and a daily gift
• Rebuilt menus, new bee art, sound and haptics on every action

Thanks for playing!
```
(≈490 — the What's New field allows 4000)
