import Phaser from 'phaser'
import { colors } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'

export const FONT_STACK = '"Arial Rounded MT Bold", "Arial Black", "Helvetica Neue", Arial, sans-serif'

export interface ButtonOptions {
  width: number
  height: number
  fontSize?: number
  primary?: boolean
  /** Fill for primary buttons; defaults to a warm amber. */
  accent?: number
}

/**
 * Modern rounded button: soft drop shadow, flat fill with a top gloss band and
 * a subtle inner border, bold label. Drawn programmatically (placeholder UI
 * that final art can replace via 9-slice later). Press = scale + sink feedback.
 */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onTap: () => void,
  opts: ButtonOptions,
): Phaser.GameObjects.Container {
  const { width, height, fontSize = 34, primary = true, accent = 0xffb020 } = opts
  const radius = Math.min(26, height / 2)
  const fill = primary ? accent : colors.buttonSecondary
  const textColor = primary ? colors.buttonTextCss : colors.buttonSecondaryTextCss

  const g = scene.add.graphics()
  // Drop shadow
  g.fillStyle(0x000000, 0.32)
  g.fillRoundedRect(-width / 2, -height / 2 + 7, width, height, radius)
  // Base fill
  g.fillStyle(fill, 1)
  g.fillRoundedRect(-width / 2, -height / 2, width, height, radius)
  // Top gloss band
  g.fillStyle(0xffffff, primary ? 0.22 : 0.12)
  g.fillRoundedRect(-width / 2 + 5, -height / 2 + 5, width - 10, height * 0.42, radius - 4)
  // Inner border
  g.lineStyle(2, 0x000000, 0.16)
  g.strokeRoundedRect(-width / 2, -height / 2, width, height, radius)

  const text = scene.add
    .text(0, 0, label, {
      fontFamily: FONT_STACK,
      fontSize: `${fontSize}px`,
      color: textColor,
    })
    .setOrigin(0.5)

  const container = scene.add.container(x, y, [g, text])
  container.setSize(width, height)
  container.setInteractive({ useHandCursor: true })

  let pressed = false
  const press = () => {
    pressed = true
    scene.tweens.add({
      targets: container,
      scaleX: juice.ui.buttonPressScale,
      scaleY: juice.ui.buttonPressScale,
      duration: juice.ui.buttonPressMs,
    })
  }
  const release = (fire: boolean) => {
    if (!pressed) return
    pressed = false
    scene.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: juice.ui.buttonPressMs })
    if (fire) onTap()
  }
  container.on('pointerdown', press)
  container.on('pointerout', () => release(false))
  container.on('pointerup', () => release(true))

  return container
}

/** Circular icon button (back, restart, etc.). */
export function makeIconButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  glyph: string,
  onTap: () => void,
  radius = 34,
): Phaser.GameObjects.Container {
  const g = scene.add.graphics()
  g.fillStyle(0x000000, 0.28)
  g.fillCircle(0, 5, radius)
  g.fillStyle(colors.buttonSecondary, 1)
  g.fillCircle(0, 0, radius)
  g.fillStyle(0xffffff, 0.1)
  g.fillCircle(0, -radius * 0.35, radius * 0.72)

  const text = scene.add
    .text(0, -1, glyph, {
      fontFamily: FONT_STACK,
      fontSize: `${radius * 1.1}px`,
      color: colors.buttonSecondaryTextCss,
    })
    .setOrigin(0.5)

  const container = scene.add.container(x, y, [g, text])
  // Square hit area from the container size — the reliable container-input path
  // (custom Geom hit areas on containers don't register taps consistently).
  container.setSize(radius * 2, radius * 2)
  container.setInteractive({ useHandCursor: true })
  container.on('pointerdown', () =>
    scene.tweens.add({ targets: container, scale: 0.9, duration: 60 }),
  )
  container.on('pointerup', () => {
    scene.tweens.add({ targets: container, scale: 1, duration: 60 })
    onTap()
  })
  container.on('pointerout', () => scene.tweens.add({ targets: container, scale: 1, duration: 60 }))
  return container
}
