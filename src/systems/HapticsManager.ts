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

  /** Bee bounces off a wall — a soft knock. */
  bump(): void {
    if (!this.on) return
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
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
