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

1. Create the app in the AdMob console, get the **App ID** (`ca-app-pub-…~…`).
2. Create two ad units: one **interstitial**, one **rewarded**.
3. Fill `LIVE_IOS` in `src/config/monetization.ts` with the App ID + unit ids.
4. Set the same App ID in `ios/App/App/Info.plist` → `GADApplicationIdentifier`.
5. Set `USE_TEST_ADS = false`.
6. Add the full SKAdNetwork list from Google's docs to `Info.plist`
   (`SKAdNetworkItems` currently holds only Google's own id).

Pacing lives in `ADS` in `src/config/monetization.ts`: no interstitials before
level 6, then one every 3rd level result with a 90s cooldown. Ads never show for
a player who bought "remove ads".

## 3. In-app purchase (BLOCKER for the store button)

The app sells one non-consumable via our own StoreKit 2 bridge
(`ios/App/App/StoreKitBridgePlugin.swift`) — no third-party purchase service.

1. In App Store Connect → Features → In-App Purchases, create a **Non-Consumable**
   with product id exactly `com.beefree.hiveescape.removeads`
   (`PRODUCTS.removeAds` in `src/config/monetization.ts`).
2. Add a localised display name, description and price tier.
3. Attach it to the first submission — a new IAP must be reviewed with a build.
4. Until it exists and is "Ready to Submit", the menu shows "Remove Ads" with no
   price, and buying resolves as `failed`. That is expected, not a bug.

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
  (identifiers, usage data) or the submission is rejected.
- A visible **Restore Purchases** control is required for non-consumables; it is
  in the main menu.

## 7. Difficulty regeneration

Levels are static JSON generated offline, never at runtime:

```bash
npm run gen:levels   # regenerate all 150 (~26s, sharded across cores)
npm run difficulty   # profile the shipped curve
```

`npm run gen:levels` fails the build if any level is unsolvable, over budget, or
misses its careless-loss floor. See `src/config/levelCurve.ts` for the schedule.
