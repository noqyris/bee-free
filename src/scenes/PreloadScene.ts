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

  preload(): void {
    // The one shipped bitmap: the home-screen wordmark art. Everything else is
    // still drawn at runtime. base './' keeps this resolvable from Capacitor's
    // file:// webview, same as the bundle.
    this.load.image('logo', 'logo.png')
  }

  create(): void {
    this.makeHexTexture()
    this.makeBeeVariant('bee', colors.beeBody)
    this.makeBeeVariant('beeQueen', 0xff8fc0) // rose body = royalty, reads distinct
    this.makeHornetTexture()
    this.makeCrownTexture()
    this.makeHoneyTexture()
    this.makeDotTexture()
    this.scene.start('Home')
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
   * A blocker: a permanent, immovable wall filling its cell. Drawn as a cold
   * grey STONE BLOCK with brick seams and corner rivets — deliberately not a
   * bee (round + yellow) and not honey (glossy amber), and with NO arrows or
   * chevrons, which on the old hornet read as a flight direction.
   */
  private makeHornetTexture(): void {
    const g = this.make.graphics({}, false)
    const stone = 0x6b7280
    const stoneDark = 0x3a4049
    const stoneLight = 0x8a919c
    const edge = 0x20242b
    const seam = 0x2c313a

    // Solid stone hexagon (pointy-top), heavy dark rim, a lighter top bevel so
    // it reads as a raised, chunky block rather than a flat tile.
    const shellPts = this.hexPoints(64, 64, 56)
    g.fillStyle(stoneDark, 1)
    g.fillPoints(this.hexPoints(66, 68, 56), true) // drop shadow
    g.fillStyle(stone, 1)
    g.fillPoints(shellPts, true)
    g.fillStyle(stoneLight, 0.5)
    g.fillEllipse(64, 42, 70, 26) // top sheen
    g.lineStyle(7, edge, 1)
    g.strokePoints(shellPts, true, true)

    // Brick seams — offset rows, the universal "wall" cue. Clipped visually by
    // the rim; drawn straight since the block is small on screen.
    g.lineStyle(4, seam, 1)
    g.beginPath()
    g.moveTo(20, 50); g.lineTo(108, 50) // top course
    g.moveTo(20, 78); g.lineTo(108, 78) // bottom course
    g.moveTo(64, 30); g.lineTo(64, 50) // vertical joints, offset per row
    g.moveTo(44, 50); g.lineTo(44, 78)
    g.moveTo(84, 50); g.lineTo(84, 78)
    g.moveTo(64, 78); g.lineTo(64, 98)
    g.strokePath()

    // Corner rivets = bolted in place, cannot move.
    g.fillStyle(stoneDark, 1)
    for (const p of this.hexPoints(64, 64, 44)) g.fillCircle(p.x, p.y, 4)
    g.fillStyle(stoneLight, 0.8)
    for (const p of this.hexPoints(64, 64, 44)) g.fillCircle(p.x - 1, p.y - 1, 1.6)

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

  /** A glossy amber honey pool that fills a cell — visibly sticky. */
  private makeHoneyTexture(): void {
    const g = this.make.graphics({}, false)
    const amber = 0xf3a712
    const amberDark = 0xc47a00
    const pts = this.hexPoints(64, 64, 56)
    g.fillStyle(amberDark, 1)
    g.fillPoints(pts, true)
    g.fillStyle(amber, 1)
    g.fillPoints(this.hexPoints(64, 64, 48), true)
    // Drip blobs + glossy highlight so it reads as sticky, not just a colour.
    g.fillStyle(amberDark, 1)
    g.fillCircle(64, 104, 10)
    g.fillCircle(40, 96, 7)
    g.fillStyle(0xffe08a, 0.7)
    g.fillEllipse(54, 46, 34, 16)
    g.fillStyle(0xffffff, 0.5)
    g.fillCircle(48, 42, 5)
    g.generateTexture('honey', 128, 128)
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
