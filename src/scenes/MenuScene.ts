import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT, colors } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { TEST_LEVELS } from '../levels'
import { t } from '../i18n'
import { makeButton, FONT_STACK } from '../utils/ui'

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu')
  }

  create(): void {
    this.cameras.main.setBackgroundColor(colors.background)

    this.add
      .text(GAME_WIDTH / 2, 190, t('app.title'), {
        fontFamily: FONT_STACK,
        fontSize: '104px',
        color: '#ffd23f',
        stroke: '#33241a',
        strokeThickness: 12,
      })
      .setOrigin(0.5)

    this.add
      .text(GAME_WIDTH / 2, 272, t('app.subtitle'), {
        fontFamily: FONT_STACK,
        fontSize: '38px',
        color: colors.hudTextCss,
      })
      .setOrigin(0.5)

    this.add
      .text(GAME_WIDTH / 2, 336, t('menu.tagline'), {
        fontFamily: FONT_STACK,
        fontSize: '22px',
        color: colors.hudTextCss,
        align: 'center',
        wordWrap: { width: 560 },
      })
      .setOrigin(0.5)
      .setAlpha(0.7)

    const bee = this.add.sprite(GAME_WIDTH / 2, 470, 'bee').setScale(1.4).setRotation(-0.35)
    this.tweens.add({
      targets: bee,
      y: 452,
      duration: juice.ui.menuBeeBobMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    TEST_LEVELS.forEach((level, i) => {
      makeButton(
        this,
        GAME_WIDTH / 2,
        640 + i * 104,
        t('menu.level', { n: level.id }),
        () => this.scene.start('Game', { levelIndex: i }),
        { width: 420, height: 84, fontSize: 32 },
      )
    })

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 40, t('version.label', { version: '0.1.0' }), {
        fontFamily: FONT_STACK,
        fontSize: '18px',
        color: colors.hudTextCss,
      })
      .setOrigin(0.5)
      .setAlpha(0.45)
  }
}
