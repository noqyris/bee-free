import Phaser from 'phaser'
import { GAME_WIDTH, colors, layout } from '../config/gameConfig'
import { LEVEL_COUNT } from '../levels'
import { themeForChapter } from '../config/theme'
import { purchaseService } from '../systems/PurchaseService'
import { saveManager } from '../systems/SaveManager'
import { adService } from '../systems/AdService'
import { paintBackground } from '../utils/background'
import { t } from '../i18n'
import { makeButton, FONT_STACK } from '../utils/ui'
import { feedback } from '../systems/feedback'

const CHAPTER_SIZE = 25

/**
 * The front door. Until now the app opened straight onto the level grid, which
 * left nowhere to say what the game IS and nowhere for the store controls to
 * sit without crowding the map — so both were jammed into the grid screen.
 *
 * Everything here stays above `layout.bannerSafeBottom`: the ad banner is a
 * native bar over the web view and would otherwise clip the bottom row.
 */
export class HomeScene extends Phaser.Scene {
  constructor() {
    super('Home')
  }

  create(): void {
    const level = saveManager.currentLevel
    const theme = themeForChapter(Math.ceil(level / CHAPTER_SIZE))
    paintBackground(this, theme)

    this.buildStats()
    this.buildEmblem(theme.cellFill, theme.cellStroke)
    this.buildTitle(theme.accentCss)

    const started = saveManager.levelsCompleted() > 0
    makeButton(
      this,
      GAME_WIDTH / 2,
      566,
      started ? t('menu.continue', { n: level }) : t('menu.playFirst'),
      () => this.scene.start('Game', { levelIndex: level - 1 }),
      { width: 460, height: 112, fontSize: 36, accent: theme.accent },
    )

    makeButton(this, GAME_WIDTH / 2, 692, t('menu.levels'), () => this.scene.start('Menu'), {
      width: 460,
      height: 86,
      fontSize: 30,
      primary: false,
    })

    this.buildSettingsToggles()
    this.buildHowToCard(theme.accentCss)
    this.buildStoreRow()

    void adService.showBanner()
  }

  /**
   * Sound + vibration toggles, side by side between the Levels button and the
   * how-to card. Drawn glyphs (a speaker, a buzzing phone) rather than emoji,
   * which render inconsistently across iOS font fallbacks. A struck-through,
   * dimmed icon reads as "off".
   */
  private buildSettingsToggles(): void {
    const y = 762
    this.toggleChip(GAME_WIDTH / 2 - 70, y, 'sound', () => saveManager.get().settings.sfx, (v) =>
      saveManager.updateSettings({ sfx: v }),
    )
    this.toggleChip(GAME_WIDTH / 2 + 70, y, 'vibe', () => saveManager.get().settings.haptics, (v) =>
      saveManager.updateSettings({ haptics: v }),
    )
  }

  private toggleChip(
    x: number,
    y: number,
    kind: 'sound' | 'vibe',
    get: () => boolean,
    set: (v: boolean) => void,
  ): void {
    const r = 34
    const chip = this.add.container(x, y)
    const bg = this.add.graphics()
    const icon = this.add.graphics()
    chip.add([bg, icon])

    const draw = (): void => {
      const on = get()
      bg.clear()
      bg.fillStyle(0x000000, 0.32)
      bg.fillCircle(0, 6, r)
      bg.fillStyle(on ? colors.starGold : 0x473f5e, on ? 0.9 : 1)
      bg.fillCircle(0, 0, r)
      bg.lineStyle(2, 0xffffff, 0.12)
      bg.strokeCircle(0, 0, r)

      icon.clear()
      const ink = on ? 0x241708 : 0x9a93b0
      if (kind === 'sound') {
        // Speaker cone + two sound-wave arcs.
        icon.fillStyle(ink, 1)
        icon.fillRect(-14, -6, 6, 12)
        icon.fillTriangle(-8, -11, -8, 11, 4, 6)
        icon.fillTriangle(-8, -11, 4, -6, 4, 6)
        if (on) {
          icon.lineStyle(3, ink, 1)
          icon.beginPath(); icon.arc(6, 0, 7, -0.7, 0.7); icon.strokePath()
          icon.beginPath(); icon.arc(6, 0, 13, -0.7, 0.7); icon.strokePath()
        }
      } else {
        // Phone body + buzz lines on each side.
        icon.fillStyle(ink, 1)
        icon.fillRoundedRect(-8, -14, 16, 28, 4)
        icon.fillStyle(on ? 0x473f5e : 0x2c2740, 1)
        icon.fillRoundedRect(-5, -10, 10, 18, 2)
        if (on) {
          icon.lineStyle(3, ink, 1)
          icon.beginPath(); icon.moveTo(-15, -6); icon.lineTo(-15, 6); icon.strokePath()
          icon.beginPath(); icon.moveTo(15, -6); icon.lineTo(15, 6); icon.strokePath()
        }
      }
      if (!on) {
        icon.lineStyle(3, 0xd06060, 0.95)
        icon.beginPath(); icon.moveTo(-16, -16); icon.lineTo(16, 16); icon.strokePath()
      }
    }
    draw()

    chip.setSize(r * 2, r * 2)
    chip.setInteractive({ useHandCursor: true })
    chip.on('pointerdown', () => this.tweens.add({ targets: chip, scale: 0.9, duration: 60 }))
    chip.on('pointerout', () => this.tweens.add({ targets: chip, scale: 1, duration: 60 }))
    chip.on('pointerup', () => {
      this.tweens.add({ targets: chip, scale: 1, duration: 60 })
      const next = !get()
      set(next)
      draw()
      // Give immediate feedback in the sense the player just enabled — the tap
      // sound/haptic fires through the newly-updated setting.
      feedback.unlock()
      feedback.tap()
    })
  }

  /** Stars and honey, as glass chips in the top corners. */
  private buildStats(): void {
    this.statPill(38, 44, 186, `${saveManager.totalStars()}/${LEVEL_COUNT * 3}`, colors.starGold, 26)
    this.statPill(GAME_WIDTH - 224, 44, 186, String(saveManager.honey), colors.honey, 30)
  }

  private statPill(x: number, y: number, w: number, value: string, star: number, size: number): void {
    const h = 56
    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.32)
    g.fillRoundedRect(x, y, w, h, h / 2)
    g.lineStyle(2, 0xffffff, 0.1)
    g.strokeRoundedRect(x, y, w, h, h / 2)
    this.add.star(x + 30, y + h / 2, 5, 8, 17, star).setOrigin(0.5)
    this.add
      .text(x + 56, y + h / 2, value, {
        fontFamily: FONT_STACK,
        fontSize: `${size}px`,
        color: colors.hudTextCss,
      })
      .setOrigin(0, 0.5)
  }

  /** The wordmark art: a bee over a honeycomb, gently bobbing. */
  private buildEmblem(_fill: number, _stroke: number): void {
    const logo = this.add.image(GAME_WIDTH / 2, 206, 'logo').setScale(0.36)
    this.tweens.add({
      targets: logo,
      y: 216,
      angle: 2,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  private buildTitle(accentCss: string): void {
    this.add
      .text(GAME_WIDTH / 2, 356, t('app.title'), {
        fontFamily: FONT_STACK,
        fontSize: '76px',
        color: '#ffd23f',
        stroke: '#241708',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
    this.add
      .text(GAME_WIDTH / 2, 418, t('app.subtitle'), {
        fontFamily: FONT_STACK,
        fontSize: '28px',
        color: accentCss,
      })
      .setOrigin(0.5)
    this.add
      .text(
        GAME_WIDTH / 2,
        464,
        t('menu.progress', { done: saveManager.levelsCompleted(), total: LEVEL_COUNT }),
        { fontFamily: FONT_STACK, fontSize: '24px', color: colors.hudTextCss },
      )
      .setOrigin(0.5)
      .setAlpha(0.6)
  }

  /** The trail rule in one paragraph, because it is not a rule players expect. */
  private buildHowToCard(accentCss: string): void {
    const w = 620
    const h = 158
    const x = GAME_WIDTH / 2 - w / 2
    const y = 796
    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.3)
    g.fillRoundedRect(x, y, w, h, 22)
    g.lineStyle(2, 0xffffff, 0.1)
    g.strokeRoundedRect(x, y, w, h, 22)

    this.add
      .text(GAME_WIDTH / 2, y + 30, t('home.howTitle'), {
        fontFamily: FONT_STACK,
        fontSize: '24px',
        color: accentCss,
      })
      .setOrigin(0.5)
    this.add
      .text(GAME_WIDTH / 2, y + 96, t('home.how'), {
        fontFamily: FONT_STACK,
        fontSize: '20px',
        color: colors.hudTextCss,
        align: 'center',
        wordWrap: { width: w - 48 },
        lineSpacing: 4,
      })
      .setOrigin(0.5)
      .setAlpha(0.85)
  }

  /**
   * Store controls: buy "remove ads", plus the Restore control Apple requires of
   * any app selling a non-consumable. Native only — on web there is no store.
   * Both buttons are full-width halves so "Restore Purchases" fits its label;
   * squeezed into 180px it wrapped against its own edges.
   */
  private buildStoreRow(): void {
    if (!purchaseService.storeAvailable) return
    const y = layout.bannerSafeBottom - 62

    if (!purchaseService.adsRemoved) {
      const price = purchaseService.removeAdsPrice
      makeButton(
        this,
        192,
        y,
        price ? t('store.removeAdsPrice', { price }) : t('store.removeAds'),
        () => void this.buyRemoveAds(),
        { width: 304, height: 60, fontSize: 21, primary: false },
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
      width: 304,
      height: 60,
      fontSize: 21,
      primary: false,
    })
  }

  private async buyRemoveAds(): Promise<void> {
    const res = await purchaseService.buyRemoveAds()
    if (res.ok) {
      this.showToast(t('store.adsRemoved'))
      this.scene.restart() // redraw the row without the buy button
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
    const res = await purchaseService.restore()
    if (res.ok) {
      this.showToast(t('store.restored'))
      this.scene.restart()
    } else {
      this.showToast(
        res.reason === 'unavailable' ? t('store.unavailable') : t('store.nothingToRestore'),
      )
    }
  }

  private showToast(message: string): void {
    const label = this.add
      .text(GAME_WIDTH / 2, 748, message, {
        fontFamily: FONT_STACK,
        fontSize: '24px',
        color: colors.hudTextCss,
        backgroundColor: '#00000099',
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
