/**
 * Development toggles baked into the bundle. Unlike `import.meta.env.DEV`, these
 * apply to the native (production) Capacitor build too, so they work while
 * testing on device/simulator.
 *
 * ⚠️  SET ALL OF THESE TO `false` BEFORE SHIPPING TO THE APP STORE.
 */

/** Unlock every level regardless of progress, so any level can be tested. */
export const DEV_UNLOCK_ALL_LEVELS = false
