import { Capacitor } from '@capacitor/core'
import { AppReview } from '@capawesome/capacitor-app-review'
import { APP_STORE_ID, REVIEW } from '../config/monetization'
import { saveManager } from './SaveManager'

/**
 * Native "rate this app" prompt.
 *
 * iOS decides whether to actually render the dialog (it caps it at 3 per year
 * and silently ignores extra calls), so the only thing that matters on our side
 * is asking at a good moment and not burning the quota. We ask only after a
 * perfect (3-star) win, once the player is clearly invested, and at most once
 * every couple of months.
 */
class ReviewService {
  /**
   * Ask for a review if this win is a good moment. Returns true if a request
   * was actually sent to the OS. Never throws.
   */
  async maybeRequestReview(stars: number): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false
    if (stars < REVIEW.minStars) return false

    const save = saveManager.get()
    const levelsCompleted = Object.keys(save.stars).length
    if (levelsCompleted < REVIEW.minLevelsCompleted) return false

    const now = Date.now()
    const last = save.lastReviewPromptAt ?? 0
    if (now - last < REVIEW.minDaysBetweenAsks * 24 * 60 * 60 * 1000) return false

    try {
      await AppReview.requestReview()
      saveManager.markReviewPrompted(now)
      return true
    } catch {
      return false
    }
  }

  /** Whether a deliberate "Rate us" control can do anything on this build. */
  get canOpenStoreListing(): boolean {
    return Capacitor.isNativePlatform() && APP_STORE_ID !== ''
  }

  /** Opens the App Store page so the player can leave a review deliberately. */
  async openStoreListing(): Promise<void> {
    if (!this.canOpenStoreListing) return
    try {
      await AppReview.openAppStore({ appId: APP_STORE_ID })
    } catch {
      // Nothing to do — never break the UI over a review link.
    }
  }
}

export const reviewService = new ReviewService()
