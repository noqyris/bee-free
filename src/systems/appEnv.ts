import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * Tiny bridge to the native environment check. Lets the app serve Google TEST
 * ads on TestFlight/sandbox builds and LIVE ads in production — from a single
 * binary — instead of a compile-time flag that would ship test ads to the store
 * (or live ads that go unfilled and unclickable on TestFlight).
 */
interface StoreKitBridgeEnv {
  getEnvironment(): Promise<{ sandbox: boolean }>
}
const StoreKitBridge = registerPlugin<StoreKitBridgeEnv>('StoreKitBridge')

let cached: boolean | undefined

/** True on TestFlight / sandbox builds, false on the App Store (or web). Cached. */
export async function isSandboxBuild(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  if (cached !== undefined) return cached
  try {
    const { sandbox } = await StoreKitBridge.getEnvironment()
    cached = sandbox
  } catch {
    // If the check ever fails, default to production (live ads) — never risk
    // showing test ads on a real store build.
    cached = false
  }
  return cached
}
