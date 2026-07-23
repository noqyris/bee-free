import { Capacitor, registerPlugin } from '@capacitor/core'
import { PRODUCTS } from '../config/monetization'
import { adService } from './AdService'
import { saveManager } from './SaveManager'

/**
 * In-app purchases, backed by our own StoreKit 2 bridge
 * (ios/App/App/StoreKitBridgePlugin.swift) — no third-party purchase service.
 *
 * Ownership is never invented locally: it always comes from StoreKit's
 * `currentEntitlements`, which is what makes "restore purchases" and a fresh
 * reinstall work. The local save flag is only a cache so the UI can react
 * instantly offline.
 */

export interface StoreProduct {
  id: string
  title: string
  description: string
  /** Localised, currency-formatted price, e.g. "€2.99". */
  price: string
}

type PurchaseStatus = 'purchased' | 'cancelled' | 'pending' | 'failed'

interface StoreKitBridgePlugin {
  getProducts(options: { productIds: string[] }): Promise<{ products: StoreProduct[] }>
  purchase(options: { productId: string }): Promise<{ status: PurchaseStatus; message?: string }>
  restore(): Promise<{ ownedProductIds: string[] }>
  getOwned(): Promise<{ ownedProductIds: string[] }>
}

const StoreKitBridge = registerPlugin<StoreKitBridgePlugin>('StoreKitBridge')

export type PurchaseResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'pending' | 'unavailable' | 'failed'; message?: string }

class PurchaseService {
  private removeAdsProduct?: StoreProduct

  /** The store only exists in the native app, never on web. */
  get storeAvailable(): boolean {
    return Capacitor.isNativePlatform()
  }

  private get available(): boolean {
    return this.storeAvailable
  }

  get adsRemoved(): boolean {
    return saveManager.get().removeAdsPurchased
  }

  /** Localised price for the store button, or undefined until products load. */
  get removeAdsPrice(): string | undefined {
    return this.removeAdsProduct?.price
  }

  /**
   * Load product metadata and reconcile local state with StoreKit's
   * entitlements — this is what restores the purchase after a reinstall.
   */
  async init(): Promise<void> {
    if (!this.available) return
    try {
      const { products } = await StoreKitBridge.getProducts({ productIds: [PRODUCTS.removeAds] })
      this.removeAdsProduct = products.find((p) => p.id === PRODUCTS.removeAds)
    } catch {
      // Store unreachable — the buy button simply stays unavailable.
    }
    try {
      const { ownedProductIds } = await StoreKitBridge.getOwned()
      this.applyOwnership(ownedProductIds)
    } catch {
      // Keep whatever the local cache says.
    }
  }

  /** Buy "remove ads". */
  async buyRemoveAds(): Promise<PurchaseResult> {
    if (!this.available) return { ok: false, reason: 'unavailable' }
    try {
      const res = await StoreKitBridge.purchase({ productId: PRODUCTS.removeAds })
      if (res.status === 'purchased') {
        this.grantRemoveAds()
        return { ok: true }
      }
      if (res.status === 'cancelled') return { ok: false, reason: 'cancelled' }
      if (res.status === 'pending') return { ok: false, reason: 'pending' }
      return { ok: false, reason: 'failed', message: res.message }
    } catch (e) {
      return { ok: false, reason: 'failed', message: (e as Error)?.message }
    }
  }

  /**
   * Restore previous purchases. Apple requires a visible restore control for
   * any app selling non-consumables.
   */
  async restore(): Promise<PurchaseResult> {
    if (!this.available) return { ok: false, reason: 'unavailable' }
    try {
      const { ownedProductIds } = await StoreKitBridge.restore()
      const restored = this.applyOwnership(ownedProductIds)
      return restored ? { ok: true } : { ok: false, reason: 'failed' }
    } catch (e) {
      return { ok: false, reason: 'failed', message: (e as Error)?.message }
    }
  }

  private applyOwnership(ownedProductIds: string[]): boolean {
    const owns = ownedProductIds.includes(PRODUCTS.removeAds)
    if (owns) this.grantRemoveAds()
    return owns
  }

  private grantRemoveAds(): void {
    if (!saveManager.get().removeAdsPurchased) saveManager.setRemoveAdsPurchased(true)
    adService.disableAds()
  }
}

export const purchaseService = new PurchaseService()
