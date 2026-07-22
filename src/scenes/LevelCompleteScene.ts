import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT, colors } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { TEST_LEVELS } from '../levels'
import { t } from '../i18n'
import { makeButton, FONT_STACK } from '../utils/ui'

interface LevelCompleteData {
  levelIndex: number
  stars: number
  movesUsed: number
  budget: number
}

export class LevelCompleteScene extends Phaser.Scene {
  private params!: LevelCompleteData

  constructor() {
    super('LevelComplete')
  }

  init(data: LevelCompleteData): void {
    this.params = data
  }

  create(): void {
    const backdrop = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, colors.dimBackdrop, 1)
      .setAlpha(0)
      .setInteractive()
    this.tweens.add({ targets: backdrop, alpha: juice.ui.backdropAlpha, duration: juice.ui.backdropFadeMs })

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60).setAlpha(0)

    const g = this.add.graphics()
    g.fillStyle(colors.panel, 1)
    g.fillRoundedRect(-280, -320, 560, 640, 36)
    g.lineStyle(5, colors.panelStroke, 1)
    g.strokeRoundedRect(-280, -320, 560, 640, 36)
    panel.add(g)

    panel.add(
      this.add
        .text(0, -230, t('result.win'), {
          fontFamily: FONT_STACK,
          fontSize: '56px',
          color: '#ffd23f',
          stroke: '#33241a',
          strokeThickness: 8,
        })
        .setOrigin(0.5),
    )

    // Star slots, then earned stars slam in one by one
    const starXs = [-130, 0, 130]
    starXs.forEach((x) => {
      panel.add(this.add.star(x, -90, 5, 24, 50, colors.starEmpty).setOrigin(0.5))
    })
    for (let i = 0; i < this.params.stars; i++) {
      const star = this.add
        .star(starXs[i], -90, 5, 24, 50, colors.starGold)
        .setOrigin(0.5)
        .setScale(3)
        .setAlpha(0)
      panel.add(star)
      this.time.delayedCall(juice.ui.starBaseDelayMs + i * juice.ui.starStaggerMs, () => {
        this.tweens.add({
          targets: star,
          scale: 1,
          alpha: 1,
          duration: juice.ui.starSlamMs,
          ease: 'Cubic.easeIn',
          onComplete: () =>
            this.cameras.main.shake(juice.ui.starLandShakeMs, juice.ui.starLandShakeIntensity),
        })
      })
    }

    panel.add(
      this.add
        .text(0, 10, t('result.movesUsed', { used: this.params.movesUsed, budget: this.params.budget }), {
          fontFamily: FONT_STACK,
          fontSize: '28px',
          color: colors.hudTextCss,
        })
        .setOrigin(0.5),
    )

    const hasNext = this.params.levelIndex < TEST_LEVELS.length - 1
    const nextBtn = makeButton(
      this,
      0,
      120,
      hasNext ? t('result.next') : t('result.menu'),
      () => (hasNext ? this.goToLevel(this.params.levelIndex + 1) : this.goMenu()),
      { width: 400, height: 92, fontSize: 36 },
    )
    panel.add(nextBtn)

    panel.add(
      makeButton(this, -110, 235, t('result.replay'), () => this.goToLevel(this.params.levelIndex), {
        width: 200,
        height: 72,
        fontSize: 26,
        primary: false,
      }),
    )
    panel.add(
      makeButton(this, 110, 235, t('result.menu'), () => this.goMenu(), {
        width: 200,
        height: 72,
        fontSize: 26,
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

  private goToLevel(index: number): void {
    this.scene.stop('Game')
    this.scene.start('Game', { levelIndex: index })
  }

  private goMenu(): void {
    this.scene.stop('Game')
    this.scene.start('Menu')
  }
}
