import Phaser from 'phaser'
import { GAME_WIDTH, colors, layout } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { themeForChapter, type ChapterTheme } from '../config/theme'
import { paintBackground } from '../utils/background'
import { saveManager } from '../systems/SaveManager'
import { purchaseService } from '../systems/PurchaseService'
import { adService } from '../systems/AdService'
import { SHOP_PRODUCTS, AD_HONEY_REWARD, type PowerupKey, type ShopProduct } from '../config/powerups'
import { t, type StringKey } from '../i18n'
import {
  makeButton,
  makeIconButton,
  drawHoneyDrop,
  fadeInScene,
  ensureCardTexture,
  ensureShopIconTexture,
  FONT_STACK,
} from '../utils/ui'
import { feedback } from '../systems/feedback'

interface ShopSceneData {
  /** Scene to return to (defaults to Home). */
  returnTo?: string
  returnData?: Record<string, unknown>
  /**
   * True when launched OVER a paused scene (the in-level honey chip / power-up
   * modal). leave() then stops this scene and resumes the parent instead of
   * hard-starting it — the paused board underneath survives the detour.
   */
  overlay?: boolean
  /** A confirmation toast that must survive a scene.restart (purchase success). */
  toastKey?: 'store.adsRemoved' | 'store.restored'
}

/**
 * The shop: earn honey by playing, or buy honey and power-up packs here. Real-
 * money purchases go through StoreKit (native only); on web the buy buttons show
 * but report the store as unavailable. A "watch ad for honey" option keeps the
 * free path open.
 */
export class ShopScene extends Phaser.Scene {
  private theme!: ChapterTheme
  private honeyLabel!: Phaser.GameObjects.Text
  private returnTo = 'Home'
  private returnData: Record<string, unknown> = {}
  private overlay = false
  private busy = false
  private cardsLayer!: Phaser.GameObjects.Container
  private adButton?: Phaser.GameObjects.Container
  private adPoll?: Phaser.Time.TimerEvent
  private ownedLabels = new Map<PowerupKey, Phaser.GameObjects.Text>()

  constructor() {
    super('Shop')
  }

  create(data: ShopSceneData): void {
    this.returnTo = data.returnTo ?? 'Home'
    this.returnData = data.returnData ?? {}
    this.overlay = data.overlay ?? false
    this.busy = false
    this.ownedLabels.clear()
    this.theme = themeForChapter(Math.min(12, Math.ceil(saveManager.currentLevel / 25)))
    fadeInScene(this)
    paintBackground(this, this.theme)
    this.cardsLayer = this.add.container(0, 0)

    this.add
      .text(GAME_WIDTH / 2, 74, t('shop.title'), {
        fontFamily: FONT_STACK,
        fontSize: '46px',
        color: this.theme.textCss,
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)

    makeIconButton(this, 66, 74, '‹', () => this.leave(), 34)

    // Honey balance pill.
    const pill = this.add.container(GAME_WIDTH / 2, 150)
    const pg = this.add.graphics()
    pg.fillStyle(0x000000, 0.32)
    pg.fillRoundedRect(-120, -26, 240, 52, 26)
    pg.lineStyle(2, this.theme.accent, 0.7)
    pg.strokeRoundedRect(-120, -26, 240, 52, 26)
    pill.add(pg)
    pill.add(drawHoneyDrop(this, -84, 0, 13))
    this.honeyLabel = this.add
      .text(20, 0, String(saveManager.honey), { fontFamily: FONT_STACK, fontSize: '30px', color: this.theme.textCss })
      .setOrigin(0.5)
    pill.add(this.honeyLabel)

    // Watch-ad-for-honey (free path). Created always; visibility POLLS the ad
    // readiness, because rewarded ads load asynchronously and are consumed +
    // reloaded after every view — a one-shot check at create left a dead or
    // missing button half the time.
    this.adButton = makeButton(this, GAME_WIDTH - 120, 150, `▶ +${AD_HONEY_REWARD}`, () => void this.watchAdForHoney(), {
      width: 150,
      height: 52,
      fontSize: 22,
      primary: false,
    })
    this.adButton.setVisible(adService.canOfferRewarded())
    this.adPoll = this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => this.adButton?.setVisible(adService.canOfferRewarded()),
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.adPoll?.remove()
      this.adPoll = undefined
    })

    // Product cards.
    const starter = SHOP_PRODUCTS.find((p) => p.best)
    let y = 236
    if (starter) {
      this.productCard(GAME_WIDTH / 2, y, GAME_WIDTH - 80, 132, starter, true)
      y += 158
    }
    const honey = SHOP_PRODUCTS.filter((p) => p.kind === 'honey')
    y = this.cardRow(honey, y) + 20
    const packs = SHOP_PRODUCTS.filter((p) => p.kind === 'pack')
    y = this.cardRow(packs, y) + 18

    // Remove ads + restore (native only).
    if (purchaseService.storeAvailable && !purchaseService.adsRemoved) {
      this.cardsLayer.add(
        this.add.container(GAME_WIDTH / 2, y + 30).add(
          makeButton(this, 0, 0, t('store.removeAds'), () => void this.buyRemoveAds(), {
            width: GAME_WIDTH - 120,
            height: 62,
            fontSize: 26,
            accent: 0xff9a3c,
          }),
        ),
      )
      y += 84
    }
    this.cardsLayer.add(
      makeButton(
        this,
        GAME_WIDTH / 2,
        Math.min(y + 40, layout.bannerSafeBottom - 40),
        t('store.restore'),
        () => void this.restore(),
        { width: 320, height: 56, fontSize: 22, primary: false },
      ),
    )

    // A purchase/restore success restarts this scene (to drop the Remove Ads
    // row); its confirmation toast rides through the restart via scene data.
    if (data.toastKey) this.toast(t(data.toastKey))
  }

  private cardRow(products: ShopProduct[], y: number): number {
    const gap = 16
    const w = (GAME_WIDTH - 80 - (products.length - 1) * gap) / products.length
    const h = 150
    let x = 40 + w / 2
    for (const p of products) {
      this.productCard(x, y + h / 2, w, h, p, false)
      x += w + gap
    }
    return y + h
  }

  private productCard(x: number, y: number, w: number, h: number, p: ShopProduct, wide: boolean): void {
    const c = this.add.container(x, y)
    this.cardsLayer.add(c)
    const cardKey = ensureCardTexture(
      this,
      p.best ? 0x4a3413 : colors.buttonSecondary,
      p.best ? 0xffce4a : this.theme.accent,
      w,
      h,
    )
    c.add(this.add.image(0, 0, cardKey))

    // Icon / contents summary — drawn art, not platform emoji.
    const iconKind = p.kind === 'honey' ? 'honey' : p.kind === 'pack' ? 'pack' : 'gift'
    c.add(
      this.add.image(
        wide ? -w / 2 + 56 : 0,
        wide ? 0 : -h / 2 + 34,
        ensureShopIconTexture(this, iconKind, wide ? 76 : 48),
      ),
    )

    const title = t(p.titleKey as StringKey)
    c.add(
      this.add
        .text(wide ? -w / 2 + 92 : 0, wide ? -22 : -14, title, {
          fontFamily: FONT_STACK,
          fontSize: wide ? '26px' : '15px',
          color: '#fff3d6',
          align: wide ? 'left' : 'center',
          wordWrap: { width: wide ? w - 220 : w - 12 },
        })
        .setOrigin(wide ? 0 : 0.5, 0.5),
    )
    if (wide && p.honey) {
      // Derived from config, not hardcoded — retuning the bundle can't make
      // the card lie about its contents.
      const each = Object.values(p.powerups ?? {})[0] ?? 0
      c.add(
        this.add
          .text(-w / 2 + 92, 14, t('shop.starter.contents', { honey: p.honey, n: each }), {
            fontFamily: FONT_STACK,
            fontSize: '18px',
            color: '#d9c39a',
          })
          .setOrigin(0, 0.5),
      )
    }
    // The purchase decision IS the amount — honey cards must say how much
    // honey they hold, pack cards how many the player already owns.
    if (!wide && p.kind === 'honey' && p.honey) {
      const amount = this.add.container(0, 12)
      const label = this.add
        .text(10, 0, t('shop.honeyAmount', { n: p.honey }), {
          fontFamily: FONT_STACK,
          fontSize: '20px',
          color: colors.honeyCss,
        })
        .setOrigin(0.5)
      amount.add(drawHoneyDrop(this, -label.width / 2 - 4, 0, 8))
      amount.add(label)
      c.add(amount)
    }
    if (!wide && p.kind === 'pack' && p.powerups) {
      const key = Object.keys(p.powerups)[0] as PowerupKey
      const owned = this.add
        .text(0, 14, t('shop.youOwn', { n: saveManager.powerupCount(key) }), {
          fontFamily: FONT_STACK,
          fontSize: '15px',
          color: '#b8a98c',
        })
        .setOrigin(0.5)
      c.add(owned)
      this.ownedLabels.set(key, owned)
    }
    if (p.badgeKey) {
      const badge = this.add.container(w / 2 - 54, -h / 2 + 2)
      const bg = this.add.graphics()
      bg.fillStyle(p.best ? 0xff5a8a : 0x49a0ff, 1)
      bg.fillRoundedRect(-46, -14, 92, 28, 14)
      badge.add(bg)
      badge.add(
        this.add
          .text(0, 0, t(p.badgeKey as StringKey), { fontFamily: FONT_STACK, fontSize: '13px', color: '#ffffff' })
          .setOrigin(0.5),
      )
      c.add(badge)
    }

    // Price button (whole card is tappable).
    const priceStr = purchaseService.priceFor(p.id) ?? p.price
    const priceY = wide ? h / 2 - 30 : h / 2 - 26
    const priceX = wide ? w / 2 - 80 : 0
    const pb = this.add.graphics()
    pb.fillStyle(0x34c759, 1)
    pb.fillRoundedRect(priceX - 60, priceY - 20, 120, 40, 20)
    c.add(pb)
    c.add(
      this.add
        .text(priceX, priceY, priceStr, { fontFamily: FONT_STACK, fontSize: '22px', color: '#ffffff' })
        .setOrigin(0.5),
    )

    // Standard press pattern: sink on press, cancel on slide-off, fire on
    // release — the same feel as every other button in the game.
    const hit = this.add.rectangle(0, 0, w, h, 0, 0).setInteractive({ useHandCursor: true })
    c.add(hit)
    let pressed = false
    hit.on('pointerdown', () => {
      pressed = true
      feedback.tap()
      this.tweens.add({ targets: c, scale: juice.ui.buttonPressScale, duration: juice.ui.buttonPressMs })
    })
    hit.on('pointerout', () => {
      pressed = false
      this.tweens.add({ targets: c, scale: 1, duration: juice.ui.buttonPressMs })
    })
    hit.on('pointerup', () => {
      if (!pressed) return
      pressed = false
      this.tweens.add({ targets: c, scale: 1, duration: juice.ui.buttonPressMs })
      void this.buy(p)
    })
  }

  /** While a StoreKit sheet is in flight, the whole shop dims — visible busy. */
  private setBusy(value: boolean): void {
    this.busy = value
    this.cardsLayer.setAlpha(value ? 0.55 : 1)
  }

  private async buy(p: ShopProduct): Promise<void> {
    if (this.busy) return
    this.setBusy(true)
    const res = await purchaseService.buyConsumable(p.id)
    if (!this.scene.isActive('Shop')) return
    this.setBusy(false)
    if (res.ok) {
      this.refreshCounts()
      this.toast(t('shop.thanks'))
    } else if (res.reason === 'unavailable') {
      this.toast(t('store.unavailable'))
    } else if (res.reason === 'pending') {
      this.toast(t('store.pending'))
    } else if (res.reason !== 'cancelled') {
      this.toast(t('store.failed'))
    }
  }

  private async buyRemoveAds(): Promise<void> {
    if (this.busy) return
    this.setBusy(true)
    const res = await purchaseService.buyRemoveAds()
    if (!this.scene.isActive('Shop')) return
    this.setBusy(false)
    if (res.ok) {
      // Restart drops the Remove Ads row; the toast travels via scene data
      // (shown pre-restart it would die with this scene instance).
      this.scene.restart({
        returnTo: this.returnTo,
        returnData: this.returnData,
        overlay: this.overlay,
        toastKey: 'store.adsRemoved',
      })
      return
    }
    if (res.reason === 'cancelled') return
    this.toast(res.reason === 'pending' ? t('store.pending') : res.reason === 'unavailable' ? t('store.unavailable') : t('store.failed'))
  }

  private async restore(): Promise<void> {
    if (this.busy) return
    this.setBusy(true)
    const res = await purchaseService.restore()
    if (!this.scene.isActive('Shop')) return
    this.setBusy(false)
    if (res.ok) {
      // A restored Remove Ads must also take its buy row off the screen.
      this.scene.restart({
        returnTo: this.returnTo,
        returnData: this.returnData,
        overlay: this.overlay,
        toastKey: 'store.restored',
      })
      return
    }
    this.toast(res.reason === 'unavailable' ? t('store.unavailable') : t('store.nothingToRestore'))
  }

  private async watchAdForHoney(): Promise<void> {
    if (this.busy) return
    this.setBusy(true)
    const ok = await adService.showRewarded()
    if (!this.scene.isActive('Shop')) return
    this.setBusy(false)
    if (ok) {
      saveManager.addHoney(AD_HONEY_REWARD)
      this.refreshCounts()
      this.toast(t('shop.reward', { n: AD_HONEY_REWARD }))
    } else {
      // A tap must never be silent — say the ad was not ready.
      this.toast(t('ads.notReady'))
    }
  }

  private refreshCounts(): void {
    this.honeyLabel.setText(String(saveManager.honey))
    for (const [key, label] of this.ownedLabels) {
      label.setText(t('shop.youOwn', { n: saveManager.powerupCount(key) }))
    }
  }

  private toast(msg: string): void {
    // Above the banner-safe line: the native ad bar hangs over the bottom of
    // the canvas and used to swallow the purchase confirmations entirely.
    const toast = this.add
      .text(GAME_WIDTH / 2, layout.bannerSafeBottom - 80, msg, {
        fontFamily: FONT_STACK,
        fontSize: '24px',
        color: '#fff3d6',
        backgroundColor: '#000000cc',
        padding: { x: 20, y: 12 },
      })
      .setOrigin(0.5)
      .setDepth(500)
    this.tweens.add({ targets: toast, alpha: 0, y: '-=30', duration: 1200, delay: 700, onComplete: () => toast.destroy() })
  }

  private leave(): void {
    if (this.overlay) {
      // Launched over a live board — hand control straight back to it.
      this.scene.stop()
      this.scene.resume(this.returnTo)
      return
    }
    this.scene.start(this.returnTo, this.returnData)
  }
}
