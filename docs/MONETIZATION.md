# Monetization

Ads, in-app purchases, the honey soft-currency economy, and the review prompt.
All tuning lives in [src/config/monetization.ts](../src/config/monetization.ts)
and [src/config/powerups.ts](../src/config/powerups.ts) so it is auditable in one
place. Release-day switches and App Store steps are in [RELEASE.md](RELEASE.md).

## Revenue model

1. **Ads** — interstitials between levels, a banner on every screen, and
   **opt-in rewarded ads** (revive, free power-up, free honey, win-screen bonus).
2. **Remove Ads** — one non-consumable IAP that turns the **intrusive** ads
   (banner + interstitial) off forever. **Rewarded ads deliberately survive the
   purchase**: they are opt-in value, and paying must never make the game
   strictly harder and poorer.
3. **Consumable IAPs** — honey packs and power-up packs (and a starter bundle).
   Honey is the soft currency that power-ups cost, so honey packs and packs both
   feed the same loop.

## Ads — [src/systems/AdService.ts](../src/systems/AdService.ts)

AdMob via `@capacitor-community/admob`. Two invariants: **ads never break or block
the game** (every call is wrapped; a failure degrades to "no ad", play continues;
the whole service is inert on web/tests), and **intrusive ads are never shown to a
player who bought Remove Ads** (`enabled` gates banner+interstitial;
`rewardedAllowed` is native-only and ignores the purchase).

### Test vs live — one binary, decided at runtime

This is the important, non-obvious part. Instead of a compile-time flag, the app
picks its ad units at `init()` from the **build environment**:

- **TestFlight / sandbox** → Google **TEST** ad units (`TEST_IOS`) — safe, always
  fill, earn nothing, no invalid-traffic risk.
- **App Store** → **LIVE** ad units (`LIVE_IOS`, AdMob account
  `pub-3307486877162157`).

The environment comes from [src/systems/appEnv.ts](../src/systems/appEnv.ts)
`isSandboxBuild()`, which calls the Swift bridge's `getEnvironment()` (reads the
StoreKit 2 `AppTransaction.shared.environment`; a fresh TestFlight install with a
nil receipt is correctly treated as sandbox). If the check ever fails it defaults
to **production/live** — never risk test ads on a real store build.

`USE_TEST_ADS` (config) forces TEST ads everywhere; it is `false` in the repo and
should only be flipped to `true` while developing.

### Pacing (`ADS` in monetization.ts)

- Banner on every screen (`bannerDuringPlay: true`) — a **native bar over the web
  view**; nothing may draw below `layout.bannerSafeBottom` (1130/1280).
- No interstitials before level `firstLevelWithAds = 6`.
- Interstitial every `interstitialEveryNResults = 3` level results (win or loss),
  never closer than `interstitialCooldownMs = 90_000` — and **never on the
  retry-after-fail path** (LevelFailedScene's "Try Again" is always ad-free; the
  cadence still fires on wins and on leaving to the menu).
- Rewarded "keep going" revive grants `rewardedExtraMoves = 3`. The fail screen
  also offers an owned **+3 Moves power-up** as a revive (same 1-star cap).
- Rewarded win-screen bonus pays `WIN_BONUS_HONEY = 25` (one per win screen).
- Scenes POLL `canOfferRewarded()` (~500ms) for button visibility instead of a
  one-shot check at create — rewarded ads load asynchronously and are consumed
  + reloaded after every view.

### Flow

`init()` (idempotent, single shared promise) resolves **UMP consent → ATT
tracking prompt → SDK initialize** in that order (both consent and ATT must be
resolved before the first ad request or Google serves nothing in the EEA), then
pre-loads an interstitial + rewarded. `maybeShowInterstitial(levelNumber)` is
called on each level result; `showBanner()` is (re)asserted in Home/Menu/Game;
`canOfferRewarded()` + `showRewarded()` back the revive and get-power-up / honey
flows; `disableAds()` runs after a Remove-Ads purchase.

## In-app purchases — [src/systems/PurchaseService.ts](../src/systems/PurchaseService.ts) + the Swift bridge

No third-party purchase SDK. IAP goes through a **custom StoreKit 2 bridge**
written in Swift:
[ios/App/App/StoreKitBridgePlugin.swift](../ios/App/App/StoreKitBridgePlugin.swift)
(JS namespace `StoreKitBridge`, registered in
[MainViewController.swift](../ios/App/App/MainViewController.swift) via
`registerPluginInstance` — Capacitor 8 does not auto-discover app-target plugins).

### Bridge methods (JS-callable, all Promises)

| Method | Does |
|---|---|
| `getProducts({productIds})` | `Product.products(for:)` → `[{id, title, description, price}]` (localized `displayPrice`). |
| `purchase({productId})` | `product.purchase()`. Resolves `{status}`: `purchased` (verified, transaction finished) / `cancelled` / `pending` (Ask-to-Buy) / `failed`. Never rejects on normal outcomes. |
| `restore()` | `AppStore.sync()` then `{ownedProductIds}`. |
| `getOwned()` | `{ownedProductIds}` without syncing. |
| `getEnvironment()` | `{sandbox}` — sandbox-vs-production (see ads above). |

**Grant-then-finish delivery contract.** A transaction is only ever
`finish()`ed AFTER the JS layer confirms the goods were granted and persisted
(`finishTransaction(transactionId)`), because `finish()` permanently consumes
it. Three delivery paths, all ledger-deduped via `grantedTransactionIds`:

1. **In-process purchase**: `purchase()` resolves `{status, productId,
   transactionId}` WITHOUT finishing; JS grants, persists, then acks.
2. **Live updates stream**: the bridge's `Transaction.updates` loop emits
   `transactionUpdated` (no finish); the JS listener grants + acks. Revoked
   (refunded) transactions are finished natively with no grant.
3. **Cold start**: `PurchaseService.init()` registers the listener, then drains
   `getPendingTransactions()` (StoreKit's `Transaction.unfinished`) — this is
   what catches Ask-to-Buy approvals and purchases the app was killed during,
   which StoreKit replays before the webview is even up.

If the app dies anywhere before the ack, the transaction stays unfinished and
is redelivered next launch; if it dies after the grant persisted but before the
ack, the ledger recognises the id and only the ack is repeated. No path loses
paid goods, no path double-grants.
**Ownership is always read from `Transaction.currentEntitlements`** (verified,
non-revoked) — so Restore and a fresh reinstall work with **no server**. The
local save flag (`removeAdsPurchased`) is only a UI cache, and it is **revoked**
when a successful entitlement fetch shows Remove Ads missing (refund).

### PurchaseService surface

- `init()` — loads prices for Remove Ads + all `SHOP_PRODUCTS`, then reconciles
  ownership from `getOwned()` (this is what restores after reinstall).
- `buyRemoveAds()` → grants the entitlement + `adService.disableAds()`.
- `buyConsumable(productId)` → on success `grantShop(def)`: adds `def.honey` and/or
  `def.powerups` immediately (consumables aren't entitlements).
- `restore()` — Apple requires a visible Restore control for non-consumables; it's
  on the Home screen.
- `priceFor(id)` / `removeAdsPrice` — localized store prices with config fallback.
- `storeAvailable` — native only (`Capacitor.isNativePlatform()`).

## Product catalogue

Non-consumable ([monetization.ts](../src/config/monetization.ts) `PRODUCTS`):

| Product id | Type | Price |
|---|---|---|
| `com.beefree.hiveescape.removeads` | Non-consumable | `$2.99` in `BeeFree.storekit` (display fallback — the real price is whatever ASC has) |

Consumables ([powerups.ts](../src/config/powerups.ts) `SHOP_PRODUCTS`, mirrored in
[ios/App/BeeFree.storekit](../ios/App/BeeFree.storekit)):

| Product id | Kind | Price | Grants |
|---|---|---|---|
| `com.beefree.hiveescape.starter` | bundle (BEST) | $1.99 | 400 honey + 5 of each power-up |
| `com.beefree.hiveescape.honey.s` | honey | $0.99 | 500 honey |
| `com.beefree.hiveescape.honey.m` | honey (popular) | $2.99 | 1800 honey |
| `com.beefree.hiveescape.honey.l` | honey | $4.99 | 3500 honey |
| `com.beefree.hiveescape.pack.clean` | pack | $0.99 | 10× Honey Cleaner |
| `com.beefree.hiveescape.pack.undo` | pack | $0.99 | 10× Undo |
| `com.beefree.hiveescape.pack.moves` | pack | $0.99 | 10× +3 Moves |

> ⚠️ **These 7 consumables do not yet exist in App Store Connect.** The ids are in
> code and in the local `.storekit` config (so they work in Xcode against the
> StoreKit test config), but the user must create them in ASC as **Consumable**
> before they can be sold live, and attach the first one to a submission. See
> [STATUS.md](STATUS.md) and [RELEASE.md](RELEASE.md).

## Honey economy — [src/systems/SaveManager.ts](../src/systems/SaveManager.ts)

Honey is the soft currency; power-ups are what it buys.

| Source | Amount |
|---|---|
| New best on a level | `stars * 5` (`recordWin`) |
| Replaying a beaten level | `1` |
| Landing a bee in honey (collection) | `+1` per landing, paid on the win — **capped at `FLOODED_HONEY_CAP = 6` on Sticky Hive (flooded) levels**, which force-collect 8–15 cells and would otherwise be a farming spot that deflates every honey price |
| **Win-streak flame** | haul ×1.5 from 3 wins, ×2 from 5 (`winStreakMultiplier`); breaks on giving up at the fail screen — the revive is the "save your streak" moment |
| **Daily gift** (streak; HomeScene chip) | 7-rung ladder `20/30/40/55/70/90/120`; day 7 repeats; a missed day drops ONE rung |
| Watch a rewarded ad (Shop / get-power-up) | `AD_HONEY_REWARD = 50` |
| Watch a rewarded ad on the win screen | **2× the level's haul** (top-converting placement) |
| IAP honey pack / starter bundle | 400–3500 |

Spent via `spendHoney(n)` when buying a power-up with honey (costs: clean 60 /
undo 40 / moves 30). Power-up counts and honey balance persist in the save
(`powerups`, `honey`), starting at `STARTING_POWERUPS = 3` of each.

The **Shop** ([src/scenes/ShopScene.ts](../src/scenes/ShopScene.ts)) surfaces all
of this: watch-ad-for-honey, the starter bundle (contents derived from config),
honey rows (each shows its honey amount), power-up pack rows (each shows the
owned count), Remove Ads, and Restore. Entered from the Home honey pill, the
Menu honey pill, the in-level honey chip (as an **overlay over the paused
board**, `{overlay: true}` — the level survives the detour), and the
out-of-power-up modal's Shop button. The save itself is mirrored into Capacitor
Preferences on native (`SaveManager.hydrate`), so iOS purging WKWebView storage
can no longer wipe bought consumables.

## Review prompt — [src/systems/ReviewService.ts](../src/systems/ReviewService.ts)

Deliberately conservative (iOS caps the native dialog at 3/year and silently
eats extra calls). `REVIEW` config: only after a **3-star win**, only once **12+
levels** are done, at most once per **60 days**. Fired from
`LevelCompleteScene`. `APP_STORE_ID = '6793947665'` lets a deliberate "rate us"
tap open the store listing (the in-app dialog doesn't need it).
