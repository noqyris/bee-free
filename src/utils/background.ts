import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT } from '../config/gameConfig'
import { SQRT3 } from '../systems/HexGrid'
import type { ChapterTheme } from '../config/theme'

/**
 * Themed background: a vertical gradient plus a faint honeycomb of hex outlines
 * drawn with the real hex-tiling math (no texture, so no tiling seams). Callers
 * hold the handle to retint on a chapter change without rebuilding the scene.
 */
export interface Background {
  retint(theme: ChapterTheme): void
}

const COMB_SIZE = 48

function strokeHex(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
  const pts: Phaser.Types.Math.Vector2Like[] = []
  for (let i = 0; i < 6; i++) {
    const a = Phaser.Math.DegToRad(60 * i - 90)
    pts.push({ x: cx + s * Math.cos(a), y: cy + s * Math.sin(a) })
  }
  g.strokePoints(pts, true, true)
}

export function paintBackground(scene: Phaser.Scene, theme: ChapterTheme): Background {
  const grad = scene.add.graphics().setDepth(-100)
  const comb = scene.add.graphics().setDepth(-99)

  const render = (th: ChapterTheme) => {
    grad.clear()
    grad.fillGradientStyle(th.bgTop, th.bgTop, th.bgBottom, th.bgBottom, 1)
    grad.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

    comb.clear()
    comb.lineStyle(2, 0xffffff, 0.05)
    const dx = SQRT3 * COMB_SIZE
    const dy = 1.5 * COMB_SIZE
    let row = 0
    for (let y = -dy; y < GAME_HEIGHT + dy; y += dy, row++) {
      const offset = (row % 2) * (dx / 2)
      for (let x = -dx; x < GAME_WIDTH + dx; x += dx) {
        strokeHex(comb, x + offset, y, COMB_SIZE)
      }
    }
  }

  render(theme)
  return { retint: render }
}
