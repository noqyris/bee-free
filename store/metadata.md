# App Store metadata — Bee Free (ASO)

Everything App Store search indexes, with the character limits Apple enforces.
The app **name** and **keywords** field carry almost all of the search weight;
the **subtitle** is the next strongest. Words are indexed once — never repeat a
word across name + subtitle + keywords, that just wastes the 100-char budget.

Pushed to App Store Connect by `scripts/aso-push.mjs` (English (U.S.) locale).

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
New: 150 hand-tuned levels that actually make you think — plan the order or a single bee gets stuck in the honey and strands the whole hive. No timers, play at your pace.
```

## Description — 4000 char limit
```
Free the bees, one clever move at a time.

Every bee faces one direction. Tap it and it flies straight — escaping the hive
if the path is clear, or bumping back and wasting a move if it's blocked. Simple
to pick up. The catch is the honey: a bee that flies through an open honey cell
gets STUCK there and becomes a wall of its own. Move in the wrong order and you
strand yourself with no way out.

That one twist turns a cozy tapping game into a real planning puzzle. You're not
reacting — you're reading the board, working out the order, and undoing the ones
that go wrong.

• 150 hand-tuned levels across 6 chapters, each one verified solvable
• Difficulty that genuinely climbs — the last chapters will make you stop and think
• Honeycomb boards of every shape, plus queen bees that must leave last and
  hornets that never move
• No timers, no energy, no pressure — think as long as you like
• Play offline, anywhere
• One-handed, portrait, pick-up-and-go

Free to play. An optional one-time purchase removes ads forever.

Can you free the whole hive?
```

## Support / Marketing URL
App Store Connect requires a reachable Support URL to submit. It should be a real
page; the same domain must host `app-ads.txt` (see store/app-ads.txt) for AdMob
to verify the app. Set both in App Store Connect once the domain exists.

## What's New (per-version, first release)
```
First release. 150 levels, 6 chapters, and honey puzzles that make you plan
ahead. Thanks for playing!
```
