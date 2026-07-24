# App Store metadata — Bee Free (ASO)

Everything App Store search indexes, with the character limits Apple enforces.
The app **name** and **keywords** field carry almost all of the search weight;
the **subtitle** is the next strongest. Words are indexed once — never repeat a
word across name + subtitle + keywords, that just wastes the 100-char budget.

Pushed to App Store Connect by `scripts/aso-push.mjs` (English (U.S.) locale).

> The **description** and **promotional text** below were rewritten for the honey-
> TRAIL mechanic (every flight leaves sticky honey behind it) that replaced the
> old static-honey design. They still need re-pushing before the 1.0 submission —
> the earlier push carried the old copy. The name / subtitle / keywords are
> unchanged and still accurate.

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
New: 150 hand-tuned levels. Every bee leaves a honey trail behind it — fly into fresh honey and you stick, so the ORDER is the whole puzzle. No timers, play at your pace.
```

## Description — 4000 char limit
```
Free the bees, one clever move at a time.

Every bee faces one direction. Tap it and it flies straight out — escaping the
hive if the path is clear, or bumping back and wasting a move if it's blocked.
Simple to pick up. The twist: every bee smears honey across each cell it flies
over, and that honey stays sticky for a few moves. Send a bee into a trail that's
still fresh and it stops dead in the honey, becoming a wall of its own.

So the whole game is the ORDER. Fly this one first and its trail blocks the lane
the next one needs; wait a move and it dries just in time. You're not reacting —
you're reading the board, planning the sequence, and undoing the ones that go
wrong. The honey dries on a timer you can see, so every move is a small puzzle.

• 150 hand-tuned levels across 6 chapters, each one verified solvable
• Difficulty that genuinely climbs — honey stays sticky longer and the boards
  fill up, until every move has to be planned
• Honeycomb boards of every shape, plus queen bees that must leave last and
  hornets that never move
• No timers on YOU — think as long as you like; only the honey is on a clock
• Play offline, anywhere
• One-handed, portrait, pick-up-and-go

Free to play. An optional one-time purchase removes ads forever.

Can you free the whole hive?
```

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

## What's New (per-version, first release)
```
First release. 150 levels, 6 chapters, and honey puzzles that make you plan
ahead. Thanks for playing!
```
