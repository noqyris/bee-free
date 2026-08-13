# Release checklist — Bee Free

Everything that must be true before a build goes to the App Store, in the order it
bites. Items marked **BLOCKER** ship a broken or unmonetised app if missed. For
the monetization design behind this, see [MONETIZATION.md](MONETIZATION.md);
current state in [STATUS.md](STATUS.md).

## 0. Current coordinates

| | |
|---|---|
| Version / build | **1.1 / 32** — uploaded Aug 13 2026 (adds the studio sting on boot). Bump before the next upload; the 1.0 train is CLOSED on ASC, so new builds must ride 1.1+ |
| Bundle id | `com.beefree.hiveescape` |
| Team | `YMN45WC2QR` (Automatic signing) |
| Device family | Universal (`1,2`) |
| App Store id | `6793947665` |

## 1. Development switches — already at release values ✅

Two flags apply to the native build too (unlike `import.meta.env.DEV`). Both are
**already set for release** — verify, don't assume:

| File | Flag | Must be | Currently |
|---|---|---|---|
| [src/config/devConfig.ts](../src/config/devConfig.ts) | `DEV_UNLOCK_ALL_LEVELS` | `false` | `false` ✅ |

> **Level unlocking no longer needs a release-day flip.** TestFlight/sandbox
> builds unlock the whole campaign and App Store builds progress normally, read
> from the StoreKit environment at boot (`SaveManager.setTestFlightUnlock`,
> called from `BootScene`) — the same one-binary trick as the ad units. The
> default is LOCKED, so a failed check or a web build never hands out 300
> levels. `DEV_UNLOCK_ALL_LEVELS` stays as a local override and must stay
> `false`.
| [src/config/monetization.ts](../src/config/monetization.ts) | `USE_TEST_ADS` | `false` | `false` ✅ |

`DEV_UNLOCK_ALL_LEVELS` makes every level playable regardless of progress.
`USE_TEST_ADS` forces Google's sample ads everywhere. With it `false`, the app
**picks test vs live ads at runtime by environment** (see §2).

## 2. AdMob (BLOCKER for revenue)

The app uses interstitial + rewarded + banner. Ad units live in `LIVE_IOS`
([monetization.ts](../src/config/monetization.ts)), AdMob account
`pub-3307486877162157`:

| | id |
|---|---|
| App id | `ca-app-pub-3307486877162157~1512685345` |
| Interstitial | `ca-app-pub-3307486877162157/6027359430` |
| Rewarded | `ca-app-pub-3307486877162157/5436598428` |
| Banner | `ca-app-pub-3307486877162157/6918904741` |

**Test vs live is automatic — no release-day flip needed.** The app reads the
StoreKit environment ([appEnv.ts](../src/systems/appEnv.ts) →
`StoreKitBridge.getEnvironment()`): **TestFlight/sandbox → Google TEST ads**,
**App Store → LIVE ads**, from one binary. If the check fails it defaults to live.

Release-day AdMob facts (already handled unless noted):
- `GADApplicationIdentifier` in [Info.plist](../ios/App/App/Info.plist) is the
  **LIVE** app id above. *(This was previously the Google TEST app id on purpose;
  it has since been switched to live.)*
- `SKAdNetworkItems` carries Google's **50** ids — nothing to do unless mediation
  partners are added.
- **app-ads.txt** is already hosted at `https://noqyris.github.io/app-ads.txt`
  (per-domain, shared across the Noqyris apps; its
  `pub-3307486877162157` line already covers Bee Free). What matters is that the
  App Store **Marketing URL** points at `https://noqyris.github.io/bee-free/` so
  AdMob's crawler finds it.
- AdMob runs its own app-review pass once the app is live. Because ad test/live is
  environment-driven, no unreviewed build ever logs a real impression.

## 3. In-app purchases (BLOCKER for the store buttons)

Backed by our own **StoreKit 2 bridge**
([StoreKitBridgePlugin.swift](../ios/App/App/StoreKitBridgePlugin.swift)) — no
third-party service, no server. Ownership from `Transaction.currentEntitlements`,
so Restore + reinstall work. Full catalogue in [MONETIZATION.md](MONETIZATION.md).

**Non-consumable — Remove Ads** (`com.beefree.hiveescape.removeads`): already
created and Ready to Submit. Remaining: **attach it to the submission** (a new IAP
is reviewed with a build).

**7 consumables — created Aug 9 2026, all `READY_TO_SUBMIT`:**

| id | Type | State |
|---|---|---|
| `com.beefree.hiveescape.starter` | Consumable | READY_TO_SUBMIT |
| `com.beefree.hiveescape.honey.s` / `.m` / `.l` | Consumable | READY_TO_SUBMIT |
| `com.beefree.hiveescape.pack.clean` / `.undo` / `.moves` | Consumable | READY_TO_SUBMIT |

Each has all four gates filled: en-US localization, USD price schedule, **175
territories** (the separate `inAppPurchaseAvailabilities` resource — easy to
miss), and a review screenshot. Remaining: **attach them to a submission** — a
new IAP is only reviewed alongside a build.

> **The ASC API CAN create in-app purchases.** The older note here said it
> couldn't; that stopped being true when the `inAppPurchases` **v2** endpoints
> landed. The full create path is `POST /v2/inAppPurchases` →
> `POST /v1/inAppPurchaseLocalizations` →
> `POST /v1/inAppPurchasePriceSchedules` (price point id from
> `GET /v2/inAppPurchases/{id}/pricePoints?filter[territory]=USA`) →
> `POST /v1/inAppPurchaseAvailabilities` → screenshot reserve/PUT/PATCH via
> `/v1/inAppPurchaseAppStoreReviewScreenshots`. Creating the **app record**
> itself is still web-UI only.
>
> Review screenshots come straight out of the game:
> `npx tsx scripts/iapReviewShot.mts out.png` captures the Shop scene at
> 1242×2208 (the canvas is 9:16, so that size is full-bleed with no letterbox).

### Testing purchases without ASC

Open [ios/App/App.xcodeproj](../ios/App) in Xcode and **Run** — the
`BeeFree.storekit` config is attached to the scheme, so all products work locally.
(This does **not** apply to `simctl launch`.)

## 4. Rate prompt

Works out of the box ([ReviewService.ts](../src/systems/ReviewService.ts)).
`APP_STORE_ID = '6793947665'` lets a deliberate "rate us" tap open the listing.
Conservative by design (only after a 3-star win, 12+ levels done, ≤ once/60 days —
iOS caps the native dialog at 3/year).

## 5. Build and ship

```bash
npm test                       # unit tests (see the flakiness note in STATUS.md)
npm run test:e2e               # Playwright playtests
npm run build                  # typecheck + bundle → dist/
nvm use 22 && npx cap sync ios # Capacitor 8 CLI needs Node >= 22
```

Then archive and upload from `ios/App`:

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

`ExportOptions.plist` (in `ios/App/`): `app-store-connect`, team `YMN45WC2QR`,
automatic signing, upload symbols.

### After every upload: ASSIGN THE BUILD TO THE TESTER GROUP (BLOCKER for TestFlight)

Uploading + processing is NOT enough — a build nobody assigned to a beta group
never appears in anyone's TestFlight (builds 15–19 sat invisible this way;
the tester kept seeing build 14). Assign via the ASC API (group "Internal
Testers" id `26451f50-2ae7-41b9-9c45-0138a24b73b4`):

```
POST https://api.appstoreconnect.apple.com/v1/betaGroups/26451f50-2ae7-41b9-9c45-0138a24b73b4/relationships/builds
{ "data": [{ "type": "builds", "id": "<build uuid from the upload>" }] }
```

(A ready-made script pattern lives in the session scratchpad; JWT-sign with the
same AuthKey_87V9QK9CTV.p8. Success = HTTP 204; the build flips to
`internalBuildState: IN_BETA_TESTING`.)

### Gotchas hit in practice

- **Bump the build number first.** ASC rejects a duplicate `CURRENT_PROJECT_VERSION`
  outright. Currently **28** (uploaded). Note the local project file is not proof
  of what shipped: it read 24 while ASC's newest build was **23** — build 24 was
  bumped locally and never uploaded. **Ask ASC, not the repo**, what the last
  uploaded build was:
  `GET /v1/builds?filter[app]=6793947665&limit=5&sort=-uploadedDate`.
- **Error 90474 — iPad multitasking.** A portrait-only universal app is rejected
  unless `UISupportedInterfaceOrientations~ipad` lists **all four** orientations.
  iPhone stays portrait-locked; only the iPad key needs all four (Phaser's FIT
  letterboxes cleanly). Already set. (Alternative: iPhone-only via
  `TARGETED_DEVICE_FAMILY = 1`.)
- **Node < 22** breaks the Capacitor 8 CLI — `nvm use 22` before `cap sync`.
- **App record creation** is web-UI only (ASC API `apps` is read/update, not
  create). Already created.

## 6. Privacy / compliance

- `NSUserTrackingUsageDescription` is set; ATT is requested before the AdMob SDK
  starts, together with the UMP (GDPR) consent form.
- **App Privacy labels** must declare AdMob's collection or the submission is
  rejected: Device ID + Product Interaction + Coarse Location → Third-Party
  Advertising (tracking); Crash + Performance → App Functionality (not tracking).
- **Age Rating → set the "Advertising" descriptor to YES.** Apple's automated
  pre-review flags a mismatch (Guideline 2.3.6) and **rejects** if left "No". This
  bit the 1.0 submission.
- A visible **Restore Purchases** control is required for non-consumables — it's on
  the Home screen.
- Universal app → the listing needs **iPad Pro 12.9" (`APP_IPAD_PRO_3GEN_129`,
  2048×2732)** screenshots, not the older `APP_IPAD_PRO_129`.

## 7. Level regeneration

Levels are static JSON, generated offline, never at runtime:

```bash
npm run gen:levels     # regenerate all 300 (sharded across cores)
```

Fails the run if any level is unsolvable within its budget. Full pipeline in
[LEVELS.md](LEVELS.md). Commit the regenerated
[levels.generated.json](../src/levels/levels.generated.json) afterwards.
