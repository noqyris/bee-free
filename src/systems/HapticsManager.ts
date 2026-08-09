import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { saveManager } from './SaveManager'

/**
 * Native haptic feedback (iOS Taptic Engine) paired with the game's sounds, so
 * every action has a physical "tick". Native-only and gated on the player's
 * haptics setting; every call is fire-and-forget and swallows errors, so it can
 * never interrupt play. On web (dev/tests) it is inert.
 */
class HapticsManager {
  private get on(): boolean {
    return Capacitor.isNativePlatform() && saveManager.get().settings.haptics
  }

  /** Bee pops free — a crisp light tap. */
  escape(): void {
    if (!this.on) return
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
  }

  /** Bee glues into honey — a heavier, stickier bump. */
  stuck(): void {
    if (!this.on) return
    void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
  }

  /**
   * Bee bounces off a wall — HEAVY, unlike the light escape tick: the wall is
   * stone and the move is gone, and with sound off this is the one channel that
   * carries the difference between success and a wasted move.
   */
  bump(): void {
    if (!this.on) return
    void Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {})
  }

  /** Pressing a bee to aim — a barely-there selection tick. */
  press(): void {
    if (!this.on) return
    void Haptics.selectionStart().catch(() => {})
    void Haptics.selectionEnd().catch(() => {})
  }

  /** Tapping something immovable (hornet wall) — a dull light knock. */
  deny(): void {
    if (!this.on) return
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
  }

  /** The queen escaped early — instant unrecoverable loss, the error pattern. */
  queenFail(): void {
    if (!this.on) return
    void Haptics.notification({ type: NotificationType.Error }).catch(() => {})
  }

  /** The board is mathematically lost (fewer moves than bees) — one warning. */
  warning(): void {
    if (!this.on) return
    void Haptics.notification({ type: NotificationType.Warning }).catch(() => {})
  }

  /** Level cleared — the success notification pattern. */
  win(): void {
    if (!this.on) return
    void Haptics.notification({ type: NotificationType.Success }).catch(() => {})
  }

  /** Out of moves — the warning notification pattern. */
  fail(): void {
    if (!this.on) return
    void Haptics.notification({ type: NotificationType.Warning }).catch(() => {})
  }

  /** Light selection tick for UI buttons. */
  tap(): void {
    if (!this.on) return
    void Haptics.selectionStart().catch(() => {})
    void Haptics.selectionEnd().catch(() => {})
  }
}

export const hapticsManager = new HapticsManager()
