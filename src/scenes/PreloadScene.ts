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

/** Wing-flap phases baked into the bee sheet: 0 = folded rest, 1 = top of beat. */
const BEE_WING_PHASE = [0, 0.45, 1, 0.45] as const
const BEE_FRAMES = BEE_WING_PHASE.length

/**
 * Supersample factor for the bee sheet. The art is drawn at 3x into an
 * offscreen buffer and filtered down to the 128px frame, which is what kills
 * the stair-stepping on the outline and the wing edges. Canvas 2D's own
 * anti-aliasing is per-shape; SSAA is per-pixel, and at 128px that shows.
 *
 * NOTE: `shadowBlur` / `shadowOffset*` are specified in DEVICE pixels and are
 * NOT transformed by the CTM, so every blur radius below is multiplied by
 * BEE_SS by hand. Forget that and the shadows come out 3x too tight.
 */
const BEE_SS = 3

/** Every colour the bee needs. Strings, because Canvas 2D wants CSS colours. */
interface BeePalette {
  /** Body gradient, hot core → shaded rim. */
  hi: string
  lit: string
  mid: string
  deep: string
  edge: string
  /** "r,g,b" for the belly subsurface bleed (drawn with `lighter`). */
  glow: string
  /** "r,g,b" for the rim ambient occlusion (drawn with `multiply`). */
  ao: string
  /** Outline + stripe gradient, top-lit → deep. */
  inkTop: string
  ink: string
  inkDeep: string
  /** Head sphere gradient. */
  headHi: string
  headMid: string
  headDeep: string
  /** "r,g,b" for the wing membrane and its soft glow. */
  wing: string
}

/** The logo's gold, as a lit volume rather than three flat swatches. */
const BEE_WORKER: BeePalette = {
  hi: '#fffbe6',
  lit: '#ffe07a',
  mid: '#ffc62e',
  deep: '#f0930c',
  edge: '#d2700a',
  glow: '255,138,0',
  ao: '176,104,26',
  inkTop: '#5a3a1c',
  ink: '#2a1a0c',
  inkDeep: '#1a0f05',
  headHi: '#6b4a2c',
  headMid: '#3a2410',
  headDeep: '#1c1006',
  wing: '210,240,252',
}

/**
 * The same mark in rose, for the queen.
 *
 * She is being removed from the NEW ladder's generator, but she is still in the
 * shipped data — 39 of the 50 compass levels contain one, and every campaign
 * slot carries a `hasQueen` field. Deleting this palette (or its `makeBeeSheet`
 * call) before those levels are regenerated leaves GameScene asking for a
 * texture key that does not exist. Retire her from the DATA first.
 */
const BEE_QUEEN: BeePalette = {
  hi: '#fff2f7',
  lit: '#ffc9de',
  mid: '#ff92bf',
  deep: '#ee5c9c',
  edge: '#c93f7c',
  glow: '255,90,150',
  ao: '178,60,110',
  inkTop: '#6b2440',
  ink: '#3a1122',
  inkDeep: '#230a15',
  headHi: '#7a3252',
  headMid: '#45162a',
  headDeep: '#230a15',
  wing: '250,225,240',
}

// Silhouette control points, in a body-local frame centred on the thorax,
// x+ = EAST = the way the bee faces. Kept as point lists (not literal beziers)
// so the shapes stay editable: `beeBlob` runs a closed Catmull-Rom through them.

const BEE_BODY: readonly (readonly [number, number])[] = [
  [-44, -8], [-38, -20], [-24, -28], [-4, -30], [14, -27], [26, -17],
  [30, -2], [26, 13], [14, 24], [-4, 28], [-22, 26], [-36, 17], [-45, 5],
]
const BEE_HEAD = { x: 36, y: -1, rx: 20.5, ry: 19 } as const
/** One wing, rooted at (0,0) and pointing along +x; `beeWing` rotates it. */
const BEE_WING: readonly (readonly [number, number])[] = [
  [0, 0], [13, -9], [28, -12], [38, -9], [42, -1], [36, 6], [22, 9], [9, 6],
]
/** The pale fur ruff that joins thorax to head. */
const BEE_RUFF: readonly (readonly [number, number])[] = [
  [20, -24], [26, -19], [28, -8], [28, 6], [25, 16], [19, 21],
  [15, 14], [13, 2], [14, -12],
]

/** Colours sampled from `public/logo.png` — used by every NON-bee texture. */
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
    // Each bee is a 4-phase sheet (rest / mid / top / mid) so it can flap in
    // flight. The worker wears the logo's own gold; the queen the same mark in
    // rose so the two read apart at a glance (she also gets a crown).
    this.makeBeeSheet('bee', BEE_WORKER)
    this.makeBeeSheet('beeQueen', BEE_QUEEN)
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
  /**
   * The bee, as a 4-frame 128×128 sheet drawn with the Canvas 2D API instead of
   * Phaser's Graphics.
   *
   * WHY: `Graphics` can only stack FLAT fills, so every attempt at volume ends
   * up as banded ellipses — that is the whole reason the old bee read as
   * clip-art. The 2D context gives real radial/linear gradients, `shadowBlur`,
   * bezier curves, `globalAlpha` and composite modes, which is what buys the
   * plush gradient, the soft shadow and the translucent wings.
   *
   * This is very nearly the path Graphics already took: `generateTexture`
   * funnels through `textures.createCanvas()` and paints with the Canvas
   * renderer, so registration and upload are unchanged. ONE difference is
   * deliberate — Graphics asks for `{ willReadFrequently: true }` and this does
   * not, because the canvas is written once and uploaded, never read back. Do
   * not "restore parity" by adding that flag: on WebKit it is the switch that
   * moves the canvas to a software backing store.
   */
  private makeBeeSheet(key: string, pal: BeePalette): void {
    const W = 128 * BEE_FRAMES
    const H = 128
    // Re-entrant: a scene restart must not fight a stale texture of the same key.
    if (this.textures.exists(key)) this.textures.remove(key)
    const tex = this.textures.createCanvas(key, W, H)
    if (!tex) return

    // Supersampled buffer → downscale. `willReadFrequently` is deliberately NOT
    // set: this canvas is written once and uploaded to the GPU, never read back,
    // and the flag would force it onto a slow software backing store.
    const buf = document.createElement('canvas')
    buf.width = W * BEE_SS
    buf.height = H * BEE_SS
    const bctx = buf.getContext('2d')
    if (!bctx) return
    bctx.scale(BEE_SS, BEE_SS)
    for (let f = 0; f < BEE_FRAMES; f++) this.drawBee(bctx, f * 128, pal, BEE_WING_PHASE[f])

    // Downscale by REPEATED HALVING, not one big drawImage.
    //
    // `imageSmoothingQuality = 'high'` is silently ignored on WebKit — the
    // assignment is a no-op — so on the iOS 15 WebView this app actually ships
    // to, a single 3x→1x drawImage falls back to bilinear and samples 4 of the
    // 9 supersampled texels. That throws away most of the anti-aliasing the
    // supersample exists to buy, and it would only ever have shown up on
    // device: every render in the browser looks right.
    //
    // Halving steps are exact box filters under plain bilinear, so this needs
    // no unsupported API and looks the same everywhere. (Same class of trap the
    // file already avoids for `ctx.filter` further down.)
    let srcCanvas: HTMLCanvasElement = buf
    let w = buf.width
    let h = buf.height
    while (w > W * 2 && h > H * 2) {
      const half = document.createElement('canvas')
      half.width = Math.max(W, Math.round(w / 2))
      half.height = Math.max(H, Math.round(h / 2))
      const hctx = half.getContext('2d')
      if (!hctx) break
      hctx.imageSmoothingEnabled = true
      hctx.drawImage(srcCanvas, 0, 0, half.width, half.height)
      srcCanvas = half
      w = half.width
      h = half.height
    }

    const ctx = tex.getContext()
    ctx.clearRect(0, 0, W, H)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(srcCanvas, 0, 0, W, H)
    // Under WebGL the canvas is only uploaded to the GPU when we say so.
    tex.refresh()

    for (let f = 0; f < BEE_FRAMES; f++) tex.add(f, 0, f * 128, 0, 128, 128)
  }

  /**
   * Draw one bee into `ctx`, offset by `ox`. `phase` is the flap (0 folded rest,
   * 1 top of the beat).
   *
   * Back to front: ambient shadow, far wing, legs, stinger, body (gradient →
   * subsurface → stripes → AO → rim light), fur ruff, head, outline, antennae,
   * face, near wing.
   *
   * The body axis is EXACTLY horizontal — no baked nose-up tilt. GameScene
   * points the sprite by rotating it and mirroring with `setFlipY` past
   * vertical; a baked tilt would flip with it and tip the nose *down* for every
   * westward bee. (The mirror is safe for everything else: rotate∘flipY works
   * out to a mirror across the flight axis, so "wings up" and "mouth below the
   * eye" survive all six directions.)
   */
  private drawBee(
    ctx: CanvasRenderingContext2D,
    ox: number,
    pal: BeePalette,
    phase: number,
  ): void {
    ctx.save()
    ctx.translate(ox + 64, 64)
    // 0.95 keeps the raised wing tip and the soft shadow inside the 128 frame.
    ctx.scale(0.95, 0.95)
    // The whole body lifts a little at the top of the beat.
    ctx.translate(0, -phase * 2)

    // AMBIENT / CONTACT SHADOW — blurred, but with ZERO offset on purpose. A
    // directional drop shadow would swing above the bee as the sprite rotates
    // to face its heading; this one is rotation-invariant. It reads as contact
    // and it softens the die-cut edge. GameScene still draws its own level
    // ground ellipse under the sprite; the two stack correctly.
    ctx.save()
    ctx.shadowColor = 'rgba(66,32,0,0.34)'
    ctx.shadowBlur = 4 * BEE_SS
    ctx.fillStyle = 'rgba(66,32,0,0.34)'
    this.beeBodyPath(ctx)
    ctx.fill()
    this.beeHeadPath(ctx)
    ctx.fill()
    ctx.restore()

    // FAR WING — behind the body, smaller, dimmer, lagging the near one.
    this.beeWing(ctx, phase, true, pal)

    // LEGS — short tapered hooks. Long legs read as scratches at cell size.
    ctx.save()
    ctx.strokeStyle = pal.ink
    ctx.lineCap = 'round'
    for (const [x1, y1, cx, cy, x2, y2, w] of [
      [-16, 23, -22, 32, -29, 29, 4.4],
      [1, 25, 0, 35, -7, 35, 4.6],
      [18, 19, 23, 31, 16, 33, 4.4],
    ]) {
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.quadraticCurveTo(cx, cy, x2, y2)
      ctx.stroke()
    }
    ctx.restore()

    // STINGER — a wedge off the tail, drawn under the body so only its point shows.
    ctx.save()
    const sting = ctx.createLinearGradient(-60, 0, -36, 0)
    sting.addColorStop(0, pal.inkDeep)
    sting.addColorStop(1, pal.inkTop)
    ctx.fillStyle = sting
    ctx.beginPath()
    ctx.moveTo(-34, -10)
    ctx.quadraticCurveTo(-52, -3, -60, 2)
    ctx.quadraticCurveTo(-50, 9, -34, 14)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // BODY — one clip, then every shading pass painted inside it.
    ctx.save()
    this.beeBodyPath(ctx)
    ctx.clip()

    // 1. the plush gradient: a real radial falloff from a top-lit hot spot.
    const body = ctx.createRadialGradient(-6, -20, 3, -4, -6, 62)
    body.addColorStop(0, pal.hi)
    body.addColorStop(0.22, pal.lit)
    body.addColorStop(0.55, pal.mid)
    body.addColorStop(0.85, pal.deep)
    body.addColorStop(1, pal.edge)
    ctx.fillStyle = body
    ctx.fillRect(-70, -50, 140, 100)

    // 2. subsurface warmth — light bleeding through the underside, added with
    //    `lighter`. This is the pass that makes fuzz look translucent instead
    //    of painted, and it is impossible with flat fills.
    ctx.globalCompositeOperation = 'lighter'
    const sub = ctx.createRadialGradient(-10, 30, 2, -10, 22, 44)
    sub.addColorStop(0, `rgba(${pal.glow},0.5)`)
    sub.addColorStop(1, `rgba(${pal.glow},0)`)
    ctx.fillStyle = sub
    ctx.fillRect(-70, -50, 140, 100)
    ctx.globalCompositeOperation = 'source-over'

    // 3. the two heavy slanted stripes, inside the clip so they never spill.
    this.beeStripe(ctx, -26, 14, pal)
    this.beeStripe(ctx, -5, 14, pal)

    // 4. ambient occlusion, multiplied over stripes AND gold alike so the rim
    //    darkens as one volume rather than the gold darkening around flat bands.
    ctx.globalCompositeOperation = 'multiply'
    const ao = ctx.createRadialGradient(-4, -10, 30, -4, -4, 58)
    ao.addColorStop(0, 'rgba(255,255,255,0)')
    ao.addColorStop(1, `rgba(${pal.ao},0.7)`)
    ctx.fillStyle = ao
    ctx.fillRect(-70, -50, 140, 100)
    ctx.globalCompositeOperation = 'source-over'

    // 5. rim light + bounce: stroke the silhouette offset inside its own clip,
    //    so only the crescent that falls on the top (and the bottom) edge lands.
    ctx.save()
    ctx.translate(0, 4)
    ctx.strokeStyle = 'rgba(255,250,222,0.85)'
    ctx.lineWidth = 6
    this.beeBodyPath(ctx)
    ctx.stroke()
    ctx.restore()
    ctx.save()
    ctx.translate(0, -4)
    ctx.strokeStyle = 'rgba(255,176,66,0.5)'
    ctx.lineWidth = 5
    this.beeBodyPath(ctx)
    ctx.stroke()
    ctx.restore()
    ctx.restore()

    // FUR RUFF — the pale collar where thorax meets head. Cheap, and it stops
    // the bee reading as two disconnected blobs.
    ctx.save()
    ctx.globalAlpha = 0.9
    const ruff = ctx.createLinearGradient(0, -26, 0, 24)
    ruff.addColorStop(0, '#fff3cf')
    ruff.addColorStop(1, '#e8a63c')
    ctx.fillStyle = ruff
    this.beeBlob(ctx, BEE_RUFF)
    ctx.fill()
    ctx.restore()

    // HEAD — a shaded sphere, not a flat ink disc, with its own rim light.
    ctx.save()
    this.beeHeadPath(ctx)
    ctx.clip()
    const head = ctx.createRadialGradient(
      BEE_HEAD.x - 6, BEE_HEAD.y - 12, 2, BEE_HEAD.x, BEE_HEAD.y, 26,
    )
    head.addColorStop(0, pal.headHi)
    head.addColorStop(0.55, pal.headMid)
    head.addColorStop(1, pal.headDeep)
    ctx.fillStyle = head
    ctx.fillRect(0, -40, 80, 80)
    ctx.save()
    ctx.translate(0, 3)
    ctx.strokeStyle = 'rgba(255,226,160,0.4)'
    ctx.lineWidth = 5
    this.beeHeadPath(ctx)
    ctx.stroke()
    ctx.restore()
    ctx.restore()

    // OUTLINE — one weight, but a GRADIENT down its length (warm brown lit at
    // the top, near-black underneath). A single flat black keyline is exactly
    // what makes vector art look die-cut; a line that changes value reads as
    // drawn.
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const line = ctx.createLinearGradient(0, -34, 0, 34)
    line.addColorStop(0, pal.inkTop)
    line.addColorStop(0.5, pal.ink)
    line.addColorStop(1, pal.inkDeep)
    ctx.strokeStyle = line
    ctx.lineWidth = 5
    this.beeBodyPath(ctx)
    ctx.stroke()
    this.beeHeadPath(ctx)
    ctx.stroke()
    ctx.restore()

    // ANTENNAE — two curved whips with club tips, springing back on the beat.
    ctx.save()
    ctx.strokeStyle = pal.ink
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    for (const [sx, sy, cx, cy, tx, ty] of [
      [38, -15, 49, -30 - phase * 3, 54 - phase * 5, -37 - phase * 3],
      [29, -17, 34, -33 - phase * 3, 37 - phase * 4, -41 - phase * 3],
    ]) {
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.quadraticCurveTo(cx, cy, tx, ty)
      ctx.stroke()
      ctx.fillStyle = pal.ink
      ctx.beginPath()
      ctx.arc(tx, ty, 4.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,220,150,0.5)'
      ctx.beginPath()
      ctx.arc(tx - 1.2, ty - 1.4, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    // FACE — a small far eye for the 3/4 read, one big glossy near eye, and a
    // short smile. The smile sits BELOW the eye, which the rotate∘flip mirror
    // preserves, so it never inverts into a frown on a westward bee.
    this.beeEye(ctx, 28, -11, 5.6)
    this.beeEye(ctx, 40, 1, 9.6)
    ctx.save()
    ctx.strokeStyle = 'rgba(255,228,176,0.9)'
    ctx.lineWidth = 2.8
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(43, 14)
    ctx.quadraticCurveTo(48, 16, 51, 11)
    ctx.stroke()
    ctx.restore()

    // NEAR WING — over the body, leading the far wing by a fraction of a beat.
    this.beeWing(ctx, Math.min(1, phase * 1.12), false, pal)

    ctx.restore()
  }

  /**
   * One wing, rooted on the shoulder and sweeping UP and BACK.
   *
   * `phase` 0 lays it folded along the abdomen (rest); 1 raises it to the top
   * of the beat. The sign of the lift term matters — sweeping the other way
   * flattens the wing across the abdomen and buries the stripes, which are the
   * bee's whole read at cell size.
   *
   * Motion blur is faked by stamping a few rotated ghosts underneath at low
   * alpha, and it peaks MID-stroke (`sin(phase·π)`), where a real wing is
   * fastest — not at the extremes, where it is momentarily still. `ctx.filter`
   * would be cleaner but it does not exist on the iOS 15 WebView this app
   * still targets, so ghost stamping it is.
   */
  private beeWing(
    ctx: CanvasRenderingContext2D,
    phase: number,
    far: boolean,
    pal: BeePalette,
  ): void {
    const lift = far ? phase * 0.68 : phase
    const smear = Math.sin(Math.min(1, phase * 1.08) * Math.PI)
    const scale = far ? 0.8 : 1
    const alpha = far ? 0.5 : 1
    ctx.save()
    ctx.translate(8 - (far ? 13 : 0), -20 + (far ? 5 : 0))
    // -168deg = folded back along the abdomen (rest); +54deg of lift raises it
    // to the top of the beat.
    ctx.rotate((-168 + lift * 54) * (Math.PI / 180))

    const ghosts = 4
    for (let i = ghosts; i >= 1; i--) {
      const k = i / ghosts
      ctx.save()
      ctx.rotate(smear * 0.42 * k)
      this.beeWingBlade(ctx, scale * (1 - 0.03 * k), alpha * 0.2 * (1 - k * 0.45), pal)
      ctx.restore()
    }
    // The blade itself gets a soft glow and thins out as it speeds up.
    ctx.shadowColor = `rgba(${pal.wing},0.6)`
    ctx.shadowBlur = 4 * BEE_SS
    this.beeWingBlade(ctx, scale, alpha * (1 - smear * 0.28), pal)
    ctx.restore()
  }

  /** The wing membrane: graded translucency, two veins, a cool soft edge. */
  private beeWingBlade(
    ctx: CanvasRenderingContext2D,
    scale: number,
    alpha: number,
    pal: BeePalette,
  ): void {
    ctx.save()
    ctx.scale(scale, scale)
    const g = ctx.createLinearGradient(0, 0, 42, -5)
    g.addColorStop(0, `rgba(255,255,255,${0.7 * alpha})`)
    g.addColorStop(0.5, `rgba(${pal.wing},${0.44 * alpha})`)
    g.addColorStop(1, `rgba(${pal.wing},${0.2 * alpha})`)
    ctx.fillStyle = g
    this.beeBlob(ctx, BEE_WING)
    ctx.fill()
    ctx.strokeStyle = `rgba(255,255,255,${0.45 * alpha})`
    ctx.lineWidth = 1.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(5, -1)
    ctx.quadraticCurveTo(22, -8, 37, -5)
    ctx.moveTo(5, 2)
    ctx.quadraticCurveTo(20, 1, 34, 3)
    ctx.stroke()
    // A COOL grey-blue edge, never the body's ink: an ink-outlined wing reads
    // as a solid paddle instead of glass.
    ctx.strokeStyle = `rgba(120,150,168,${0.34 * alpha})`
    ctx.lineWidth = 2
    this.beeBlob(ctx, BEE_WING)
    ctx.stroke()
    ctx.restore()
  }

  /**
   * One eye: a graded white, a graded pupil, a big soft specular and a small
   * secondary bounce. TWO highlights (not one) is what makes an eye read as
   * WET; a single dot reads as printed.
   */
  private beeEye(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    ctx.save()
    const white = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r)
    white.addColorStop(0, '#ffffff')
    white.addColorStop(0.75, '#f6f8fb')
    white.addColorStop(1, '#d9dfe8')
    ctx.fillStyle = white
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r * 1.06, 0, 0, Math.PI * 2)
    ctx.fill()

    const px = cx + r * 0.26
    const py = cy - r * 0.12
    const pupil = ctx.createRadialGradient(px - r * 0.15, py - r * 0.2, r * 0.05, px, py, r * 0.6)
    pupil.addColorStop(0, '#4a3a2c')
    pupil.addColorStop(1, '#160d05')
    ctx.fillStyle = pupil
    ctx.beginPath()
    ctx.ellipse(px, py, r * 0.5, r * 0.56, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.ellipse(px - r * 0.2, py - r * 0.3, r * 0.24, r * 0.19, -0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.beginPath()
    ctx.arc(px + r * 0.22, py + r * 0.26, r * 0.11, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /**
   * One stripe, `dx` along the body and slanted from vertical. Drawn as a tall
   * ellipse and left to the caller's body clip, so its ends stop dead on the
   * outline with no trimming maths. The vertical gradient matters: a flat black
   * band flattens the volume the body gradient just bought.
   */
  private beeStripe(
    ctx: CanvasRenderingContext2D,
    dx: number,
    w: number,
    pal: BeePalette,
    deg = -16,
  ): void {
    ctx.save()
    ctx.translate(dx, 0)
    ctx.rotate((deg * Math.PI) / 180)
    const g = ctx.createLinearGradient(0, -34, 0, 34)
    g.addColorStop(0, pal.inkTop)
    g.addColorStop(0.42, pal.ink)
    g.addColorStop(1, pal.inkDeep)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(0, 0, w / 2, 40, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /**
   * A closed Catmull-Rom spline through `pts`, emitted as cubic beziers.
   *
   * This is the shape primitive the Graphics API never had: `fillPoints` only
   * ever draws straight edges between points, so organic outlines had to be
   * faked with stacked ellipses. Here a handful of control points give a
   * genuinely smooth, editable silhouette.
   */
  private beeBlob(
    ctx: CanvasRenderingContext2D,
    pts: readonly (readonly [number, number])[],
  ): void {
    const n = pts.length
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n]
      const p1 = pts[i]
      const p2 = pts[(i + 1) % n]
      const p3 = pts[(i + 2) % n]
      ctx.bezierCurveTo(
        p1[0] + (p2[0] - p0[0]) / 6,
        p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6,
        p2[1] - (p3[1] - p1[1]) / 6,
        p2[0],
        p2[1],
      )
    }
    ctx.closePath()
  }

  private beeBodyPath(ctx: CanvasRenderingContext2D): void {
    this.beeBlob(ctx, BEE_BODY)
  }

  private beeHeadPath(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath()
    ctx.ellipse(BEE_HEAD.x, BEE_HEAD.y, BEE_HEAD.rx, BEE_HEAD.ry, 0, 0, Math.PI * 2)
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
