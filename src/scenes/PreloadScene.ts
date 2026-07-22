import Phaser from 'phaser'
import { colors } from '../config/gameConfig'

/**
 * M1 ships zero binary assets: every texture is generated here so the game is
 * playable before Meshy/fal.ai art lands. Final art replaces these via the
 * asset manifest (spec §11) with no gameplay-code changes — scenes only ever
 * reference texture keys ('cell', 'bee', 'dot').
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload')
  }

  create(): void {
    this.makeCellTexture()
    this.makeBeeTexture()
    this.makeDotTexture()
    this.scene.start('Menu')
  }

  /** Pointy-top hexagon vertices (vertex at 12 o'clock). */
  private hexPoints(cx: number, cy: number, radius: number): Phaser.Types.Math.Vector2Like[] {
    const pts: Phaser.Types.Math.Vector2Like[] = []
    for (let i = 0; i < 6; i++) {
      const angle = Phaser.Math.DegToRad(60 * i - 90)
      pts.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
    }
    return pts
  }

  private makeCellTexture(): void {
    const g = this.make.graphics({}, false)
    const outer = this.hexPoints(64, 64, 60)
    const inner = this.hexPoints(64, 64, 50)
    g.fillStyle(colors.cellFill, 1)
    g.fillPoints(outer, true)
    g.lineStyle(5, colors.cellStroke, 1)
    g.strokePoints(outer, true, true)
    g.lineStyle(2, colors.cellHighlight, 0.14)
    g.strokePoints(inner, true, true)
    g.generateTexture('cell', 128, 128)
    g.destroy()
  }

  /**
   * Top-down bee facing East (dir0) in a 128×128 frame; the sprite is rotated
   * in -60° steps for the other five directions. Final assets instead ship six
   * pre-rendered directions per the asset contract.
   */
  private makeBeeTexture(): void {
    const g = this.make.graphics({}, false)

    // Wings (top-down view: one each side of the body)
    g.fillStyle(colors.beeWing, 0.8)
    g.fillEllipse(48, 40, 36, 24)
    g.fillEllipse(48, 88, 36, 24)
    g.lineStyle(3, colors.beeDark, 0.35)
    g.strokeEllipse(48, 40, 36, 24)
    g.strokeEllipse(48, 88, 36, 24)

    // Stinger at the back
    g.fillStyle(colors.beeDark, 1)
    g.fillTriangle(12, 64, 28, 55, 28, 73)

    // Body
    g.fillStyle(colors.beeBody, 1)
    g.fillEllipse(60, 64, 76, 52)

    // Stripes (widths clamped to the ellipse chord so corners stay inside)
    g.fillStyle(colors.beeDark, 1)
    g.fillRect(38, 43, 11, 42)
    g.fillRect(54, 40, 11, 48)

    // Body outline over stripe edges
    g.lineStyle(5, colors.beeDark, 1)
    g.strokeEllipse(60, 64, 76, 52)

    // Head with eyes at the front
    g.fillStyle(colors.beeDark, 1)
    g.fillCircle(98, 64, 15)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(103, 58, 3.5)
    g.fillCircle(103, 70, 3.5)

    // Direction arrow — the readability-critical element (shape-based, colorblind-safe)
    g.fillStyle(colors.arrow, 1)
    g.fillTriangle(66, 52, 66, 76, 88, 64)
    g.lineStyle(4, colors.beeDark, 1)
    g.strokeTriangle(66, 52, 66, 76, 88, 64)

    g.generateTexture('bee', 128, 128)
    g.destroy()
  }

  /** Single white dot, tinted per use (honey trail, escape burst, dust puff). */
  private makeDotTexture(): void {
    const g = this.make.graphics({}, false)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(8, 8, 7)
    g.generateTexture('dot', 16, 16)
    g.destroy()
  }
}
