import { audioManager } from './AudioManager'
import { hapticsManager } from './HapticsManager'

/**
 * One call site for game feedback: fires the synthesised sound and the matching
 * native haptic together, each gated on its own setting. Scenes call `feedback.*`
 * and never touch the two managers directly, so a sound always has its haptic
 * twin and they can't drift apart.
 */
export const feedback = {
  /** Resume audio on the first user gesture (iOS requirement). */
  unlock(): void {
    audioManager.unlock()
  },
  escape(combo = 1): void {
    audioManager.escape(combo)
    hapticsManager.escape()
  },
  stuck(): void {
    audioManager.stuck()
    hapticsManager.stuck()
  },
  bump(): void {
    audioManager.bump()
    hapticsManager.bump()
  },
  win(): void {
    audioManager.win()
    hapticsManager.win()
  },
  fail(): void {
    audioManager.fail()
    hapticsManager.fail()
  },
  /** A single star landing (index 0..2); sound only, haptics come from win(). */
  star(index: number): void {
    audioManager.star(index)
  },
  /** Soft click for UI buttons. */
  tap(): void {
    audioManager.tap()
    hapticsManager.tap()
  },
}
