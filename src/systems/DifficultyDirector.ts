import { saveManager } from './SaveManager'

/**
 * Runtime difficulty easing (spec §4). After N total fails on a given level,
 * quietly grant bonus moves on the next attempt. Never announced to the player.
 * Fail counts are PERSISTED (SaveManager.levelFails): the player most in need
 * of the easing is the one who rage-quits the app after repeated fails, and the
 * old in-memory counter reset to zero exactly for them. A level's count clears
 * only when that level is won; playing other levels in between changes nothing.
 */
const FAILS_BEFORE_BONUS = 3
const BONUS_MOVES = 2

class DifficultyDirector {
  recordFail(levelId: number): void {
    saveManager.recordLevelFail(levelId)
  }

  recordWin(levelId: number): void {
    saveManager.clearLevelFails(levelId)
  }

  /** Extra moves to add to the budget for this attempt (0 until the streak). */
  bonusMovesFor(levelId: number): number {
    return saveManager.levelFailCount(levelId) >= FAILS_BEFORE_BONUS ? BONUS_MOVES : 0
  }
}

export const difficultyDirector = new DifficultyDirector()
