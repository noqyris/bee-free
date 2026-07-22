import Phaser from 'phaser'
import { colors } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'

export interface ButtonOptions {
  width: number
  height: number
  fontSize?: number
  primary?: boolean
}

/** Rounded-rect button with press feedback, drawn programmatically (placeholder UI). */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onTap: () => void,
  opts: ButtonOptions,
): Phaser.GameObjects.Container {
  const { width, height, fontSize = 34, primary = true } = opts
  const radius = Math.min(22, height / 2 - 2)
  const fill = primary ? colors.buttonPrimary : colors.buttonSecondary
  const textColor = primary ? colors.buttonTextCss : colors.buttonSecondaryTextCss

  const g = scene.add.graphics()
  g.fillStyle(0x000000, 0.35)
  g.fillRoundedRect(-width / 2, -height / 2 + 6, width, height, radius)
  g.fillStyle(fill, 1)
  g.fillRoundedRect(-width / 2, -height / 2, width, height, radius)
  g.lineStyle(3, 0x000000, 0.18)
  g.strokeRoundedRect(-width / 2, -height / 2, width, height, radius)

  const text = scene.add
    .text(0, 0, label, {
      fontFamily: '"Arial Black", "Helvetica Neue", Arial, sans-serif',
      fontSize: `${fontSize}px`,
      color: textColor,
    })
    .setOrigin(0.5)

  const container = scene.add.container(x, y, [g, text])
  container.setSize(width, height)
  container.setInteractive({ useHandCursor: true })

  let pressed = false
  container.on('pointerdown', () => {
    pressed = true
    scene.tweens.add({
      targets: container,
      scale: juice.ui.buttonPressScale,
      duration: juice.ui.buttonPressMs,
    })
  })
  container.on('pointerout', () => {
    pressed = false
    scene.tweens.add({ targets: container, scale: 1, duration: juice.ui.buttonPressMs })
  })
  container.on('pointerup', () => {
    if (!pressed) return
    pressed = false
    scene.tweens.add({ targets: container, scale: 1, duration: juice.ui.buttonPressMs })
    onTap()
  })

  return container
}

export const FONT_STACK = '"Arial Black", "Helvetica Neue", Arial, sans-serif'
