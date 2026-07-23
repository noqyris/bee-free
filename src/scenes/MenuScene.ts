import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT, colors } from '../config/gameConfig'
import { LEVEL_COUNT } from '../levels'
import { CHAPTER_THEMES, themeForChapter, type ChapterTheme } from '../config/theme'
import { purchaseService } from '../systems/PurchaseService'
import { saveManager } from '../systems/SaveManager'
import { paintBackground, type Background } from '../utils/background'
import { t, type StringKey } from '../i18n'
import { makeButton, makeIconButton, FONT_STACK } from '../utils/ui'

const CHAPTER_SIZE = 25
const COLS = 5
const ROWS = 5
const GRID_TOP = 340
const GRID_BOTTOM = 958
const GRID_LEFT = 112
const GRID_RIGHT = GAME_WIDTH - 112

export class MenuScene extends Phaser.Scene {
  private currentChapter = 1
  private bg!: Background
  private page!: Phaser.GameObjects.Container
  private chapterTitle!: Phaser.GameObjects.Text
  private chapterSub!: Phaser.GameObjects.Text
  private dots: Phaser.GameObjects.Arc[] = []
  private ringTween?: Phaser.Tweens.Tween

  constructor() {
    super('Menu')
  }

  create(): void {
    // Phaser reuses the Scene instance across scene.start, so class-field
    // initializers do NOT re-run on re-entry — reset per-session state here.
    this.dots = []
    this.ringTween = undefined
    this.currentChapter = Math.ceil(saveManager.currentLevel / CHAPTER_SIZE)
    const theme = themeForChapter(this.currentChapter)
    this.bg = paintBackground(this, theme)

    this.buildHeader()
    this.buildChapterNav()
    this.buildDots()
    this.renderChapter(this.currentChapter)
    this.buildStoreRow()

    // Continue button always resumes the player's current level — label it with
    // that level number so it's clear it isn't "play the chapter you're browsing".
    makeButton(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 78,
      t('menu.continue', { n: saveManager.currentLevel }),
      () => this.startLevel(saveManager.currentLevel),
      { width: 420, height: 88, fontSize: 32, accent: theme.accent },
    ).setDepth(50)
  }

  /**
   * Stat pills sit on their own row ABOVE the wordmark. Side by side, the 68px
   * title spans x≈191–529 and ran straight into both pills (38–214, 506–682);
   * stacking is the only arrangement that stays clear at this width.
   */
  private buildHeader(): void {
    this.statPill(38, 44, 176, `${saveManager.totalStars()}/${LEVEL_COUNT * 3}`, colors.starGold, colors.hudTextCss, 26)
    this.statPill(GAME_WIDTH - 214, 44, 176, String(saveManager.honey), colors.honey, colors.honeyCss, 30)

    this.add
      .text(GAME_WIDTH / 2, 140, t('app.title'), {
        fontFamily: FONT_STACK,
        fontSize: '64px',
        color: '#ffd23f',
        stroke: '#241708',
        strokeThickness: 9,
      })
      .setOrigin(0.5)
  }

  /** Rounded "glass" chip: translucent fill, hairline rim, star + value. */
  private statPill(
    x: number,
    y: number,
    w: number,
    value: string,
    starColor: number,
    textCss: string,
    fontSize: number,
  ): void {
    const h = 56
    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.32)
    g.fillRoundedRect(x, y, w, h, h / 2)
    g.lineStyle(2, 0xffffff, 0.1)
    g.strokeRoundedRect(x, y, w, h, h / 2)
    this.add.star(x + 28, y + h / 2, 5, 8, 17, starColor).setOrigin(0.5)
    this.add
      .text(x + 52, y + h / 2, value, {
        fontFamily: FONT_STACK,
        fontSize: `${fontSize}px`,
        color: textCss,
      })
      .setOrigin(0, 0.5)
  }

  private buildChapterNav(): void {
    this.chapterTitle = this.add
      .text(GAME_WIDTH / 2, 208, '', {
        fontFamily: FONT_STACK,
        fontSize: '44px',
        color: colors.hudTextCss,
      })
      .setOrigin(0.5)
    this.chapterSub = this.add
      .text(GAME_WIDTH / 2, 250, '', {
        fontFamily: FONT_STACK,
        fontSize: '24px',
        color: colors.hudTextCss,
      })
      .setOrigin(0.5)
      .setAlpha(0.6)

    makeIconButton(this, 60, 222, '‹', () => this.changeChapter(-1), 34)
    makeIconButton(this, GAME_WIDTH - 60, 222, '›', () => this.changeChapter(1), 34)
  }

  /**
   * Store controls: buy "remove ads", plus the Restore control Apple requires
   * any app selling a non-consumable to expose. Native only — on web there is
   * no store, so the row is simply absent.
   */
  private buildStoreRow(): void {
    if (!purchaseService.storeAvailable) return
    const y = 1096

    if (!purchaseService.adsRemoved) {
      const price = purchaseService.removeAdsPrice
      makeButton(
        this,
        250,
        y,
        price ? t('store.removeAdsPrice', { price }) : t('store.removeAds'),
        () => void this.buyRemoveAds(),
        { width: 300, height: 54, fontSize: 22, primary: false },
      ).setDepth(50)
    } else {
      this.add
        .text(250, y, t('store.adsRemoved'), {
          fontFamily: FONT_STACK,
          fontSize: '22px',
          color: colors.honeyCss,
        })
        .setOrigin(0.5)
        .setDepth(50)
    }

    makeButton(this, 520, y, t('store.restore'), () => void this.restorePurchases(), {
      width: 180,
      height: 54,
      fontSize: 19,
      primary: false,
    }).setDepth(50)
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
      this.showToast(res.reason === 'unavailable' ? t('store.unavailable') : t('store.nothingToRestore'))
    }
  }

  /** Brief, non-blocking feedback message near the bottom of the menu. */
  private showToast(message: string): void {
    const label = this.add
      .text(GAME_WIDTH / 2, 1030, message, {
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

  private buildDots(): void {
    const y = GRID_BOTTOM + 66
    const n = CHAPTER_THEMES.length
    const spacing = 30
    const startX = GAME_WIDTH / 2 - ((n - 1) * spacing) / 2
    for (let i = 0; i < n; i++) {
      this.dots.push(this.add.circle(startX + i * spacing, y, 6, 0xffffff, 0.3))
    }
  }

  private changeChapter(delta: number): void {
    const next = Phaser.Math.Clamp(this.currentChapter + delta, 1, CHAPTER_THEMES.length)
    if (next === this.currentChapter) return
    this.currentChapter = next
    const theme = themeForChapter(next)
    this.bg.retint(theme)
    this.renderChapter(next)
  }

  private renderChapter(chapter: number): void {
    // Stop the previous current-node pulse before destroying its ring, else the
    // repeat:-1 tween keeps running on the detached child (Phaser doesn't remove
    // tweens whose target was destroyed).
    this.ringTween?.remove()
    this.ringTween = undefined
    this.page?.destroy()
    this.page = this.add.container(0, 0)
    const theme = themeForChapter(chapter)

    this.chapterTitle.setText(t('menu.chapter', { n: chapter })).setColor(theme.accentCss)
    this.chapterSub.setText(t(`chapter.${chapter}` as StringKey))

    this.dots.forEach((d, i) =>
      d.setFillStyle(0xffffff, i === chapter - 1 ? 0.95 : 0.28).setScale(i === chapter - 1 ? 1.3 : 1),
    )

    const colStep = (GRID_RIGHT - GRID_LEFT) / (COLS - 1)
    const rowStep = (GRID_BOTTOM - GRID_TOP) / (ROWS - 1)

    for (let i = 0; i < CHAPTER_SIZE; i++) {
      const levelId = (chapter - 1) * CHAPTER_SIZE + i + 1
      if (levelId > LEVEL_COUNT) break
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const x = GRID_LEFT + col * colStep
      const y = GRID_TOP + row * rowStep
      this.buildNode(x, y, levelId, theme)
    }

    // Fade the page in for a smooth chapter change.
    this.page.setAlpha(0)
    this.tweens.add({ targets: this.page, alpha: 1, duration: 180 })
  }

  private buildNode(x: number, y: number, levelId: number, theme: ChapterTheme): void {
    const unlocked = saveManager.isUnlocked(levelId)
    const isCurrent = levelId === saveManager.currentLevel
    const stars = saveManager.starsFor(levelId)
    const radius = 48

    const node = this.add.container(x, y)
    this.page.add(node)

    // Shadow + hex body
    const shadow = this.add.image(0, 5, 'hex').setScale(radius / 62).setTint(0x000000).setAlpha(0.25)
    const body = this.add.image(0, 0, 'hex').setScale(radius / 62)
    body.setTint(unlocked ? theme.cellFill : colors.locked)
    node.add([shadow, body])

    if (isCurrent) {
      body.setTint(theme.accent)
      const ring = this.add.image(0, 0, 'hex').setScale((radius / 62) * 1.16).setTint(0xffffff).setAlpha(0.9)
      ring.setDepth(-1)
      node.add(ring)
      this.ringTween = this.tweens.add({
        targets: ring,
        scale: (radius / 62) * 1.24,
        alpha: 0.35,
        duration: 720,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }

    const label = this.add
      .text(0, stars > 0 || !unlocked ? -8 : 0, String(levelId), {
        fontFamily: FONT_STACK,
        fontSize: '30px',
        color: unlocked ? '#241708' : '#6a6480',
      })
      .setOrigin(0.5)
    node.add(label)

    if (!unlocked) {
      // Small drawn padlock (avoids emoji-font risk).
      const lock = this.add.graphics()
      lock.fillStyle(0x8f88a8, 1)
      lock.fillRoundedRect(-11, 8, 22, 17, 4)
      lock.lineStyle(4, 0x8f88a8, 1)
      lock.strokeCircle(0, 6, 8)
      node.add(lock)
      label.setY(-14)
    } else if (stars > 0) {
      const starY = 18
      for (let s = 0; s < 3; s++) {
        node.add(
          this.add
            .star(-16 + s * 16, starY, 5, 4, 8.5, s < stars ? colors.starGold : colors.starEmpty)
            .setOrigin(0.5),
        )
      }
    }

    if (unlocked) {
      // Square hit area from the node size (reliable container-input path).
      node.setSize(radius * 1.9, radius * 1.9)
      node.setInteractive({ useHandCursor: true })
      node.on('pointerdown', () => this.tweens.add({ targets: node, scale: 0.9, duration: 60 }))
      node.on('pointerout', () => this.tweens.add({ targets: node, scale: 1, duration: 60 }))
      node.on('pointerup', () => {
        this.tweens.add({ targets: node, scale: 1, duration: 60 })
        this.startLevel(levelId)
      })
    }
  }

  private startLevel(levelId: number): void {
    this.scene.start('Game', { levelIndex: levelId - 1 })
  }
}
