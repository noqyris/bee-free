import { Capacitor } from '@capacitor/core'
import {
  AdMob,
  AdmobConsentStatus,
  BannerAdPosition,
  BannerAdSize,
} from '@capacitor-community/admob'
import { ADS, USE_TEST_ADS, TEST_IOS, LIVE_IOS } from '../config/monetization'
import { isSandboxBuild } from './appEnv'
import { saveManager } from './SaveManager'

/**
 * AdMob wrapper (spec §10). Two rules drive everything here:
 *
 * 1. Ads must NEVER break or block the game. Every call is wrapped — a failed
 *    load, a missing SDK or a web build all degrade to "no ad shown" and play
 *    continues. On web (dev + tests) the whole service is inert.
 * 2. Ads must never be shown to a player who paid to remove them.
 *
 * Pacing lives in config/monetization.ts: nothing before the player is hooked,
 * then one interstitial every N results with a hard cooldown.
 */
class AdService {
  // Chosen at init by environment: TEST ads on TestFlight/sandbox, LIVE on the
  // App Store. Defaults to LIVE so a real store build is never at risk of test
  // ads if the env check hasn't resolved yet.
  private adUnits: typeof LIVE_IOS | typeof TEST_IOS = LIVE_IOS
  private testing = USE_TEST_ADS
  private initPromise?: Promise<void>
  private interstitialReady = false
  private rewardedReady = false
  private bannerShown = false
  private resultsSinceInterstitial = 0
  private lastInterstitialAt = 0

  /**
   * Gate for the INTRUSIVE formats (banner + interstitial): native-only, and
   * only for players who have not bought "remove ads".
   */
  private get enabled(): boolean {
    return Capacitor.isNativePlatform() && !saveManager.get().removeAdsPurchased
  }

  /**
   * Rewarded ads are OPT-IN value (revive, free power-ups, free honey), so
   * "remove ads" deliberately does not switch them off — paying must never make
   * the game strictly harder and poorer. Native-only, like everything else.
   */
  private get rewardedAllowed(): boolean {
    return Capacitor.isNativePlatform()
  }

  /**
   * Gather consent (UMP), ask for tracking permission (ATT), then start the SDK.
   * That order matters: both must be resolved before the first ad request or
   * Google serves nothing in the EEA. Runs for payers too — they still get the
   * opt-in rewarded placements.
   */
  init(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return Promise.resolve()
    // Share ONE in-flight promise. The old version flipped a boolean on entry,
    // so a second caller returned immediately while the SDK was still resolving
    // consent/ATT — and anything that then requested an ad (the banner does, as
    // soon as the board opens) failed silently against an uninitialised SDK.
    this.initPromise ??= this.runInit()
    return this.initPromise
  }

  private async runInit(): Promise<void> {
    // TestFlight/sandbox → Google TEST ads; App Store → LIVE ads. One binary.
    this.testing = USE_TEST_ADS || (await isSandboxBuild())
    this.adUnits = this.testing ? TEST_IOS : LIVE_IOS
    try {
      const consent = await AdMob.requestConsentInfo()
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
        const after = await AdMob.showConsentForm()
        saveManager.updateConsentStatus(after.status)
      } else {
        saveManager.updateConsentStatus(consent.status)
      }
    } catch {
      // No consent SDK / no network: fall through to non-personalised ads.
    }

    try {
      const { status } = await AdMob.trackingAuthorizationStatus()
      if (status === 'notDetermined') await AdMob.requestTrackingAuthorization()
    } catch {
      // ATT is iOS 14+ only; older systems just proceed.
    }

    try {
      await AdMob.initialize({ initializeForTesting: this.testing })
      void this.preloadInterstitial()
      void this.preloadRewarded()
    } catch {
      this.initPromise = undefined // let a later call retry
    }
  }

  private async preloadInterstitial(): Promise<void> {
    if (!this.enabled || this.interstitialReady || !this.adUnits.interstitial) return
    try {
      await AdMob.prepareInterstitial({ adId: this.adUnits.interstitial })
      this.interstitialReady = true
    } catch {
      this.interstitialReady = false
    }
  }

  private async preloadRewarded(): Promise<void> {
    if (!this.rewardedAllowed || this.rewardedReady || !this.adUnits.rewarded) return
    try {
      await AdMob.prepareRewardVideoAd({ adId: this.adUnits.rewarded })
      this.rewardedReady = true
    } catch {
      this.rewardedReady = false
    }
  }

  /**
   * Count a finished level (win or loss) and show an interstitial if this one
   * lands on the cadence. Resolves once the ad is dismissed so the caller can
   * navigate afterwards; resolves immediately when no ad is shown.
   */
  async maybeShowInterstitial(levelNumber: number): Promise<void> {
    if (!this.enabled) return
    this.resultsSinceInterstitial++

    if (levelNumber < ADS.firstLevelWithAds) return
    if (this.resultsSinceInterstitial < ADS.interstitialEveryNResults) return
    if (Date.now() - this.lastInterstitialAt < ADS.interstitialCooldownMs) return
    if (!this.interstitialReady) {
      void this.preloadInterstitial() // warm it for next time
      return
    }

    try {
      await AdMob.showInterstitial()
      this.resultsSinceInterstitial = 0
      this.lastInterstitialAt = Date.now()
    } catch {
      // Failed to show — keep the counter so the next result tries again.
    } finally {
      this.interstitialReady = false
      void this.preloadInterstitial()
    }
  }

  /**
   * Show the bottom banner. Adaptive size so it matches the device width, and
   * anchored BOTTOM_CENTER — it is a native view over the web view, not part of
   * the game canvas. Only called from the board screen (see ADS.bannerDuringPlay
   * for why the menu is excluded).
   */
  async showBanner(): Promise<void> {
    if (!this.enabled || !ADS.bannerDuringPlay || !this.adUnits.banner) return
    if (this.bannerShown) return
    await this.init() // idempotent; resolves once consent + ATT + SDK are done
    if (!this.enabled) return // a purchase may have landed while we waited
    this.bannerShown = true // set first: guards against a double show while awaiting
    try {
      await AdMob.showBanner({
        adId: this.adUnits.banner,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        margin: 0,
        isTesting: this.testing,
      })
      // A "remove ads" purchase can land while the native show was in flight —
      // its hideBanner() then raced this call and lost. Re-check and take the
      // banner straight down so a payer never sits behind an ad bar.
      if (!this.enabled) {
        this.bannerShown = false
        try {
          await AdMob.removeBanner()
        } catch {
          // Nothing to remove — fine.
        }
      }
    } catch {
      this.bannerShown = false // never let a failed banner wedge the flag
    }
  }

  /** Remove the banner (leaving the board, or after a "remove ads" purchase). */
  async hideBanner(): Promise<void> {
    if (!this.bannerShown) return
    this.bannerShown = false
    try {
      await AdMob.removeBanner()
    } catch {
      // Already gone, or no SDK — nothing to recover.
    }
  }

  /** True when a rewarded ad can be offered right now. */
  canOfferRewarded(): boolean {
    return this.rewardedAllowed && this.rewardedReady
  }

  /**
   * Show the opt-in rewarded ad. Resolves true only if the player actually
   * earned the reward (watched it through).
   */
  async showRewarded(): Promise<boolean> {
    if (!this.rewardedAllowed || !this.rewardedReady) return false
    try {
      const reward = await AdMob.showRewardVideoAd()
      return !!reward && reward.amount > 0
    } catch {
      return false
    } finally {
      this.rewardedReady = false
      void this.preloadRewarded()
    }
  }

  /**
   * Called after a successful "remove ads" purchase. Kills the intrusive
   * formats only — the opt-in rewarded placements stay (see rewardedAllowed).
   */
  disableAds(): void {
    this.interstitialReady = false
    void this.hideBanner()
  }
}

export const adService = new AdService()
