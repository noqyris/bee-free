/**
 * The boot sting — the studio clip that plays over the whole boot, wired up in
 * `index.html` so it starts before Phaser is even fetched.
 *
 * The game only needs one fact from it: whether it still owns the screen.
 * Anything NATIVE that draws outside the web view — the AdMob banner bar, the
 * consent form, the ATT prompt — would appear on top of the sting, which is the
 * first thing a new player ever sees. They all wait on `splashDone`.
 *
 * Resolves immediately when there is no sting: reduced motion, a headless test,
 * or the module loading after the clip already finished.
 */
declare global {
  interface Window {
    /** Set true by the inline script in index.html, false once the clip is gone. */
    __splashActive?: boolean
  }
}

export const splashDone: Promise<void> =
  typeof window === 'undefined' || !window.__splashActive
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        window.addEventListener('beefree:splashdone', () => resolve(), { once: true })
        // Backstop. Nothing may be able to switch ads off permanently by failing
        // to fire an event — worst case they come back a few seconds late.
        setTimeout(resolve, 12_000)
      })
