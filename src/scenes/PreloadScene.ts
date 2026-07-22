import Phaser from 'phaser'
import { colors } from '../config/gameConfig'

/**
 * M1/M2 ship zero binary assets: every texture is generated here so the game is
 * playable before Meshy/fal.ai art lands. Final art replaces these via the
 * asset manifest (spec §11) with no gameplay-code changes — scenes only ever
 * reference texture keys ('hex', 'bee', 'dot'). 'hex' is drawn white and tinted
 * per chapter theme at draw time.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload')
  }

  create(): void {
    this.makeHexTexture()
    this.makeBeeVariant('bee', colors.beeBody)
    this.makeBeeVariant('beeQueen', 0xff8fc0) // rose body = royalty, reads distinct
    this.makeHornetTexture()
    this.makeCrownTexture()
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

  /** Solid white pointy-top hexagon; tinted per chapter where used. */
  private makeHexTexture(): void {
    const g = this.make.graphics({}, false)
    g.fillStyle(0xffffff, 1)
    g.fillPoints(this.hexPoints(64, 64, 62), true)
    g.generateTexture('hex', 128, 128)
    g.destroy()
  }

  /**
   * Top-down bee facing East (dir0) in a 128×128 frame; rotated in -60° steps
   * for the other five directions. `bodyColor` distinguishes workers (yellow)
   * from the queen (rose). Final assets ship six pre-rendered directions.
   */
  private makeBeeVariant(key: string, bodyColor: number): void {
    const g = this.make.graphics({}, false)

    g.fillStyle(colors.beeWing, 0.85)
    g.fillEllipse(48, 40, 36, 24)
    g.fillEllipse(48, 88, 36, 24)
    g.lineStyle(3, colors.beeDark, 0.35)
    g.strokeEllipse(48, 40, 36, 24)
    g.strokeEllipse(48, 88, 36, 24)

    g.fillStyle(colors.beeDark, 1)
    g.fillTriangle(12, 64, 28, 55, 28, 73)

    g.fillStyle(bodyColor, 1)
    g.fillEllipse(60, 64, 76, 52)

    g.fillStyle(colors.beeDark, 1)
    g.fillRect(38, 43, 11, 42)
    g.fillRect(54, 40, 11, 48)

    g.lineStyle(5, colors.beeDark, 1)
    g.strokeEllipse(60, 64, 76, 52)

    g.fillStyle(colors.beeDark, 1)
    g.fillCircle(98, 64, 15)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(103, 58, 3.5)
    g.fillCircle(103, 70, 3.5)

    // Direction arrow — readability-critical, shape-based (colorblind-safe).
    // A big bold white chevron+shaft pointing East (dir0) so which way a bee
    // will fly is unmistakable at a glance.
    g.fillStyle(colors.arrow, 1)
    g.lineStyle(5, colors.beeDark, 1)
    // shaft
    g.fillRect(40, 58, 34, 12)
    g.strokeRect(40, 58, 34, 12)
    // arrowhead
    g.fillTriangle(70, 44, 70, 84, 100, 64)
    g.strokeTriangle(70, 44, 70, 84, 100, 64)

    g.generateTexture(key, 128, 128)
    g.destroy()
  }

  /**
   * A hornet: a menacing, static blocker. Deliberately a different silhouette
   * from the bee (dark red, angular wings, angry eyes, NO direction arrow) so
   * players read it as "wall, can't move" instantly.
   */
  private makeHornetTexture(): void {
    const g = this.make.graphics({}, false)
    const bodyDark = 0x3a0f0f
    const bodyRed = 0x8f2b1c

    // Angular wings
    g.fillStyle(0x6a6a72, 0.85)
    g.fillTriangle(52, 20, 90, 44, 40, 50)
    g.fillTriangle(52, 108, 90, 84, 40, 78)
    g.lineStyle(3, bodyDark, 0.6)
    g.strokeTriangle(52, 20, 90, 44, 40, 50)
    g.strokeTriangle(52, 108, 90, 84, 40, 78)

    // Stinger
    g.fillStyle(bodyDark, 1)
    g.fillTriangle(10, 64, 30, 54, 30, 74)

    // Body
    g.fillStyle(bodyRed, 1)
    g.fillEllipse(62, 64, 78, 54)
    g.fillStyle(bodyDark, 1)
    g.fillRect(48, 40, 10, 48)
    g.fillRect(66, 40, 10, 48)
    g.lineStyle(5, 0x1a0808, 1)
    g.strokeEllipse(62, 64, 78, 54)

    // Head + angry eyes
    g.fillStyle(bodyDark, 1)
    g.fillCircle(100, 64, 16)
    g.fillStyle(0xff5a3c, 1)
    g.fillTriangle(96, 56, 108, 60, 98, 64)
    g.fillTriangle(96, 72, 108, 68, 98, 64)

    g.generateTexture('hornet', 128, 128)
    g.destroy()
  }

  /** Small gold crown, overlaid on the queen's head. */
  private makeCrownTexture(): void {
    const g = this.make.graphics({}, false)
    g.fillStyle(0xffd23f, 1)
    g.lineStyle(3, 0x8a5a00, 1)
    // Crown band + three points
    g.beginPath()
    g.moveTo(6, 40)
    g.lineTo(12, 14)
    g.lineTo(24, 30)
    g.lineTo(32, 8)
    g.lineTo(40, 30)
    g.lineTo(52, 14)
    g.lineTo(58, 40)
    g.closePath()
    g.fillPath()
    g.strokePath()
    // Gems
    g.fillStyle(0xff5a8a, 1)
    g.fillCircle(32, 30, 4)
    g.fillStyle(0x5ad1ff, 1)
    g.fillCircle(18, 34, 3)
    g.fillCircle(46, 34, 3)
    g.generateTexture('crown', 64, 48)
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
