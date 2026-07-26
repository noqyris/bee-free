# Release checklist — Bee Free

Everything that must be true before the build goes to the App Store, in the
order it bites. Items marked **BLOCKER** ship a broken or unmonetised app if
missed.

## 1. Development switches (BLOCKER)

Two flags are deliberately set for testing and **must be flipped for release**:

| File | Flag | Dev value | Release value |
|---|---|---|---|
| `src/config/devConfig.ts` | `DEV_UNLOCK_ALL_LEVELS` | `true` | **`false`** |
| `src/config/monetization.ts` | `USE_TEST_ADS` | `true` | **`false`** |

`DEV_UNLOCK_ALL_LEVELS` makes every level playable regardless of progress.
`USE_TEST_ADS` serves Google's sample ads — they earn nothing. Conversely,
serving *real* ads from a debug/TestFlight build risks an AdMob invalid-traffic
flag, which is why the switch is explicit rather than tied to `import.meta.env.DEV`
(that is `false` in native Capacitor builds, so it cannot be used here).

## 2. AdMob (BLOCKER for revenue)

The AdMob app and ad units already exist (account `pub-3307486877162157`) and
their ids are filled into `LIVE_IOS` in `src/config/monetization.ts`:

| | id |
|---|---|
| App ID | `ca-app-pub-3307486877162157~1512685345` |
| Interstitial | `ca-app-pub-3307486877162157/6027359430` |
| Rewarded | `ca-app-pub-3307486877162157/5436598428` |
| Banner | `ca-app-pub-3307486877162157/6918904741` |

So the only release-day steps are:

1. Set `USE_TEST_ADS = false` in `src/config/monetization.ts`.
2. Set `GADApplicationIdentifier` in `ios/App/App/Info.plist` to
   `ca-app-pub-3307486877162157~1512685345` (it currently holds Google's TEST
   app id, on purpose — that keeps TestFlight builds from touching the real
   AdMob account before the app is public and AdMob-approved).
3. Host `store/app-ads.txt` (publisher id already filled) on the store listing's
   Marketing URL domain — see the app-ads.txt section below.

`SKAdNetworkItems` in `Info.plist` already carries Google's full 50-id list, so
nothing to do there unless mediation partners are added later.

Pacing lives in `ADS` in `src/config/monetization.ts`: no interstitials before
level 6, then one every 3rd level result with a 90s cooldown. Ads never show for
a player who bought "remove ads".

The **banner runs on every screen** (`ADS.bannerDuringPlay`) — Home, the level
map and the board — brought up once and left up until a "remove ads" purchase
takes it down. It is a native view pinned to the bottom of the SCREEN, sitting
above the web view, so it does not respect canvas coordinates. The rule that
keeps it from covering anything is a single constant: no scene draws below
`layout.bannerSafeBottom` (1130 of 1280). On a tall phone the canvas letterboxes
and the bar sits in the black band; on a 4:3 iPad the canvas fills the height and
the bar eats the bottom ~13%, which that constant keeps clear on every screen.

### AdMob app verification ("require review" / app-ads.txt)

Before AdMob serves at full demand it VERIFIES the app. Two things gate that:

1. **app-ads.txt** — Google's authorized-sellers file. Host `store/app-ads.txt`
   (with the real `pub-…` id filled in) at the ROOT of the developer-website
   domain set as the app's Marketing URL in App Store Connect, e.g.
   `https://<domain>/app-ads.txt`. AdMob derives the domain from the store
   listing and crawls it; until it matches, the console shows
   "app-ads.txt not found" and the app stays unverified (suppressed demand). The
   file is web-hosted, NOT bundled in the app.
2. **SKAdNetworkItems** — `ios/App/App/Info.plist` carries Google's full list of
   50 SKAdNetwork ids (from developers.google.com/admob/ios/3p-skadnetworks) so
   iOS 14+ install attribution works. Refresh the list if Google publishes more,
   or when adding mediation partners (each partner appends its own ids).

AdMob also has its own app-review/approval pass on the AdMob side once the app is
live on the App Store; keep `USE_TEST_ADS = true` until that clears, so no real
impressions are logged against an unreviewed build.

## 3. In-app purchase (BLOCKER for the store button)

The app sells one non-consumable via our own StoreKit 2 bridge
(`ios/App/App/StoreKitBridgePlugin.swift`) — no third-party purchase service.

The product already exists and is **Ready to Submit**:

| | |
|---|---|
| Product id | `com.beefree.hiveescape.removeads` (matches `PRODUCTS.removeAds`) |
| Type | Non-consumable, not family-sharable |
| Price | 0.99 USD base (USA), matching the other Noqyris games |
| Availability | all 175 territories |
| Review screenshot | menu showing Remove Ads / Restore Purchases |

Remaining: **attach it to the first submission** — a new IAP must be reviewed
together with a build, so tick it in the version's In-App Purchases section when
submitting 1.0.

Four things were required before the state left `MISSING_METADATA`, and it is
easy to miss the last one: localization, a price schedule, a review screenshot,
**and territory availability** (a separate `inAppPurchaseAvailabilities`
resource — without it the product looks complete but stays incomplete).

Ownership is read from StoreKit's `Transaction.currentEntitlements`, so restore
and reinstall work with no server. The local save flag is only a UI cache.

### Testing purchases without App Store Connect

`ios/App/BeeFree.storekit` defines the product locally and is wired into the
shared scheme. Open `ios/App/App.xcodeproj` in Xcode and **Run** — purchases work
against the local StoreKit config. (This does not apply to `simctl launch`; the
config is attached to the scheme's launch action.)

## 4. Rate prompt

Works out of the box. To let the "rate us" control open the store listing,
set `APP_STORE_ID` in `src/config/monetization.ts` to the numeric id from the
app's App Store URL once the record exists. The in-app review dialog does not
need it.

Prompting is deliberately conservative — only after a 3-star win, only once 12+
levels are done, at most once per 60 days — because iOS caps the dialog at three
per year per user and silently swallows extra calls.

## 5. Build and ship

```bash
npm test                       # 820 unit tests
npm run test:e2e               # 6 Playwright playtests
npm run build                  # typecheck + bundle
nvm use 22 && npx cap sync ios # Capacitor 8 CLI needs Node >= 22
```

Then archive and upload:

```bash
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath ./build/BeeFree.xcarchive -allowProvisioningUpdates archive

xcodebuild -exportArchive -archivePath ./build/BeeFree.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath ./build/ipa \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_87V9QK9CTV.p8 \
  -authenticationKeyID 87V9QK9CTV \
  -authenticationKeyIssuerID fb67d5b5-b55b-4fb1-b5c3-acf16cbccdda

xcrun altool --upload-app -f ./build/ipa/App.ipa -t ios \
  --apiKey 87V9QK9CTV --apiIssuer fb67d5b5-b55b-4fb1-b5c3-acf16cbccdda
```

### Gotchas hit in practice

- **Error 90474 — iPad multitasking.** A portrait-only app is rejected unless
  `UISupportedInterfaceOrientations~ipad` lists all four orientations. iPhone
  stays portrait-locked; only the iPad key needs all four (Phaser's FIT scale
  letterboxes cleanly). The alternative is going iPhone-only via
  `TARGETED_DEVICE_FAMILY = 1`.
- **Duplicate build numbers** are rejected outright — bump before every upload.

Bump `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in the Xcode project for
every upload — App Store Connect rejects a duplicate build number.

### Note on creating the app record

Apple's App Store Connect API does **not** allow creating apps (`apps` permits
only `GET_COLLECTION`, `GET_INSTANCE`, `UPDATE`). The record must be created once
in the web UI: Apps → **+** → New App, with bundle id `com.beefree.hiveescape`.

## 6. Privacy / compliance

- `NSUserTrackingUsageDescription` is set — the ATT prompt is requested before
  the AdMob SDK starts, together with the UMP (GDPR) consent form.
- App Store Connect → App Privacy must declare data collected by AdMob
  (identifiers, usage data) or the submission is rejected. The published label is:
  Device ID + Product Interaction + Coarse Location → Third-Party Advertising
  (used for tracking); Crash + Performance Data → App Functionality (not tracking).
- **Age Rating → set the "Advertising" content descriptor to YES.** The app shows
  AdMob ads, and Apple's automated pre-review flags a mismatch (Guideline 2.3.6,
  Accurate Metadata) and REJECTS if it is left "No". This bit the 1.0 submission —
  the first pass set every descriptor to None; only "Advertising" must be Yes.
- A visible **Restore Purchases** control is required for non-consumables; it is
  on the Home screen.
- The app is **universal** (`TARGETED_DEVICE_FAMILY = "1,2"`), so the store
  listing needs iPad screenshots too — the required slot is **iPad Pro 12.9"
  (`APP_IPAD_PRO_3GEN_129`, 2048×2732)**, not the older `APP_IPAD_PRO_129`.
  Missing them makes the version "not in valid state" for review.

## 7. Difficulty regeneration

Levels are static JSON generated offline, never at runtime:

```bash
npm run gen:levels             # regenerate all 150 (~3.5 min, sharded across cores)
npx tsx scripts/humanDifficulty.ts   # the metric that matters (see below)
```

`npm run gen:levels` fails the build if any level is unsolvable, over budget, or
misses its planning floor. See `src/config/levelCurve.ts` for the schedule.

### The mechanic: the honey TRAIL

Every bee smears honey across each cell it flies over, and that honey stays
sticky for `dryMoves` further moves before it dries (`BoardState.layTrail`). Fly
a bee into a trail that is still wet and it stops dead in the honey and becomes a
blocker. So a legal-looking move can strand you, and the whole level is the
ORDER — which is what makes it a planning puzzle rather than a tapping one.

Why the drying matters: a *permanent* trail makes ordering irrelevant, because
the number of trail collisions is then fixed no matter what order you play (a
cell crossed by k paths costs exactly k-1 stops). Drying is what turns the board
into a scheduling problem. `dryMoves` is therefore THE difficulty knob: it ramps
1 → 4 across the game (5 on spikes).

### Measure planning pressure, not careless-loss

The curve is tuned against **smart-greedy loss**: how often a bot that plays
competently but does *not* search ahead still loses. It never bumps, never frees
the queen early, prefers a clean escape — but cannot see that today's clean
escape lays honey across the lane the next bee needs.

Do **not** tune against careless (random) play. With no trail in the way "tap any
clear bee, queen last" always wins, yet random play loses ~96% there — it scores
levels as brutal that play as free.

Practical consequences for anyone re-tuning:

- **`dryMoves` is the difficulty.** Longer stickiness = more of the board is a
  no-go zone at once = more that must be planned. It buys difficulty far more
  cheaply than extra bees, so raise it before raising bee count.
- **Boards must stay small and full.** The trail only bites where flight paths
  overlap, and they only overlap on a packed board. An early draft gave chapter 6
  a 61-cell board for a dozen bees and every one had a private lane — the hardest
  levels measured as free. `fillTarget` and the deliberately modest `SHAPE_POOLS`
  keep the density up.
- **Validation is a real search, not greedy.** `searchMinMoves` (iterative-
  deepening DFS keyed on occupants + the wet trail) proves a perfect order
  exists; the generator only ships boards where it does, and records the exact
  `minMoves` it found. `tests/generatedLevels.test.ts` re-solves all 150 and
  checks they still match.
- **The bee cap is a search-cost limit,** not a design one — the state space
  grows with both bee count and stickiness, so the cap tightens as `dryMoves`
  rises (15 → 13).
- **The queen and hornets are ordering spice,** layered on top of the trail: the
  queen pins one end of the sequence, hornets shorten flights and split the
  board. Neither carries difficulty on its own.
