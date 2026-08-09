import { Capacitor, registerPlugin } from '@capacitor/core'
import { PRODUCTS } from '../config/monetization'
import { SHOP_PRODUCTS, type PowerupKey, type ShopProduct } from '../config/powerups'
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

interface TransactionUpdate {
  productId: string
  transactionId: string
}

interface StoreKitBridgePlugin {
  getProducts(options: { productIds: string[] }): Promise<{ products: StoreProduct[] }>
  purchase(options: {
    productId: string
  }): Promise<{ status: PurchaseStatus; message?: string; transactionId?: string }>
  restore(): Promise<{ ownedProductIds: string[] }>
  getOwned(): Promise<{ ownedProductIds: string[] }>
  /** Verified, unfinished (= paid but not yet confirmed-delivered) transactions. */
  getPendingTransactions(): Promise<{ transactions: TransactionUpdate[] }>
  /** Delivery ack: the goods are granted + persisted; consume the transaction. */
  finishTransaction(options: { transactionId: string }): Promise<void>
  addListener(
    eventName: 'transactionUpdated',
    listener: (update: TransactionUpdate) => void,
  ): Promise<unknown>
}

const StoreKitBridge = registerPlugin<StoreKitBridgePlugin>('StoreKitBridge')

export type PurchaseResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'pending' | 'unavailable' | 'failed'; message?: string }

class PurchaseService {
  private removeAdsProduct?: StoreProduct
  /** Localised prices, product id -> "€2.99", filled in by init(). */
  private prices = new Map<string, string>()

  /** The store only exists in the native app, never on web. */
  get storeAvailable(): boolean {
    return Capacitor.isNativePlatform()
  }

  /** Localised price for any shop product, or its config fallback until loaded. */
  priceFor(productId: string): string | undefined {
    return this.prices.get(productId)
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
    // Transactions that complete OUTSIDE a purchase() call — an Ask-to-Buy
    // purchase a parent approves later, a purchase the app was killed during, a
    // purchase from another device — arrive on the native updates stream. They
    // are real money: grant them, exactly once (the ledger dedupes redelivery),
    // and only THEN acknowledge so the bridge may consume the transaction.
    try {
      void StoreKitBridge.addListener('transactionUpdated', (u) => this.grantTransaction(u))
    } catch {
      // No listener support (web) — the in-process purchase path still works.
    }
    // Drain anything that was paid before this listener existed (cold start
    // replays unfinished transactions before the webview is even up).
    try {
      const { transactions } = await StoreKitBridge.getPendingTransactions()
      for (const u of transactions) this.grantTransaction(u)
    } catch {
      // Older bridge / web — nothing to drain.
    }
    try {
      const ids = [PRODUCTS.removeAds, ...SHOP_PRODUCTS.map((p) => p.id)]
      const { products } = await StoreKitBridge.getProducts({ productIds: ids })
      this.removeAdsProduct = products.find((p) => p.id === PRODUCTS.removeAds)
      for (const p of products) this.prices.set(p.id, p.price)
    } catch {
      // Store unreachable — the buy buttons simply stay at their fallback prices.
    }
    try {
      const { ownedProductIds } = await StoreKitBridge.getOwned()
      this.applyOwnership(ownedProductIds)
    } catch {
      // Keep whatever the local cache says.
    }
  }

  /**
   * Deliver a transaction from the native side, exactly once, then acknowledge
   * it (finishTransaction) so StoreKit can consume it. Already-granted ids are
   * acknowledged WITHOUT re-granting — that happens when the app died between
   * the grant persisting and the ack reaching StoreKit.
   */
  private grantTransaction(u: TransactionUpdate): void {
    if (!u?.productId || !u.transactionId) return
    if (!saveManager.hasGrantedTransaction(u.transactionId)) {
      if (u.productId === PRODUCTS.removeAds) {
        saveManager.markTransactionGranted(u.transactionId)
        this.grantRemoveAds()
      } else {
        const def = SHOP_PRODUCTS.find((p) => p.id === u.productId)
        if (!def) return // unknown product: leave unfinished, never swallow it
        saveManager.markTransactionGranted(u.transactionId)
        this.grantShop(def)
      }
    }
    void StoreKitBridge.finishTransaction({ transactionId: u.transactionId }).catch(() => {})
  }

  /** Buy "remove ads". */
  async buyRemoveAds(): Promise<PurchaseResult> {
    if (!this.available) return { ok: false, reason: 'unavailable' }
    try {
      const res = await StoreKitBridge.purchase({ productId: PRODUCTS.removeAds })
      if (res.status === 'purchased') {
        // Grant + persist FIRST, ack after: the transaction stays unfinished
        // until the goods are safely delivered (grant-then-finish contract).
        if (res.transactionId) saveManager.markTransactionGranted(res.transactionId)
        this.grantRemoveAds()
        if (res.transactionId) {
          void StoreKitBridge.finishTransaction({ transactionId: res.transactionId }).catch(() => {})
        }
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
   * Buy a consumable shop product (honey pack, power-up pack, starter bundle).
   * Consumables are not entitlements — StoreKit finishes the transaction and we
   * grant the honey / power-ups immediately on a successful purchase.
   */
  async buyConsumable(productId: string): Promise<PurchaseResult> {
    if (!this.available) return { ok: false, reason: 'unavailable' }
    const def = SHOP_PRODUCTS.find((p) => p.id === productId)
    if (!def) return { ok: false, reason: 'failed' }
    try {
      const res = await StoreKitBridge.purchase({ productId })
      if (res.status === 'purchased') {
        // Grant + persist FIRST, ack after: the transaction stays unfinished
        // until the goods are safely delivered (grant-then-finish contract).
        if (res.transactionId) saveManager.markTransactionGranted(res.transactionId)
        this.grantShop(def)
        if (res.transactionId) {
          void StoreKitBridge.finishTransaction({ transactionId: res.transactionId }).catch(() => {})
        }
        return { ok: true }
      }
      if (res.status === 'cancelled') return { ok: false, reason: 'cancelled' }
      if (res.status === 'pending') return { ok: false, reason: 'pending' }
      return { ok: false, reason: 'failed', message: res.message }
    } catch (e) {
      return { ok: false, reason: 'failed', message: (e as Error)?.message }
    }
  }

  private grantShop(def: ShopProduct): void {
    if (def.honey) saveManager.addHoney(def.honey)
    if (def.powerups) {
      for (const [k, n] of Object.entries(def.powerups)) {
        saveManager.grantPowerup(k as PowerupKey, n)
      }
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
    if (owns) {
      this.grantRemoveAds()
    } else if (saveManager.get().removeAdsPurchased) {
      // Entitlements were fetched successfully and Remove Ads is NOT among
      // them: the purchase was refunded/revoked. The cache must follow, or a
      // refunded player keeps the ad-free entitlement forever.
      saveManager.setRemoveAdsPurchased(false)
    }
    return owns
  }

  private grantRemoveAds(): void {
    if (!saveManager.get().removeAdsPurchased) saveManager.setRemoveAdsPurchased(true)
    adService.disableAds()
  }
}

export const purchaseService = new PurchaseService()
