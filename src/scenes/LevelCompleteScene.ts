import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT, colors } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { LEVEL_COUNT } from '../levels'
import { themeForChapter } from '../config/theme'
import { t } from '../i18n'
import { makeButton, FONT_STACK } from '../utils/ui'

interface LevelCompleteData {
  levelIndex: number
  chapter: number
  stars: number
  honey: number
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
    const theme = themeForChapter(this.params.chapter)

    const backdrop = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, colors.dimBackdrop, 1)
      .setAlpha(0)
      .setInteractive()
    this.tweens.add({ targets: backdrop, alpha: juice.ui.backdropAlpha, duration: juice.ui.backdropFadeMs })

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60).setAlpha(0)

    const g = this.add.graphics()
    g.fillStyle(colors.panelDeep, 1)
    g.fillRoundedRect(-284, -324, 568, 648, 40)
    g.fillStyle(colors.panel, 1)
    g.fillRoundedRect(-280, -320, 560, 640, 36)
    g.lineStyle(4, theme.accent, 0.9)
    g.strokeRoundedRect(-280, -320, 560, 640, 36)
    panel.add(g)

    panel.add(
      this.add
        .text(0, -238, t('result.win'), {
          fontFamily: FONT_STACK,
          fontSize: '58px',
          color: theme.accentCss,
          stroke: '#000000',
          strokeThickness: 6,
        })
        .setOrigin(0.5),
    )

    // Star slots, then earned stars slam in one by one.
    const starXs = [-132, 0, 132]
    const starY = -110
    starXs.forEach((x, i) => {
      panel.add(this.add.star(x, starY + (i === 1 ? -14 : 0), 5, 26, 54, colors.starEmpty).setOrigin(0.5))
    })
    for (let i = 0; i < this.params.stars; i++) {
      const yBase = starY + (i === 1 ? -14 : 0)
      const star = this.add
        .star(starXs[i], yBase, 5, 26, 54, colors.starGold)
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
        .text(0, -6, t('result.movesUsed', { used: this.params.movesUsed, budget: this.params.budget }), {
          fontFamily: FONT_STACK,
          fontSize: '26px',
          color: colors.hudTextCss,
        })
        .setOrigin(0.5)
        .setAlpha(0.85),
    )

    // Honey reward line
    const honey = this.add.container(0, 48)
    honey.add(this.add.star(-38, 0, 5, 10, 20, colors.honey).setOrigin(0.5))
    honey.add(
      this.add
        .text(-14, 0, t('result.honey', { n: this.params.honey }), {
          fontFamily: FONT_STACK,
          fontSize: '32px',
          color: colors.honeyCss,
        })
        .setOrigin(0, 0.5),
    )
    panel.add(honey)

    const hasNext = this.params.levelIndex < LEVEL_COUNT - 1
    panel.add(
      makeButton(
        this,
        0,
        140,
        hasNext ? t('result.next') : t('result.menu'),
        () => (hasNext ? this.goToLevel(this.params.levelIndex + 1) : this.goMenu()),
        { width: 400, height: 92, fontSize: 36, accent: theme.accent },
      ),
    )

    panel.add(
      makeButton(this, -110, 250, t('result.replay'), () => this.goToLevel(this.params.levelIndex), {
        width: 200,
        height: 72,
        fontSize: 26,
        primary: false,
      }),
    )
    panel.add(
      makeButton(this, 110, 250, t('result.menu'), () => this.goMenu(), {
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
