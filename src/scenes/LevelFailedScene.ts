import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT, colors } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { themeForChapter } from '../config/theme'
import { t, tp } from '../i18n'
import { makeButton, FONT_STACK } from '../utils/ui'

interface LevelFailedData {
  levelIndex: number
  chapter: number
  beesLeft: number
  queenLeftEarly?: boolean
}

export class LevelFailedScene extends Phaser.Scene {
  private params!: LevelFailedData

  constructor() {
    super('LevelFailed')
  }

  init(data: LevelFailedData): void {
    this.params = data
  }

  create(): void {
    const theme = themeForChapter(this.params.chapter)

    const backdrop = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, colors.dimBackdrop, 1)
      .setAlpha(0)
      .setInteractive()
    this.tweens.add({ targets: backdrop, alpha: juice.ui.backdropAlpha, duration: juice.ui.backdropFadeMs })

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60).setAlpha(0)

    const g = this.add.graphics()
    g.fillStyle(colors.panelDeep, 1)
    g.fillRoundedRect(-284, -264, 568, 528, 40)
    g.fillStyle(colors.panel, 1)
    g.fillRoundedRect(-280, -260, 560, 520, 36)
    g.lineStyle(4, theme.accent, 0.7)
    g.strokeRoundedRect(-280, -260, 560, 520, 36)
    panel.add(g)

    panel.add(
      this.add
        .text(0, -172, this.params.queenLeftEarly ? t('result.loseQueen') : t('result.lose'), {
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

    const bee = this.add.sprite(0, -52, 'bee').setScale(1.15).setRotation(0.5)
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
        .text(0, 44, tp('result.beesLeft', this.params.beesLeft), {
          fontFamily: FONT_STACK,
          fontSize: '28px',
          color: colors.hudTextCss,
        })
        .setOrigin(0.5)
        .setAlpha(0.85),
    )

    panel.add(
      makeButton(this, 0, 132, t('result.retry'), () => this.goToLevel(this.params.levelIndex), {
        width: 400,
        height: 92,
        fontSize: 36,
        accent: theme.accent,
      }),
    )
    panel.add(
      makeButton(this, 0, 222, t('result.menu'), () => this.goMenu(), {
        width: 240,
        height: 68,
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
