/**
 * Runtime difficulty easing (spec §4). After N total fails on a given level,
 * quietly grant bonus moves on the next attempt. Never announced to the player.
 * Session-scoped and tracked per level: a level's fail count is cleared only
 * when that level is won. Playing other levels in between does not reset it, so
 * help persists for a specific hard level until it's cleared.
 */
const FAILS_BEFORE_BONUS = 3
const BONUS_MOVES = 2

class DifficultyDirector {
  private failsByLevel = new Map<number, number>()

  recordFail(levelId: number): void {
    this.failsByLevel.set(levelId, (this.failsByLevel.get(levelId) ?? 0) + 1)
  }

  recordWin(levelId: number): void {
    this.failsByLevel.delete(levelId)
  }

  /** Extra moves to add to the budget for this attempt (0 until the streak). */
  bonusMovesFor(levelId: number): number {
    const fails = this.failsByLevel.get(levelId) ?? 0
    return fails >= FAILS_BEFORE_BONUS ? BONUS_MOVES : 0
  }

  consecutiveFails(levelId: number): number {
    return this.failsByLevel.get(levelId) ?? 0
  }
}

export const difficultyDirector = new DifficultyDirector()
