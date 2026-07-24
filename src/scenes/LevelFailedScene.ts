import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT, colors } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { ADS } from '../config/monetization'
import { themeForChapter } from '../config/theme'
import { t, tp } from '../i18n'
import { adService } from '../systems/AdService'
import { makeButton, FONT_STACK } from '../utils/ui'
import type { GameScene } from './GameScene'

interface LevelFailedData {
  levelIndex: number
  chapter: number
  beesLeft: number
  queenLeftEarly?: boolean
}

export class LevelFailedScene extends Phaser.Scene {
  private params!: LevelFailedData
  private busy = false

  constructor() {
    super('LevelFailed')
  }

  init(data: LevelFailedData): void {
    this.params = data
    this.busy = false
  }

  create(): void {
    const theme = themeForChapter(this.params.chapter)
    // A queen violation is unrecoverable, so extra moves would be a lie — only
    // offer the rewarded revive when the player simply ran out of moves.
    const canRevive = !this.params.queenLeftEarly && adService.canOfferRewarded()

    const backdrop = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, colors.dimBackdrop, 1)
      .setAlpha(0)
      .setInteractive()
    this.tweens.add({ targets: backdrop, alpha: juice.ui.backdropAlpha, duration: juice.ui.backdropFadeMs })

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60).setAlpha(0)

    // Panel height is content-driven so the buttons always sit INSIDE it. The
    // old version pinned the menu button's centre at the panel's exact bottom
    // edge, so its rounded base and drop shadow spilled over the border — the
    // "buttons falling out of the modal" seen on a fail with the revive offer.
    // These coordinates keep the lowest button's shadow ≥ 20px clear of the rim.
    const half = canRevive ? 300 : 268
    const g = this.add.graphics()
    g.fillStyle(colors.panelDeep, 1)
    g.fillRoundedRect(-284, -half - 4, 568, (half + 4) * 2, 40)
    g.fillStyle(colors.panel, 1)
    g.fillRoundedRect(-280, -half, 560, half * 2, 36)
    g.lineStyle(4, theme.accent, 0.7)
    g.strokeRoundedRect(-280, -half, 560, half * 2, 36)
    panel.add(g)

    const titleY = canRevive ? -212 : -180
    const beeY = canRevive ? -120 : -78
    const beesLeftY = canRevive ? -58 : -6

    panel.add(
      this.add
        .text(0, titleY, this.params.queenLeftEarly ? t('result.loseQueen') : t('result.lose'), {
          fontFamily: FONT_STACK,
          fontSize: this.params.queenLeftEarly ? '40px' : '52px',
          color: '#ff8b57',
          stroke: '#000000',
          strokeThickness: 6,
          align: 'center',
          wordWrap: { width: 480 },
        })
        .setOrigin(0.5),
    )

    const bee = this.add.sprite(0, beeY, 'bee').setScale(1.15).setRotation(0.5)
    panel.add(bee)
    this.tweens.add({
      targets: bee,
      angle: bee.angle + 8,
      duration: juice.ui.failBeeWobbleMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    panel.add(
      this.add
        .text(0, beesLeftY, tp('result.beesLeft', this.params.beesLeft), {
          fontFamily: FONT_STACK,
          fontSize: '28px',
          color: colors.hudTextCss,
        })
        .setOrigin(0.5)
        .setAlpha(0.85),
    )

    // Opt-in revive: watch a rewarded ad, get moves back, continue this board.
    if (canRevive) {
      panel.add(
        makeButton(
          this,
          0,
          30,
          t('result.reviveAd', { n: ADS.rewardedExtraMoves }),
          () => void this.watchAdAndRevive(),
          { width: 460, height: 88, fontSize: 30, accent: colors.honey },
        ),
      )
    }

    const retryY = canRevive ? 138 : 96
    const menuY = canRevive ? 240 : 200
    panel.add(
      makeButton(this, 0, retryY, t('result.retry'), () => void this.goToLevel(this.params.levelIndex), {
        width: 400,
        height: canRevive ? 78 : 92,
        fontSize: canRevive ? 30 : 36,
        accent: theme.accent,
      }),
    )
    panel.add(
      makeButton(this, 0, menuY, t('result.menu'), () => void this.goMenu(), {
        width: 240,
        height: 60,
        fontSize: 24,
        primary: false,
      }),
    )

    this.tweens.add({
      targets: panel,
      y: GAME_HEIGHT / 2,
      alpha: 1,
      duration: juice.ui.panelSlideMs,
      ease: 'Back.easeOut',
    })
  }

  /**
   * Show the rewarded ad; on a real payout, drop the player straight back into
   * the board they lost with extra moves. If the ad fails or is skipped, the
   * fail screen simply stays put — nothing is taken away.
   */
  private async watchAdAndRevive(): Promise<void> {
    if (this.busy) return
    this.busy = true
    const rewarded = await adService.showRewarded()
    if (!rewarded) {
      this.busy = false
      return
    }
    const game = this.scene.get('Game') as GameScene
    game.reviveWithExtraMoves(ADS.rewardedExtraMoves)
    this.scene.stop()
    this.scene.resume('Game')
  }

  private async goToLevel(index: number): Promise<void> {
    if (this.busy) return
    this.busy = true
    await adService.maybeShowInterstitial(this.params.levelIndex + 1)
    this.scene.stop('Game')
    this.scene.start('Game', { levelIndex: index })
  }

  private async goMenu(): Promise<void> {
    if (this.busy) return
    this.busy = true
    await adService.maybeShowInterstitial(this.params.levelIndex + 1)
    this.scene.stop('Game')
    this.scene.start('Menu')
  }
}
