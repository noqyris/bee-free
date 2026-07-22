import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT, colors } from './config/gameConfig'
import { BootScene } from './scenes/BootScene'
import { PreloadScene } from './scenes/PreloadScene'
import { MenuScene } from './scenes/MenuScene'
import { GameScene } from './scenes/GameScene'
import { LevelCompleteScene } from './scenes/LevelCompleteScene'
import { LevelFailedScene } from './scenes/LevelFailedScene'

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: colors.backgroundDeep,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  scene: [BootScene, PreloadScene, MenuScene, GameScene, LevelCompleteScene, LevelFailedScene],
})
