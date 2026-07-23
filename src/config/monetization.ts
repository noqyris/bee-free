/**
 * Monetization configuration — every ad unit, product id and pacing rule lives
 * here so the tuning is in one auditable place.
 *
 * ⚠️ BEFORE RELEASE: set USE_TEST_ADS to false and fill in the real AdMob ids
 * below (and create the matching product in App Store Connect). Shipping with
 * test ads earns nothing; shipping real ids while developing can get the AdMob
 * account flagged for invalid traffic — hence the explicit switch.
 */

/**
 * Google's official sample ad units. They always fill, are safe to click, and
 * need no AdMob account — so the whole flow is testable today.
 * https://developers.google.com/admob/ios/test-ads
 */
const TEST_IOS = {
  appId: 'ca-app-pub-3940256099942544~1458002511',
  interstitial: 'ca-app-pub-3940256099942544/4411468910',
  rewarded: 'ca-app-pub-3940256099942544/1712485313',
  banner: 'ca-app-pub-3940256099942544/2934735716',
} as const

/** Real AdMob ids — replace the empty strings, then flip USE_TEST_ADS to false. */
const LIVE_IOS = {
  appId: '',
  interstitial: '',
  rewarded: '',
  banner: '',
} as const

/** ⚠️ Must be false for the App Store build. */
export const USE_TEST_ADS = true

export const AD_UNITS = USE_TEST_ADS ? TEST_IOS : LIVE_IOS

/**
 * The "standard casual" pacing: an interstitial every Nth level RESULT (win or
 * loss), never on the first few levels, and never twice within the cooldown.
 * Ads that interrupt a player who is still learning the game are the fastest
 * way to lose them, so the first levels are always ad-free.
 */
export const ADS = {
  /** No interstitials at all before this level — let players get hooked first. */
  firstLevelWithAds: 6,
  /** Show an interstitial once every N level results. */
  interstitialEveryNResults: 3,
  /** Never show two interstitials closer together than this. */
  interstitialCooldownMs: 90_000,
  /** Moves granted by the rewarded "keep going" ad. */
  rewardedExtraMoves: 3,
} as const

/**
 * In-app purchases. A single non-consumable: remove ads forever. The id must
 * match the product created in App Store Connect exactly.
 */
export const PRODUCTS = {
  removeAds: 'com.beefree.hiveescape.removeads',
} as const

/**
 * Rate-app prompting. iOS itself throttles the review dialog to 3 per year, so
 * we only ever ask at a genuinely good moment (just after a 3-star win) and
 * only once we know the player is invested.
 */
export const REVIEW = {
  /** Don't ask until the player has beaten at least this many levels. */
  minLevelsCompleted: 12,
  /** Only ask after a win this good (3 = perfect run). */
  minStars: 3,
  /** Never ask more than once per this many days. */
  minDaysBetweenAsks: 60,
} as const

/**
 * Numeric App Store id (the digits in the app's store URL). Only needed to open
 * the store listing directly; fill it in once the app record exists in App Store
 * Connect. The in-app review prompt works without it.
 */
export const APP_STORE_ID = ''
