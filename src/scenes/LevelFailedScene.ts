import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT, colors } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { ADS } from '../config/monetization'
import { MOVES_POWERUP_AMOUNT } from '../config/powerups'
import { themeForChapter } from '../config/theme'
import { t, tp } from '../i18n'
import { adService } from '../systems/AdService'
import { saveManager } from '../systems/SaveManager'
import { makeButton, ensureFlameTexture, FONT_STACK } from '../utils/ui'
import { feedback } from '../systems/feedback'
import type { GameScene } from './GameScene'

interface LevelFailedData {
  levelIndex: number
  /** 'compass' keeps retry/next inside the Compass Hive ladder. */
  mode?: 'compass'
  chapter: number
  beesLeft: number
  queenLeftEarly?: boolean
}

export class LevelFailedScene extends Phaser.Scene {
  private params!: LevelFailedData
  private busy = false
  private reviveBtn?: Phaser.GameObjects.Container
  private adPoll?: Phaser.Time.TimerEvent

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
    // offer revives (ad OR owned +3 Moves) when the player simply ran out.
    const outOfMoves = !this.params.queenLeftEarly
    const canUseMoves = outOfMoves && saveManager.powerupCount('moves') > 0
    const adSlot = outOfMoves // the ad button lives here; visibility tracks readiness

    const backdrop = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, colors.dimBackdrop, 1)
      .setAlpha(0)
      .setInteractive()
    this.tweens.add({ targets: backdrop, alpha: juice.ui.backdropAlpha, duration: juice.ui.backdropFadeMs })

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60).setAlpha(0)

    // Panel height is content-driven so the buttons always sit INSIDE it, with
    // the lowest button's shadow ≥ 20px clear of the rim.
    const reviveRows = (adSlot ? 1 : 0) + (canUseMoves ? 1 : 0)
    const half = 268 + reviveRows * 44
    const g = this.add.graphics()
    g.fillStyle(colors.panelDeep, 1)
    g.fillRoundedRect(-284, -half - 4, 568, (half + 4) * 2, 40)
    g.fillStyle(colors.panel, 1)
    g.fillRoundedRect(-280, -half, 560, half * 2, 36)
    g.lineStyle(4, theme.accent, 0.7)
    g.strokeRoundedRect(-280, -half, 560, half * 2, 36)
    panel.add(g)

    const titleY = -half + 64
    const beeY = titleY + 96
    const beesLeftY = beeY + 64

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

    // The revive is a "save your streak" moment — say what is at stake.
    if (outOfMoves && saveManager.winStreak >= 2) {
      const stake = this.add.container(0, beesLeftY + 44)
      const label = this.add
        .text(0, 0, t('result.streakAtRisk', { n: saveManager.winStreak }), {
          fontFamily: FONT_STACK,
          fontSize: '21px',
          color: '#ffb35c',
        })
        .setOrigin(0, 0.5)
      const cluster = 34 + label.width
      label.setX(-cluster / 2 + 34)
      stake.add(this.add.image(-cluster / 2 + 14, -2, ensureFlameTexture(this, 34)))
      stake.add(label)
      panel.add(stake)
      this.tweens.add({ targets: stake, scale: 1.04, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    }

    let y = beesLeftY + 84

    // A player who OWNS "+3 Moves" gets to use one at the exact moment it is
    // for — instead of the power-up only working preemptively. Same 1-star cap
    // as the ad revive: assisted wins never score perfect.
    if (canUseMoves) {
      panel.add(
        makeButton(
          this,
          0,
          y,
          t('result.useMovesPowerup', { n: saveManager.powerupCount('moves') }),
          () => this.useMovesAndRevive(),
          { width: 460, height: 78, fontSize: 27, accent: theme.accent },
        ),
      )
      y += 92
    }

    // Opt-in revive: watch a rewarded ad, get moves back, continue this board.
    // The button is created regardless and its visibility POLLS readiness —
    // rewarded ads load asynchronously, and a second quick fail used to lose
    // the offer entirely just because the next ad was still loading. While the
    // ad is NOT ready, Try Again / Menu slide UP into its row so the panel
    // never shows a hole where a button should be.
    let retryBtn: Phaser.GameObjects.Container
    let menuBtn: Phaser.GameObjects.Container
    const layoutRows = (adVisible: boolean, animate: boolean): void => {
      const base = adVisible ? y + 92 : y
      const retryY = base
      const menuY = base + 92
      if (!animate) {
        retryBtn.setY(retryY)
        menuBtn.setY(menuY)
        return
      }
      this.tweens.add({ targets: retryBtn, y: retryY, duration: 180, ease: 'Quad.easeOut' })
      this.tweens.add({ targets: menuBtn, y: menuY, duration: 180, ease: 'Quad.easeOut' })
    }

    if (adSlot) {
      this.reviveBtn = makeButton(
        this,
        0,
        y,
        t('result.reviveAd', { n: ADS.rewardedExtraMoves }),
        () => void this.watchAdAndRevive(),
        { width: 460, height: 78, fontSize: 27, accent: colors.honey },
      )
      panel.add(this.reviveBtn)
    }

    retryBtn = makeButton(this, 0, y, t('result.retry'), () => void this.goToLevel(this.params.levelIndex), {
      width: 400,
      height: 78,
      fontSize: 30,
      accent: theme.accent,
    })
    panel.add(retryBtn)
    menuBtn = makeButton(this, 0, y + 92, t('result.menu'), () => void this.goMenu(), {
      width: 240,
      height: 60,
      fontSize: 24,
      primary: false,
    })
    panel.add(menuBtn)

    if (adSlot && this.reviveBtn) {
      let adVisible = adService.canOfferRewarded()
      this.reviveBtn.setVisible(adVisible)
      layoutRows(adVisible, false)
      this.adPoll = this.time.addEvent({
        delay: 500,
        loop: true,
        callback: () => {
          const ready = adService.canOfferRewarded()
          if (ready === adVisible) return
          adVisible = ready
          this.reviveBtn?.setVisible(ready)
          layoutRows(ready, true)
        },
      })
    } else {
      layoutRows(false, false)
    }

    this.tweens.add({
      targets: panel,
      y: GAME_HEIGHT / 2,
      alpha: 1,
      duration: juice.ui.panelSlideMs,
      ease: 'Back.easeOut',
    })

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.adPoll?.remove()
      this.adPoll = undefined
    })
  }

  /** Consume an owned +3 Moves and put the player straight back on the board. */
  private useMovesAndRevive(): void {
    if (this.busy) return
    this.busy = true
    if (!saveManager.usePowerup('moves')) {
      this.busy = false
      return
    }
    feedback.escape(1)
    this.resumeGameWithMoves(MOVES_POWERUP_AMOUNT)
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
    if (!this.scene.isActive('LevelFailed')) return
    if (!rewarded) {
      this.busy = false
      return
    }
    this.resumeGameWithMoves(ADS.rewardedExtraMoves)
  }

  private resumeGameWithMoves(extra: number): void {
    const game = this.scene.get('Game') as GameScene
    game.reviveWithExtraMoves(extra)
    this.scene.stop()
    this.scene.resume('Game')
  }

  private async goToLevel(index: number): Promise<void> {
    if (this.busy) return
    this.busy = true
    // Giving up (not reviving) is what breaks the win streak.
    saveManager.breakWinStreak()
    // Deliberately NO interstitial here: this is the retry-after-a-loss path,
    // the point of maximum frustration. The cadence still fires on wins and on
    // leaving to the menu.
    this.scene.stop('Game')
    this.scene.start('Game', { levelIndex: index, mode: this.params.mode })
  }

  private async goMenu(): Promise<void> {
    if (this.busy) return
    this.busy = true
    saveManager.breakWinStreak()
    await adService.maybeShowInterstitial(this.params.levelIndex + 1)
    this.scene.stop('Game')
    this.scene.start('Menu')
  }
}
