import Phaser from 'phaser'

/**
 * Every texture is generated here — the only shipped bitmap is `logo.png`.
 *
 * The whole set is drawn FROM THE LOGO: the palette below is sampled straight
 * out of `public/logo.png`, and the bee reproduces the logo's mark (plump gold
 * body, two thick slanted ink stripes, dark round head with two white
 * pupil-eyes, pointed stinger) so the icon on the home screen and the bee the
 * player taps are visibly the same character. Proportions are the one
 * deliberate departure: the logo's head/eyes are tiny relative to its body,
 * which turns to mush at gameplay size, so the head and eyes are scaled up for
 * legibility while the silhouette, palette and stripe rhythm stay the logo's.
 *
 * Scenes only ever reference texture keys ('hex', 'bee', 'dot'). 'hex' stays
 * pure white so it can be tinted per chapter theme at draw time.
 */

/** Colours sampled from `public/logo.png` — the single source of art truth. */
const LOGO = {
  /** The mark's warm near-black: outlines, stripes, head, stinger. */
  ink: 0x2a1d12,
  /** Body gradient, top-lit: light crown → deep belly. */
  goldLight: 0xffdf78,
  goldMid: 0xffcb3b,
  goldDark: 0xffc220,
  /** Honeycomb tiles under the mark. */
  combFace: 0xf6a81a,
  combBase: 0xe0a22c,
  combShade: 0xbc7e1c,
  combRim: 0xc57d0f,
  combBevel: 0xf1ab34,
  combGloss: 0xfdd573,
  /** The pale wing peeking from behind the body. */
  wing: 0xe3eef2,
} as const
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
    this.makeHexGlossTexture()
    // Each bee is a 2-frame sheet (wings mid / wings up) so it can flap in flight.
    // The worker wears the logo's own gold; the queen the same mark in rose so
    // the two read apart at a glance (she also gets a crown).
    this.makeBeeSheet('bee', LOGO.goldLight, LOGO.goldDark)
    this.makeBeeSheet('beeQueen', 0xffc0dd, 0xef6aa8)
    this.makeFlapAnim('bee')
    this.makeFlapAnim('beeQueen')
    this.makeArrowTexture()
    this.makeHornetTexture()
    this.makeCrownTexture()
    this.makeHoneyTexture()
    this.makeDotTexture()
    this.scene.start('Home')
  }

  /** A fast wing-flap loop for a bee sheet, played only while the bee is flying. */
  private makeFlapAnim(key: string): void {
    if (this.anims.exists(`${key}-fly`)) return
    this.anims.create({
      key: `${key}-fly`,
      frames: [
        { key, frame: 0 },
        { key, frame: 1 },
      ],
      frameRate: 18,
      repeat: -1,
    })
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
   * The soft elliptical sheen the logo paints on its comb tiles. Kept white so
   * the cell can tint it, and separate from 'hex' because the highlight is an
   * ellipse, not a scaled-down hexagon — that shape difference is what makes a
   * flat tile read as a waxed comb cell.
   */
  private makeHexGlossTexture(): void {
    const g = this.make.graphics({}, false)
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(64, 64, 108, 52)
    g.generateTexture('hexGloss', 128, 128)
    g.destroy()
  }

  /**
   * The logo's bee in a 128×128 frame: plump gold body under a thick ink
   * outline, two heavy slanted stripes, a dark round head with two white
   * pupil-eyes, a pointed stinger and a pale wing. Body faces EAST, matching
   * `dir0` — the sprite itself is never rotated (direction is a separate arrow).
   * `light`/`dark` are the two ends of the body's top-lit gradient: the logo's
   * gold for workers, rose for the queen.
   */
  private makeBeeSheet(key: string, light: number, dark: number): void {
    const g = this.make.graphics({}, false)
    this.drawBee(g, 0, light, dark, false) // frame 0 — wing at rest
    this.drawBee(g, 128, light, dark, true) // frame 1 — wing up (mid-flap)
    g.generateTexture(key, 256, 128)
    g.destroy()
    // Split the 256×128 sheet into two 128×128 frames the flap anim cycles through.
    const tex = this.textures.get(key)
    tex.add(0, 0, 0, 0, 128, 128)
    tex.add(1, 0, 128, 0, 128, 128)
  }

  /** Draw one bee into `g`, offset by `ox`; `wingUp` raises + spreads the wing. */
  private drawBee(
    g: Phaser.GameObjects.Graphics,
    ox: number,
    light: number,
    dark: number,
    wingUp: boolean,
  ): void {
    const ink = LOGO.ink
    g.save()
    g.translateCanvas(ox, 0)

    // Soft grounding shadow, drawn before the tilt so it stays level.
    g.fillStyle(0x000000, 0.16)
    g.fillEllipse(62, 116, 74, 12)

    // The logo's mark sits at a slight nose-up tilt; everything below is drawn
    // in that local frame, centred on the body.
    g.translateCanvas(64, 64)
    g.rotateCanvas(Phaser.Math.DegToRad(-8))

    // WING — pale, behind the body; raised and swept back on the flap frame.
    this.beeWing(g, wingUp)

    // STINGER — a sharp ink wedge off the tail, drawn under the body so the
    // body's outline swallows its base and only the point shows.
    g.fillStyle(ink, 1)
    g.fillTriangle(-60, 9, -44, 0, -44, 17)

    // BODY — thick ink outline, then the gold gradient built as a stack of
    // ellipses stepping lighter and higher: deep belly, lit crown, exactly the
    // top-lit falloff the logo has.
    g.fillStyle(ink, 1)
    g.fillEllipse(-8, 4, 88, 64)
    const steps = 5
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1)
      g.fillStyle(this.mix(dark, light, t), 1)
      g.fillEllipse(-8, 4 - t * 9, 80 - t * 6, 56 - t * 18)
    }

    // Two heavy slanted stripes, inscribed in the body ellipse so their ends
    // stop just inside the outline (no clipping needed).
    g.fillStyle(ink, 1)
    this.beeStripe(g, -8, 4, 40, 28, -12, 12)
    this.beeStripe(g, -8, 4, 40, 28, 7, 12)

    // HEAD — a solid ink circle overlapping the body's front.
    g.fillStyle(ink, 1)
    g.fillCircle(36, -12, 24)

    // EYES — two white circles set diagonally, each with a pupil pushed
    // up-and-forward. Scaled up from the logo's proportions to stay readable
    // at cell size; the arrangement is the logo's.
    this.beeEye(g, 41, -20, 7)
    this.beeEye(g, 46, -4, 7.5)

    g.restore()
  }

  /** One white eye with an ink pupil looking up-and-forward. */
  private beeEye(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
    g.fillStyle(0xffffff, 1)
    g.fillCircle(cx, cy, r)
    g.fillStyle(LOGO.ink, 1)
    g.fillCircle(cx + r * 0.34, cy - r * 0.27, r * 0.42)
  }

  /**
   * A stripe across a body ellipse centred (cx,cy) with semi-axes (a,b), placed
   * `dx` along the body and slanted `deg` from vertical. Its length comes from
   * the ellipse's chord at `dx`, trimmed so the slanted ends stay inside the
   * outline — the logo's stripes run edge to edge without spilling.
   */
  private beeStripe(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    a: number,
    b: number,
    dx: number,
    w: number,
    deg = -19,
  ): void {
    const hh = b * Math.sqrt(Math.max(0, 1 - (dx / a) ** 2)) * 0.84
    g.save()
    g.translateCanvas(cx + dx, cy)
    g.rotateCanvas(Phaser.Math.DegToRad(deg))
    g.fillRect(-w / 2, -hh, w, hh * 2)
    g.fillCircle(0, -hh, w / 2)
    g.fillCircle(0, hh, w / 2)
    g.restore()
  }

  /** The pale logo wing behind the body; `up` sweeps it high for the flap frame. */
  private beeWing(g: Phaser.GameObjects.Graphics, up: boolean): void {
    g.save()
    g.translateCanvas(up ? -20 : -15, up ? -34 : -25)
    g.rotateCanvas(Phaser.Math.DegToRad(up ? -44 : -22))
    g.fillStyle(LOGO.ink, 1)
    g.fillEllipse(0, 0, 36, 54)
    g.fillStyle(LOGO.wing, 1)
    g.fillEllipse(0, 0, 29, 47)
    g.fillStyle(0xffffff, 0.65)
    g.fillEllipse(-4, -10, 12, 20)
    g.restore()
  }

  /** Linear blend from colour a to b by t (0..1). */
  private mix(a: number, b: number, t: number): number {
    const ca = Phaser.Display.Color.IntegerToColor(a)
    const cb = Phaser.Display.Color.IntegerToColor(b)
    return Phaser.Display.Color.GetColor(
      Math.round(ca.red + (cb.red - ca.red) * t),
      Math.round(ca.green + (cb.green - ca.green) * t),
      Math.round(ca.blue + (cb.blue - ca.blue) * t),
    )
  }

  /**
   * The flight-direction indicator, drawn in the BEE's own visual language so it
   * reads as part of the bee, not a stray marker: a plump gold arrowhead pointing
   * East (dir0) with the same warm ink outline and a little gloss as the body.
   * Rotated per bee at runtime to point the way it will fly.
   */
  private makeArrowTexture(): void {
    const g = this.make.graphics({}, false)
    const ink = LOGO.ink
    const gold = LOGO.goldMid
    // Ink outline arrowhead, then an inset gold fill, then a small gloss wedge.
    g.fillStyle(ink, 1)
    g.fillTriangle(16, 10, 16, 54, 54, 32)
    g.fillStyle(gold, 1)
    g.fillTriangle(21, 18, 21, 46, 45, 32)
    g.fillStyle(0xffffff, 0.5)
    g.fillTriangle(23, 20, 23, 31, 33, 27)
    g.generateTexture('arrow', 64, 64)
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

  /**
   * A glossy amber honey pool that fills a cell — visibly sticky, and readable as
   * a raised WET layer on top of any cell colour. The defined dark rim + bright
   * specular gloss are what separate it from the (matte) cell underneath, which
   * matters now that honey sits under every bee in the amber early chapters.
   */
  private makeHoneyTexture(): void {
    const g = this.make.graphics({}, false)
    const amber = LOGO.combFace
    const amberMid = 0xef9c0a
    const amberDark = LOGO.combShade
    const rim = 0x8a5200

    // Dark rim ring → a crisp edge against the cell, whatever colour it is.
    g.fillStyle(rim, 1)
    g.fillPoints(this.hexPoints(64, 64, 58), true)
    // Body of the pool, with a slightly darker lower half for depth.
    g.fillStyle(amberDark, 1)
    g.fillPoints(this.hexPoints(64, 66, 50), true)
    g.fillStyle(amberMid, 1)
    g.fillPoints(this.hexPoints(64, 64, 50), true)
    g.fillStyle(amber, 1)
    g.fillEllipse(64, 56, 92, 60)

    // Fat drips pooling at the bottom rim — the "it's sticky" cue.
    g.fillStyle(amberDark, 1)
    g.fillCircle(66, 106, 11)
    g.fillCircle(40, 98, 7)
    g.fillCircle(90, 96, 6)

    // Big soft specular gloss + a hot spot: sells "wet", cells never shine.
    // The gloss tone is the logo's own comb highlight.
    g.fillStyle(LOGO.combGloss, 0.75)
    g.fillEllipse(54, 44, 44, 20)
    g.fillStyle(0xffffff, 0.6)
    g.fillEllipse(48, 40, 16, 9)

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
