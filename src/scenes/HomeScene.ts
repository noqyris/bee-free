import Phaser from 'phaser'
import { GAME_WIDTH, colors, layout } from '../config/gameConfig'
import { LEVEL_COUNT } from '../levels'
import { themeForChapter, type ChapterTheme } from '../config/theme'
import { purchaseService } from '../systems/PurchaseService'
import { saveManager } from '../systems/SaveManager'
import { adService } from '../systems/AdService'
import { paintBackground } from '../utils/background'
import { t } from '../i18n'
import { makeButton, drawHoneyDrop, transitionTo, fadeInScene, FONT_STACK } from '../utils/ui'
import { feedback } from '../systems/feedback'

const CHAPTER_SIZE = 25

/**
 * The front door. It opens on a single, tidy vertical column so nothing crowds
 * anything else: a top bar of stats, a hero (logo → title → subtitle → progress
 * bar), the two big actions, a row of setting toggles, the how-to card, and —
 * on native — the store row pinned to the bottom.
 *
 * Every element sits on a fixed rhythm of Y anchors with real gaps between the
 * bounding boxes. The whole stack ends by ~1010 so it clears the store row, and
 * the store row itself stays above `layout.bannerSafeBottom` (the native ad bar
 * hangs over the web view and would otherwise clip the bottom).
 */
export class HomeScene extends Phaser.Scene {
  private theme!: ChapterTheme
  private honeyText?: Phaser.GameObjects.Text
  /** In-flight StoreKit call — blocks double-taps opening two payment sheets. */
  private storeBusy = false

  constructor() {
    super('Home')
  }

  create(data?: { toastKey?: 'store.adsRemoved' | 'store.restored' }): void {
    this.storeBusy = false
    const level = saveManager.currentLevel
    this.theme = themeForChapter(Math.ceil(level / CHAPTER_SIZE))
    fadeInScene(this)
    paintBackground(this, this.theme)

    this.buildTopBar()
    this.buildDailyGift()
    this.buildHero()

    const started = saveManager.levelsCompleted() > 0
    makeButton(
      this,
      GAME_WIDTH / 2,
      576,
      started ? t('menu.continue', { n: level }) : t('menu.playFirst'),
      () => transitionTo(this, 'Game', { levelIndex: level - 1 }),
      { width: 484, height: 108, fontSize: 34, accent: this.theme.accent },
    )

    makeButton(this, GAME_WIDTH / 2, 672, t('menu.levels'), () => transitionTo(this, 'Menu'), {
      width: 484,
      height: 80,
      fontSize: 28,
      primary: false,
    })

    // No Compass Hive entry: its rules ARE the campaign now — sealed rim, free
    // turning, doors instead of an open edge. A second door into the same game
    // would only split progress across two save tracks.

    this.buildSettingsToggles()
    this.buildHowToCard()
    this.buildStoreRow()

    // A purchase/restore success restarts this scene to redraw the store row;
    // the confirmation toast rides through the restart via scene data.
    if (data?.toastKey) this.showToast(t(data.toastKey))

    void adService.showBanner()
  }

  // ── Top bar ─────────────────────────────────────────────────────────────────

  /** Stars (left) and honey (right) as matching glass chips, distinct glyphs. */
  private buildTopBar(): void {
    this.statPill(40, 56, `${saveManager.totalStars()}/${LEVEL_COUNT * 3}`, 'star')
    const honey = String(saveManager.honey)
    const w = Math.max(150, 108 + honey.length * 20)
    this.statPill(GAME_WIDTH - 40 - w, 56, honey, 'honey', w)
  }

  /**
   * Daily gift chip between the two stat pills: a small, honest streak — honey
   * that grows a little per consecutive day, no timers, no push, all local.
   * Only rendered while today's gift is unclaimed.
   */
  private buildDailyGift(): void {
    if (!saveManager.canClaimDaily()) return
    const chip = this.add.container(GAME_WIDTH / 2, 86)
    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.34)
    g.fillRoundedRect(-84, -30, 168, 60, 30)
    g.lineStyle(2, this.theme.accent, 0.9)
    g.strokeRoundedRect(-84, -30, 168, 60, 30)
    chip.add(g)
    chip.add(drawHoneyDrop(this, -56, 0, 12))
    chip.add(
      this.add
        .text(10, 0, t('daily.gift'), { fontFamily: FONT_STACK, fontSize: '21px', color: this.theme.accentCss })
        .setOrigin(0.5),
    )
    // A gentle beckoning pulse — it is a gift, it may glimmer.
    this.tweens.add({
      targets: chip,
      scale: 1.05,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    const hit = this.add.rectangle(0, 0, 168, 60, 0, 0).setInteractive({ useHandCursor: true })
    chip.add(hit)
    hit.on('pointerdown', () => {
      const reward = saveManager.claimDaily()
      if (!reward) {
        chip.destroy()
        return
      }
      feedback.unlock()
      feedback.escape(1)
      this.honeyText?.setText(String(saveManager.honey))
      this.showToast(t('daily.claimed', { n: reward.honey, streak: reward.streak }))
      this.tweens.killTweensOf(chip)
      this.tweens.add({
        targets: chip,
        scale: 0,
        alpha: 0,
        duration: 220,
        ease: 'Back.easeIn',
        onComplete: () => chip.destroy(),
      })
    })
  }

  private statPill(x: number, y: number, value: string, kind: 'star' | 'honey', width = 176): void {
    const h = 60
    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.34)
    g.fillRoundedRect(x, y, width, h, h / 2)
    g.lineStyle(2, kind === 'honey' ? this.theme.accent : 0xffffff, kind === 'honey' ? 0.6 : 0.1)
    g.strokeRoundedRect(x, y, width, h, h / 2)
    if (kind === 'honey') {
      drawHoneyDrop(this, x + 32, y + h / 2, 13)
    } else {
      this.add.star(x + 32, y + h / 2, 5, 8.5, 18, colors.starGold).setOrigin(0.5)
    }
    const valueText = this.add
      .text(x + 60, y + h / 2, value, {
        fontFamily: FONT_STACK,
        fontSize: '28px',
        color: colors.hudTextCss,
      })
      .setOrigin(0, 0.5)
    // The honey chip doubles as the Shop entry — tap to buy honey / power-ups.
    if (kind === 'honey') {
      this.honeyText = valueText
      this.add
        .text(x + width - 24, y + h / 2, '＋', { fontFamily: FONT_STACK, fontSize: '30px', color: this.theme.accentCss })
        .setOrigin(0.5)
      this.add
        .rectangle(x + width / 2, y + h / 2, width, h, 0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          feedback.tap()
          transitionTo(this, 'Shop', { returnTo: 'Home' })
        })
    }
  }

  // ── Hero ────────────────────────────────────────────────────────────────────

  private buildHero(): void {
    const logo = this.add.image(GAME_WIDTH / 2, 232, 'logo').setScale(0.3)
    this.tweens.add({
      targets: logo,
      y: 242,
      angle: 2,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    this.add
      .text(GAME_WIDTH / 2, 388, t('app.title'), {
        fontFamily: FONT_STACK,
        fontSize: '70px',
        color: '#ffd23f',
        stroke: '#241708',
        strokeThickness: 9,
      })
      .setOrigin(0.5)

    this.add
      .text(GAME_WIDTH / 2, 444, t('app.subtitle'), {
        fontFamily: FONT_STACK,
        fontSize: '26px',
        color: this.theme.accentCss,
      })
      .setOrigin(0.5)
      .setAlpha(0.92)

    this.buildProgressBar(496)
  }

  /**
   * A slim rounded progress bar with the count on top. Reads at a glance as
   * "how far through the game am I" — more modern, and more motivating, than a
   * bare line of text.
   */
  private buildProgressBar(y: number): void {
    const done = saveManager.levelsCompleted()
    const w = 340
    const h = 16
    const x = GAME_WIDTH / 2 - w / 2
    const frac = Phaser.Math.Clamp(done / LEVEL_COUNT, 0, 1)

    this.add
      .text(GAME_WIDTH / 2, y - 16, t('menu.progress', { done, total: LEVEL_COUNT }), {
        fontFamily: FONT_STACK,
        fontSize: '22px',
        color: colors.hudTextCss,
      })
      .setOrigin(0.5)
      .setAlpha(0.7)

    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.34)
    g.fillRoundedRect(x, y + 6, w, h, h / 2)
    g.lineStyle(2, 0xffffff, 0.08)
    g.strokeRoundedRect(x, y + 6, w, h, h / 2)
    if (frac > 0) {
      // Keep a sliver visible even at 1/150 so the bar never looks empty/broken.
      const fillW = Math.max(h, w * frac)
      g.fillStyle(this.theme.accent, 1)
      g.fillRoundedRect(x, y + 6, fillW, h, h / 2)
      // Glossy top-half highlight so the fill reads as a raised, polished bar.
      g.fillStyle(0xffffff, 0.22)
      g.fillRoundedRect(x + 3, y + 8, fillW - 6, h * 0.42, (h * 0.42) / 2)
    }
  }

  // ── Setting toggles ─────────────────────────────────────────────────────────

  /**
   * Sound + vibration as two labelled pill toggles, side by side, with a clear
   * 32px gap to the how-to card below. A filled accent pill reads as "on"; a
   * muted pill with a struck-through, dimmed icon reads as "off".
   */
  private buildSettingsToggles(): void {
    const y = 822
    this.togglePill(GAME_WIDTH / 2 - 98, y, 'sound', t('settings.sound'), () => saveManager.get().settings.sfx, (v) =>
      saveManager.updateSettings({ sfx: v }),
    )
    this.togglePill(GAME_WIDTH / 2 + 98, y, 'vibe', t('settings.vibe'), () => saveManager.get().settings.haptics, (v) =>
      saveManager.updateSettings({ haptics: v }),
    )
  }

  private togglePill(
    x: number,
    y: number,
    kind: 'sound' | 'vibe',
    labelText: string,
    get: () => boolean,
    set: (v: boolean) => void,
  ): void {
    const W = 184
    const H = 60
    const rad = H / 2
    const pill = this.add.container(x, y)
    const bg = this.add.graphics()
    const icon = this.add.graphics()
    const label = this.add
      .text(0, 0, labelText, { fontFamily: FONT_STACK, fontSize: '24px', color: '#efe9ff' })
      .setOrigin(0, 0.5)
    pill.add([bg, icon, label])

    // Centre the icon + label as one cluster: measure the label, then lay the
    // pair out around the pill's middle so the text never runs off the edge.
    const iconHalf = 14
    const gap = 14
    const cluster = iconHalf * 2 + gap + label.width
    const iconCX = -cluster / 2 + iconHalf
    label.setX(-cluster / 2 + iconHalf * 2 + gap)

    // Ghost toggle: a dark glass pill in BOTH states, so it never competes with
    // the gold primary CTA. "On" is carried by the accent-gold icon + label and
    // an accent rim; "off" is muted grey with a struck-through icon.
    const draw = (): void => {
      const on = get()
      const ink = on ? this.theme.accent : 0x8f88a8
      const inner = 0x241a2e
      bg.clear()
      bg.fillStyle(0x000000, 0.28)
      bg.fillRoundedRect(-W / 2, -H / 2 + 6, W, H, rad)
      bg.fillStyle(0x000000, 0.32)
      bg.fillRoundedRect(-W / 2, -H / 2, W, H, rad)
      bg.lineStyle(2, on ? this.theme.accent : 0xffffff, on ? 0.5 : 0.08)
      bg.strokeRoundedRect(-W / 2, -H / 2, W, H, rad)

      label.setColor(on ? this.theme.accentCss : '#8f88a8')

      icon.clear()
      icon.setPosition(iconCX, 0)
      if (kind === 'sound') {
        icon.fillStyle(ink, 1)
        icon.fillRect(-12, -5, 5, 10)
        icon.fillTriangle(-7, -10, -7, 10, 3, 5)
        icon.fillTriangle(-7, -10, 3, -5, 3, 5)
        if (on) {
          icon.lineStyle(3, ink, 1)
          icon.beginPath(); icon.arc(6, 0, 6, -0.7, 0.7); icon.strokePath()
          icon.beginPath(); icon.arc(6, 0, 11, -0.7, 0.7); icon.strokePath()
        }
      } else {
        icon.fillStyle(ink, 1)
        icon.fillRoundedRect(-7, -12, 14, 24, 3)
        icon.fillStyle(inner, 1)
        icon.fillRoundedRect(-4, -8, 8, 15, 2)
        if (on) {
          icon.lineStyle(3, ink, 1)
          icon.beginPath(); icon.moveTo(-13, -5); icon.lineTo(-13, 5); icon.strokePath()
          icon.beginPath(); icon.moveTo(13, -5); icon.lineTo(13, 5); icon.strokePath()
        }
      }
      if (!on) {
        icon.lineStyle(3, 0xd06060, 0.95)
        icon.beginPath(); icon.moveTo(-13, -13); icon.lineTo(13, 13); icon.strokePath()
      }
    }
    draw()

    pill.setSize(W, H)
    pill.setInteractive({ useHandCursor: true })
    pill.on('pointerdown', () => this.tweens.add({ targets: pill, scale: 0.94, duration: 60 }))
    pill.on('pointerout', () => this.tweens.add({ targets: pill, scale: 1, duration: 60 }))
    pill.on('pointerup', () => {
      this.tweens.add({ targets: pill, scale: 1, duration: 60 })
      set(!get())
      draw()
      // Fire through the just-updated setting so the feedback matches the state.
      feedback.unlock()
      feedback.tap()
    })
  }

  // ── How to play ───────────────────────────────────────────────────────────

  /** The trail rule in one paragraph, because it is not a rule players expect. */
  private buildHowToCard(): void {
    const w = 620
    const h = 132
    const x = GAME_WIDTH / 2 - w / 2
    const y = 878
    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.3)
    g.fillRoundedRect(x, y, w, h, 24)
    g.lineStyle(2, 0xffffff, 0.1)
    g.strokeRoundedRect(x, y, w, h, 24)

    this.add
      .text(GAME_WIDTH / 2, y + 28, t('home.howTitle'), {
        fontFamily: FONT_STACK,
        fontSize: '23px',
        color: this.theme.accentCss,
      })
      .setOrigin(0.5)
    this.add
      .text(GAME_WIDTH / 2, y + 82, t('home.how'), {
        fontFamily: FONT_STACK,
        fontSize: '19px',
        color: colors.hudTextCss,
        align: 'center',
        wordWrap: { width: w - 48 },
        lineSpacing: 4,
      })
      .setOrigin(0.5)
      .setAlpha(0.85)
  }

  // ── Store ───────────────────────────────────────────────────────────────────

  /**
   * Store controls: buy "remove ads", plus the Restore control Apple requires of
   * any app selling a non-consumable. Native only — on web there is no store.
   * Two equal halves so "Restore Purchases" fits its own label.
   */
  private buildStoreRow(): void {
    if (!purchaseService.storeAvailable) return
    const y = layout.bannerSafeBottom - 60

    if (!purchaseService.adsRemoved) {
      const price = purchaseService.removeAdsPrice
      makeButton(
        this,
        192,
        y,
        price ? t('store.removeAdsPrice', { price }) : t('store.removeAds'),
        () => void this.buyRemoveAds(),
        { width: 312, height: 60, fontSize: 21, primary: false },
      )
    } else {
      this.add
        .text(192, y, t('store.adsRemoved'), {
          fontFamily: FONT_STACK,
          fontSize: '21px',
          color: colors.honeyCss,
        })
        .setOrigin(0.5)
    }

    makeButton(this, GAME_WIDTH - 192, y, t('store.restore'), () => void this.restorePurchases(), {
      width: 312,
      height: 60,
      fontSize: 21,
      primary: false,
    })
  }

  private async buyRemoveAds(): Promise<void> {
    if (this.storeBusy) return
    this.storeBusy = true
    const res = await purchaseService.buyRemoveAds()
    if (!this.scene.isActive('Home')) return
    this.storeBusy = false
    if (res.ok) {
      // Restart redraws the row without the buy button; the toast would die
      // with this scene instance, so it travels through the restart data.
      this.scene.restart({ toastKey: 'store.adsRemoved' })
      return
    }
    if (res.reason === 'cancelled') return // silent: the player chose to back out
    this.showToast(
      res.reason === 'pending'
        ? t('store.pending')
        : res.reason === 'unavailable'
          ? t('store.unavailable')
          : t('store.failed'),
    )
  }

  private async restorePurchases(): Promise<void> {
    if (this.storeBusy) return
    this.storeBusy = true
    const res = await purchaseService.restore()
    if (!this.scene.isActive('Home')) return
    this.storeBusy = false
    if (res.ok) {
      this.scene.restart({ toastKey: 'store.restored' })
    } else {
      this.showToast(
        res.reason === 'unavailable' ? t('store.unavailable') : t('store.nothingToRestore'),
      )
    }
  }

  private showToast(message: string): void {
    const label = this.add
      .text(GAME_WIDTH / 2, layout.bannerSafeBottom - 150, message, {
        fontFamily: FONT_STACK,
        fontSize: '24px',
        color: colors.hudTextCss,
        backgroundColor: '#000000cc',
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setDepth(300)
    this.tweens.add({
      targets: label,
      alpha: 0,
      delay: 1800,
      duration: 400,
      onComplete: () => label.destroy(),
    })
  }
}
