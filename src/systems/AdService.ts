import { Capacitor } from '@capacitor/core'
import { AdMob, AdmobConsentStatus } from '@capacitor-community/admob'
import { AD_UNITS, ADS, USE_TEST_ADS } from '../config/monetization'
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
  private initialized = false
  private interstitialReady = false
  private rewardedReady = false
  private resultsSinceInterstitial = 0
  private lastInterstitialAt = 0

  /** Native-only, and only for players who have not bought "remove ads". */
  private get enabled(): boolean {
    return Capacitor.isNativePlatform() && !saveManager.get().removeAdsPurchased
  }

  /**
   * Gather consent (UMP), ask for tracking permission (ATT), then start the SDK.
   * That order matters: both must be resolved before the first ad request or
   * Google serves nothing in the EEA.
   */
  async init(): Promise<void> {
    if (this.initialized || !this.enabled) return
    this.initialized = true
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
      await AdMob.initialize({ initializeForTesting: USE_TEST_ADS })
      void this.preloadInterstitial()
      void this.preloadRewarded()
    } catch {
      this.initialized = false // let a later call retry
    }
  }

  private async preloadInterstitial(): Promise<void> {
    if (!this.enabled || this.interstitialReady || !AD_UNITS.interstitial) return
    try {
      await AdMob.prepareInterstitial({ adId: AD_UNITS.interstitial })
      this.interstitialReady = true
    } catch {
      this.interstitialReady = false
    }
  }

  private async preloadRewarded(): Promise<void> {
    if (!this.enabled || this.rewardedReady || !AD_UNITS.rewarded) return
    try {
      await AdMob.prepareRewardVideoAd({ adId: AD_UNITS.rewarded })
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

  /** True when a rewarded ad can be offered right now. */
  canOfferRewarded(): boolean {
    return this.enabled && this.rewardedReady
  }

  /**
   * Show the opt-in rewarded ad. Resolves true only if the player actually
   * earned the reward (watched it through).
   */
  async showRewarded(): Promise<boolean> {
    if (!this.enabled || !this.rewardedReady) return false
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

  /** Called after a successful "remove ads" purchase. */
  disableAds(): void {
    this.interstitialReady = false
    this.rewardedReady = false
  }
}

export const adService = new AdService()
