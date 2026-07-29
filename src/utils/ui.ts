import Phaser from 'phaser'
import { colors } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { feedback } from '../systems/feedback'

export const FONT_STACK = '"Arial Rounded MT Bold", "Arial Black", "Helvetica Neue", Arial, sans-serif'

/**
 * A honey droplet glyph — the currency icon. Deliberately NOT a star: honey and
 * the level-rating stars used to share the same gold star, so a glance could not
 * tell "how much honey" from "how many stars". A teardrop in the in-game honey
 * ambers reads unmistakably as the currency.
 */
export function drawHoneyDrop(
  scene: Phaser.Scene,
  x: number,
  y: number,
  r: number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  // Outer (dark amber) teardrop: round bottom + pointed top, base width = 2r so
  // the triangle meets the circle flush at its widest point (no side bumps).
  g.fillStyle(0xc47a00, 1)
  g.fillCircle(x, y + r * 0.32, r)
  g.fillTriangle(x, y - r * 1.5, x - r, y + r * 0.32, x + r, y + r * 0.32)
  // Inner (bright amber) fill, slightly inset.
  g.fillStyle(0xf3a712, 1)
  g.fillCircle(x, y + r * 0.32, r * 0.82)
  g.fillTriangle(x, y - r * 1.12, x - r * 0.82, y + r * 0.32, x + r * 0.82, y + r * 0.32)
  // Gloss highlight.
  g.fillStyle(0xffe08a, 0.85)
  g.fillCircle(x - r * 0.3, y - r * 0.04, r * 0.26)
  return g
}

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
    feedback.unlock()
    feedback.tap()
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
/** Shared chrome for the round icon buttons: drop shadow, body, gloss, rim. */
function drawIconButtonBody(g: Phaser.GameObjects.Graphics, radius: number, accent?: number): void {
  g.fillStyle(0x000000, 0.3)
  g.fillCircle(0, 6, radius)
  g.fillStyle(colors.buttonSecondary, 1)
  g.fillCircle(0, 0, radius)
  // Gloss: a soft highlight in the upper half reads as a raised surface.
  g.fillStyle(0xffffff, 0.12)
  g.fillCircle(0, -radius * 0.34, radius * 0.74)
  g.lineStyle(2, accent ?? 0xffffff, accent ? 0.55 : 0.16)
  g.strokeCircle(0, 0, radius - 1)
}

export function makeIconButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  glyph: string,
  onTap: () => void,
  radius = 34,
  accent?: number,
): Phaser.GameObjects.Container {
  const g = scene.add.graphics()
  drawIconButtonBody(g, radius, accent)

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
  container.on('pointerdown', () => {
    feedback.unlock()
    feedback.tap()
    scene.tweens.add({ targets: container, scale: 0.9, duration: 60 })
  })
  container.on('pointerup', () => {
    scene.tweens.add({ targets: container, scale: 1, duration: 60 })
    onTap()
  })
  container.on('pointerout', () => scene.tweens.add({ targets: container, scale: 1, duration: 60 }))
  return container
}

/**
 * Restart button. The icon is drawn rather than typed: the "↻" glyph renders
 * inconsistently across iOS font fallbacks (and sat visibly off-centre on
 * device), whereas an arc plus a triangular head is identical everywhere and
 * can spin on press.
 */
export function makeRestartButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onTap: () => void,
  radius = 34,
  accent = 0xffc94d,
): Phaser.GameObjects.Container {
  const g = scene.add.graphics()
  drawIconButtonBody(g, radius, accent)

  // The rotating part lives in its own graphics so the body stays put.
  const icon = scene.add.graphics()
  const r = radius * 0.46
  icon.lineStyle(Math.max(3, radius * 0.11), 0xffffff, 0.95)
  // Open arc, leaving a gap where the arrow head goes.
  icon.beginPath()
  icon.arc(0, 0, r, Phaser.Math.DegToRad(-40), Phaser.Math.DegToRad(230), false)
  icon.strokePath()
  // Arrow head at the arc's open end, pointing along the sweep.
  const headAngle = Phaser.Math.DegToRad(-40)
  const hx = Math.cos(headAngle) * r
  const hy = Math.sin(headAngle) * r
  const s = radius * 0.2
  icon.fillStyle(0xffffff, 0.95)
  icon.fillTriangle(hx + s, hy, hx - s * 0.45, hy - s * 0.9, hx - s * 0.45, hy + s * 0.9)

  const container = scene.add.container(x, y, [g, icon])
  container.setSize(radius * 2, radius * 2)
  container.setInteractive({ useHandCursor: true })
  container.on('pointerdown', () => {
    feedback.unlock()
    feedback.tap()
    scene.tweens.add({ targets: container, scale: 0.9, duration: 60 })
  })
  container.on('pointerup', () => {
    scene.tweens.add({ targets: container, scale: 1, duration: 60 })
    // Spin the icon so the restart reads as an action, not just a tap.
    icon.angle = 0
    scene.tweens.add({ targets: icon, angle: 360, duration: 420, ease: 'Cubic.easeOut' })
    onTap()
  })
  container.on('pointerout', () => scene.tweens.add({ targets: container, scale: 1, duration: 60 }))
  return container
}
