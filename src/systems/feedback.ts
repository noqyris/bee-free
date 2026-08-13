import { audioManager } from './AudioManager'
import { hapticsManager } from './HapticsManager'
import { musicManager } from './MusicManager'

/**
 * One call site for game feedback: fires the synthesised sound and the matching
 * native haptic together, each gated on its own setting. Scenes call `feedback.*`
 * and never touch the two managers directly, so a sound always has its haptic
 * twin and they can't drift apart.
 */
export const feedback = {
  /**
   * Resume audio on the first user gesture (iOS requirement) — and start the
   * music, which needs the very same gesture. Every scene already calls this on
   * first touch, so there is no separate "start music" call to forget.
   */
  unlock(): void {
    audioManager.unlock()
    // Started off the gesture, not inside it. This runs from a pointerdown
    // handler on the board, and building the music bus plus a bar of voices
    // there put ~14 node constructions in front of the frame that has to answer
    // the player's finger. The context is already resumed by unlock() above, so
    // a tick later is just as valid to iOS and costs the touch nothing.
    setTimeout(() => musicManager.start(), 0)
  },
  /** The Music toggle changed — start or stop to match it. */
  musicSettingChanged(): void {
    musicManager.refresh()
  },
  /**
   * The level-complete celebration: the fanfare, with the music pulled down
   * under it so the two do not fight.
   */
  celebrate(): void {
    musicManager.duck()
    audioManager.celebrate()
    // Sound only. `win()` already fired its haptic on the board half a second
    // ago and the stars land with their own; a third buzz in that window reads
    // as a stutter rather than as emphasis.
  },
  escape(combo = 1): void {
    audioManager.escape(combo)
    hapticsManager.escape()
  },
  stuck(): void {
    audioManager.stuck()
    hapticsManager.stuck()
  },
  /** A bee landed in honey and collected it — a bright little reward blip. */
  collect(): void {
    audioManager.collect()
    hapticsManager.tap()
  },
  bump(): void {
    audioManager.bump()
    hapticsManager.bump()
  },
  /** Finger lands on a bee (aiming) — the softest tick in the game. */
  press(): void {
    audioManager.press()
    hapticsManager.press()
  },
  /** Tapped something immovable (a hornet wall). */
  deny(): void {
    audioManager.deny()
    hapticsManager.deny()
  },
  /** The queen left early — catastrophic, must never sound like a win. */
  queenFail(): void {
    audioManager.queenFail()
    hapticsManager.queenFail()
  },
  /** Undo stepped the board back one move. */
  undo(): void {
    audioManager.undo()
    hapticsManager.tap()
  },
  /** Moves left just dropped below the bees remaining — one alert, not a nag. */
  warning(): void {
    audioManager.warning()
    hapticsManager.warning()
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
