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
/** Wing-flap phases baked into the bee sheet: 0 = folded rest, 1 = top of beat. */
const BEE_WING_PHASE = [0, 0.45, 1, 0.45] as const
const BEE_FRAMES = BEE_WING_PHASE.length

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
      // Frame 0 is the resting pose — a flying bee never shows it.
      frames: [
        { key, frame: 1 },
        { key, frame: 2 },
        { key, frame: 3 },
        { key, frame: 2 },
      ],
      frameRate: 24,
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
    // Four wing phases instead of two. At 18fps a 2-frame flap strobes; four
    // phases (rest → mid → top → mid) read as a real beat and let the flight
    // loop skip the rest frame entirely.
    for (let f = 0; f < BEE_FRAMES; f++) this.drawBee(g, f * 128, light, dark, BEE_WING_PHASE[f])
    g.generateTexture(key, 128 * BEE_FRAMES, 128)
    g.destroy()
    const tex = this.textures.get(key)
    for (let f = 0; f < BEE_FRAMES; f++) tex.add(f, 0, f * 128, 0, 128, 128)
  }

  /**
   * Draw one bee into `g`, offset by `ox`. `wing` is the flap phase (0 folded,
   * 1 top of the beat).
   *
   * Built back-to-front so the silhouette stays clean: shadow, far wing, legs,
   * stinger, body (outline → gradient → belly shade → rim light), stripes,
   * near wing, head, antennae, eyes. The far wing and the belly shade are what
   * turn the old flat sticker into something with a near and a far side.
   */
  private drawBee(
    g: Phaser.GameObjects.Graphics,
    ox: number,
    light: number,
    dark: number,
    wing: number,
  ): void {
    const ink = LOGO.ink
    g.save()
    g.translateCanvas(ox, 0)

    // NO grounding shadow in the sheet. It used to live here, and it was
    // correct while the sprite never rotated — now that a bee faces its own
    // heading, a baked shadow swings around with the body and ends up above it.
    // The scene draws a separate shadow that follows position but not rotation.

    // The logo's mark sits at a slight nose-up tilt; everything below is drawn
    // in that local frame, centred on the body. The nose lifts with the beat.
    g.translateCanvas(64, 64 - wing * 3)
    g.rotateCanvas(Phaser.Math.DegToRad(-8 - wing * 4))

    // FAR WING — behind everything, smaller and dimmer than the near one. Two
    // wings at slightly different phases is most of what sells the flap.
    this.beeWing(g, wing, true)

    // LEGS — three short ink hooks tucked under the belly. Kept SHORT and thin
    // on purpose: at cell size long legs read as scratches around the bee, not
    // as anatomy. They exist to break the decal-flat silhouette, nothing more.
    g.lineStyle(3.5, ink, 1)
    for (const [lx, ly, tx, ty] of [
      [-22, 27, -28, 36],
      [-2, 30, -4, 39],
      [18, 27, 22, 36],
    ]) {
      g.beginPath()
      g.moveTo(lx, ly)
      g.lineTo(tx, ty)
      g.strokePath()
    }

    // STINGER — a sharp ink wedge off the tail, drawn under the body so the
    // body's outline swallows its base and only the point shows.
    g.fillStyle(ink, 1)
    g.fillTriangle(-60, 9, -44, 0, -44, 17)

    // BODY — thick ink outline, then the gold gradient built as a stack of
    // ellipses stepping lighter and higher: deep belly, lit crown, exactly the
    // top-lit falloff the logo has.
    g.fillStyle(ink, 1)
    g.fillEllipse(-8, 4, 88, 64)
    const steps = 7
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1)
      g.fillStyle(this.mix(dark, light, t), 1)
      g.fillEllipse(-8, 4 - t * 9, 80 - t * 6, 56 - t * 18)
    }
    // BELLY SHADE — a warm dark crescent along the underside, so the body is a
    // rounded volume rather than a flat gradient.
    g.fillStyle(this.mix(dark, ink, 0.28), 0.5)
    g.fillEllipse(-8, 22, 66, 20)
    // RIM LIGHT — a thin bright sliver on the top-back edge, the single cheapest
    // trick for making a flat vector shape look lit.
    g.fillStyle(0xfff6d0, 0.75)
    g.fillEllipse(-16, -20, 46, 9)

    // Two heavy slanted stripes, inscribed in the body ellipse so their ends
    // stop just inside the outline (no clipping needed).
    g.fillStyle(ink, 1)
    this.beeStripe(g, -8, 4, 40, 28, -12, 12)
    this.beeStripe(g, -8, 4, 40, 28, 7, 12)

    // NEAR WING — over the body, leading the far wing by a fraction of a beat.
    this.beeWing(g, Math.min(1, wing * 1.15), false)

    // HEAD — a solid ink circle overlapping the body's front.
    g.fillStyle(ink, 1)
    g.fillCircle(36, -12, 24)

    // ANTENNAE — two short ink whips with club tips, springing back as the bee
    // lifts. Same restraint as the legs: readable curve, no wire sculpture.
    g.lineStyle(3.5, ink, 1)
    for (const [sx, sy, cx, cy] of [
      [40, -30, 52 - wing * 5, -44 - wing * 3],
      [31, -33, 37 - wing * 4, -48 - wing * 3],
    ]) {
      g.beginPath()
      g.moveTo(sx, sy)
      g.lineTo(cx, cy)
      g.strokePath()
      g.fillStyle(ink, 1)
      g.fillCircle(cx, cy, 4)
    }

    // EYES — two white circles set diagonally, each with a pupil pushed
    // up-and-forward. Scaled up from the logo's proportions to stay readable
    // at cell size; the arrangement is the logo's.
    this.beeEye(g, 41, -20, 7)
    this.beeEye(g, 46, -4, 7.5)

    g.restore()
  }

  /** One white eye with an ink pupil looking up-and-forward, plus a glint. */
  private beeEye(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
    g.fillStyle(0xffffff, 1)
    g.fillCircle(cx, cy, r)
    g.fillStyle(LOGO.ink, 1)
    g.fillCircle(cx + r * 0.34, cy - r * 0.27, r * 0.42)
    // Specular dot on the pupil — what makes eyes look wet instead of printed.
    g.fillStyle(0xffffff, 0.9)
    g.fillCircle(cx + r * 0.14, cy - r * 0.5, r * 0.2)
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

  /**
   * One wing. `phase` 0 = folded along the back, 1 = top of the beat. `far`
   * draws the off-side wing: smaller, darker and lagging, which is what gives
   * the pair depth instead of one flat paddle.
   */
  private beeWing(g: Phaser.GameObjects.Graphics, phase: number, far: boolean): void {
    const lift = far ? phase * 0.82 : phase
    const scale = far ? 0.8 : 0.92
    g.save()
    // Sits on the SHOULDER and sweeps back, not across the middle. The first
    // pass parked it over the body and the stripes vanished behind a pale blob
    // — the stripes are the bee's read at cell size, so the wing gets out of
    // their way and stays translucent.
    g.translateCanvas(-24 - lift * 6 - (far ? 5 : 0), -32 - lift * 10 - (far ? 4 : 0))
    g.rotateCanvas(Phaser.Math.DegToRad(-30 - lift * 24))
    g.scaleCanvas(scale, scale)
    // Ink edge, pale membrane, then a bright leading streak. The whole wing
    // fades as it rises — a wing at speed is half-transparent, not a solid.
    const a = far ? 0.45 : 0.82
    g.fillStyle(LOGO.ink, a * (1 - lift * 0.35))
    g.fillEllipse(0, 0, 32, 48)
    g.fillStyle(LOGO.wing, a * (1 - lift * 0.3))
    g.fillEllipse(0, 0, 26, 42)
    g.fillStyle(0xffffff, a * 0.6 * (1 - lift * 0.25))
    g.fillEllipse(-3, -9, 11, 18)
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
