import Phaser from 'phaser'
import { colors } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { feedback } from '../systems/feedback'

export const FONT_STACK = '"Arial Rounded MT Bold", "Arial Black", "Helvetica Neue", Arial, sans-serif'

/* ────────────────────────────────────────────────────────────────────────────
 * UI KIT — canvas-rendered chrome.
 *
 * Phaser's Graphics API has no gradients, and the old flat-fill + hard-edged
 * "gloss band" buttons read as cheap, half-cut shapes. Everything here is
 * pre-rendered ONCE into CanvasTextures with real 2D-canvas gradients and
 * blurred shadows, then reused. Texture keys are derived from their params, so
 * each distinct size/colour renders exactly once per game run.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Soft-shadow bleed baked into every texture (kept in sync with SHADOW_*). */
const PAD = 18
const SHADOW_BLUR = 10
const SHADOW_DY = 5
const SHADOW_COLOR = 'rgba(0,0,0,0.38)'

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  )
}
const lighten = (c: number, t: number): number => mix(c, 0xffffff, t)
const darken = (c: number, t: number): number => mix(c, 0x000000, t)

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, h / 2, w / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function canvasFor(scene: Phaser.Scene, key: string, w: number, h: number): CanvasRenderingContext2D | null {
  if (scene.textures.exists(key)) return null
  const tex = scene.textures.createCanvas(key, w, h)
  return tex ? tex.getContext() : null
}

function commit(scene: Phaser.Scene, key: string): void {
  ;(scene.textures.get(key) as Phaser.Textures.CanvasTexture).refresh()
}

/**
 * A candy-style rounded button face: blurred drop shadow, vertical body
 * gradient (light top → dark base), a SOFT sheen fading from the top (no hard
 * chord line), a darker bottom bevel lip and a crisp rim.
 */
function ensureButtonTexture(scene: Phaser.Scene, base: number, w: number, h: number): string {
  const key = `uibtn:${base}:${w}x${h}`
  const ctx = canvasFor(scene, key, w + PAD * 2, h + PAD * 2)
  if (!ctx) return key
  const x = PAD
  const y = PAD
  const r = Math.min(26, h * 0.42)

  // Shadow pass
  ctx.save()
  ctx.shadowColor = SHADOW_COLOR
  ctx.shadowBlur = SHADOW_BLUR
  ctx.shadowOffsetY = SHADOW_DY
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fillStyle = hex(darken(base, 0.35))
  ctx.fill()
  ctx.restore()

  // Bottom bevel lip (slightly taller dark shape peeking under the body)
  roundRectPath(ctx, x, y + 3, w, h - 3, r)
  ctx.fillStyle = hex(darken(base, 0.42))
  ctx.fill()

  // Body gradient
  const grad = ctx.createLinearGradient(0, y, 0, y + h - 4)
  grad.addColorStop(0, hex(lighten(base, 0.34)))
  grad.addColorStop(0.45, hex(base))
  grad.addColorStop(1, hex(darken(base, 0.14)))
  roundRectPath(ctx, x, y, w, h - 4, r)
  ctx.fillStyle = grad
  ctx.fill()

  // Soft sheen: fades out — the whole reason this is canvas, not Graphics.
  const sheen = ctx.createLinearGradient(0, y + 2, 0, y + h * 0.58)
  sheen.addColorStop(0, 'rgba(255,255,255,0.5)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  roundRectPath(ctx, x + 3, y + 2, w - 6, h * 0.58, r - 2)
  ctx.fillStyle = sheen
  ctx.fill()

  // Rim
  roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 5, r)
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  commit(scene, key)
  return key
}

/** Flat translucent "glass" chip/panel face with a hairline rim (for pills, cards). */
export function ensureGlassTexture(
  scene: Phaser.Scene,
  w: number,
  h: number,
  opts: { alpha?: number; rim?: number; rimAlpha?: number; radius?: number } = {},
): string {
  const { alpha = 0.34, rim = 0xffffff, rimAlpha = 0.12, radius } = opts
  const key = `uiglass:${w}x${h}:${alpha}:${rim}:${rimAlpha}:${radius ?? 'auto'}`
  const ctx = canvasFor(scene, key, w + PAD * 2, h + PAD * 2)
  if (!ctx) return key
  const r = radius ?? Math.min(26, h / 2)

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 3
  roundRectPath(ctx, PAD, PAD, w, h, r)
  const g = ctx.createLinearGradient(0, PAD, 0, PAD + h)
  g.addColorStop(0, `rgba(0,0,0,${alpha * 0.8})`)
  g.addColorStop(1, `rgba(0,0,0,${alpha * 1.15})`)
  ctx.fillStyle = g
  ctx.fill()
  ctx.restore()

  const sheen = ctx.createLinearGradient(0, PAD, 0, PAD + h * 0.5)
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  roundRectPath(ctx, PAD + 2, PAD + 2, w - 4, h * 0.5, r - 2)
  ctx.fillStyle = sheen
  ctx.fill()

  roundRectPath(ctx, PAD + 0.75, PAD + 0.75, w - 1.5, h - 1.5, r)
  ctx.strokeStyle = `rgba(${(rim >> 16) & 0xff},${(rim >> 8) & 0xff},${rim & 0xff},${rimAlpha})`
  ctx.lineWidth = 1.5
  ctx.stroke()

  commit(scene, key)
  return key
}

/**
 * A rich gradient card face (power-up bar, shop products): deep body gradient,
 * soft top sheen, accent rim, blurred shadow.
 */
export function ensureCardTexture(
  scene: Phaser.Scene,
  base: number,
  accent: number,
  w: number,
  h: number,
): string {
  const key = `uicard:${base}:${accent}:${w}x${h}`
  const ctx = canvasFor(scene, key, w + PAD * 2, h + PAD * 2)
  if (!ctx) return key
  const x = PAD
  const y = PAD
  const r = Math.min(24, h * 0.24)

  ctx.save()
  ctx.shadowColor = SHADOW_COLOR
  ctx.shadowBlur = SHADOW_BLUR
  ctx.shadowOffsetY = SHADOW_DY
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fillStyle = hex(darken(base, 0.4))
  ctx.fill()
  ctx.restore()

  const grad = ctx.createLinearGradient(0, y, 0, y + h)
  grad.addColorStop(0, hex(lighten(base, 0.16)))
  grad.addColorStop(0.5, hex(base))
  grad.addColorStop(1, hex(darken(base, 0.22)))
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fillStyle = grad
  ctx.fill()

  const sheen = ctx.createLinearGradient(0, y, 0, y + h * 0.45)
  sheen.addColorStop(0, 'rgba(255,255,255,0.16)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  roundRectPath(ctx, x + 2, y + 2, w - 4, h * 0.45, r - 2)
  ctx.fillStyle = sheen
  ctx.fill()

  roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, r)
  ctx.strokeStyle = hex(accent)
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.globalAlpha = 1

  commit(scene, key)
  return key
}

/** Sphere-gradient circular button face with a DRAWN icon (no font glyphs). */
type IconName = 'back' | 'forward' | 'restart' | 'sound' | 'close'

function paintIcon(ctx: CanvasRenderingContext2D, icon: IconName, cx: number, cy: number, s: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = '#f4efff'
  ctx.fillStyle = '#f4efff'
  ctx.lineWidth = Math.max(3.5, s * 0.16)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  switch (icon) {
    case 'back':
      ctx.beginPath()
      ctx.moveTo(s * 0.22, -s * 0.5)
      ctx.lineTo(-s * 0.3, 0)
      ctx.lineTo(s * 0.22, s * 0.5)
      ctx.stroke()
      break
    case 'forward':
      ctx.beginPath()
      ctx.moveTo(-s * 0.22, -s * 0.5)
      ctx.lineTo(s * 0.3, 0)
      ctx.lineTo(-s * 0.22, s * 0.5)
      ctx.stroke()
      break
    case 'restart': {
      const r = s * 0.52
      ctx.beginPath()
      ctx.arc(0, 0, r, -0.62, 4.05)
      ctx.stroke()
      const hx = Math.cos(-0.62) * r
      const hy = Math.sin(-0.62) * r
      const a = s * 0.3
      ctx.beginPath()
      ctx.moveTo(hx + a * 0.9, hy - a * 0.15)
      ctx.lineTo(hx - a * 0.35, hy - a * 0.75)
      ctx.lineTo(hx - a * 0.2, hy + a * 0.6)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'sound': {
      // Speaker body + wedge
      ctx.fillRect(-s * 0.55, -s * 0.22, s * 0.28, s * 0.44)
      ctx.beginPath()
      ctx.moveTo(-s * 0.3, -s * 0.22)
      ctx.lineTo(s * 0.05, -s * 0.5)
      ctx.lineTo(s * 0.05, s * 0.5)
      ctx.lineTo(-s * 0.3, s * 0.22)
      ctx.closePath()
      ctx.fill()
      ctx.lineWidth = Math.max(3, s * 0.13)
      ctx.beginPath()
      ctx.arc(s * 0.14, 0, s * 0.3, -0.75, 0.75)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(s * 0.14, 0, s * 0.52, -0.7, 0.7)
      ctx.stroke()
      break
    }
    case 'close':
      ctx.beginPath()
      ctx.moveTo(-s * 0.4, -s * 0.4)
      ctx.lineTo(s * 0.4, s * 0.4)
      ctx.moveTo(s * 0.4, -s * 0.4)
      ctx.lineTo(-s * 0.4, s * 0.4)
      ctx.stroke()
      break
  }
  ctx.restore()
}

function ensureCircleButtonTexture(
  scene: Phaser.Scene,
  icon: IconName | null,
  radius: number,
  accent?: number,
): string {
  const key = `uicirc:${icon ?? 'plain'}:${radius}:${accent ?? 'none'}`
  const d = radius * 2
  const ctx = canvasFor(scene, key, d + PAD * 2, d + PAD * 2)
  if (!ctx) return key
  const cx = PAD + radius
  const cy = PAD + radius
  const base = colors.buttonSecondary

  ctx.save()
  ctx.shadowColor = SHADOW_COLOR
  ctx.shadowBlur = SHADOW_BLUR
  ctx.shadowOffsetY = SHADOW_DY
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = hex(darken(base, 0.3))
  ctx.fill()
  ctx.restore()

  // Sphere gradient: light falls from the upper-left, fades smoothly — no chord.
  const grad = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.45, radius * 0.1, cx, cy, radius * 1.15)
  grad.addColorStop(0, hex(lighten(base, 0.42)))
  grad.addColorStop(0.55, hex(base))
  grad.addColorStop(1, hex(darken(base, 0.28)))
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()

  ctx.beginPath()
  ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2)
  ctx.strokeStyle = accent !== undefined ? hex(accent) : 'rgba(255,255,255,0.22)'
  ctx.globalAlpha = accent !== undefined ? 0.75 : 1
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.globalAlpha = 1

  if (icon) paintIcon(ctx, icon, cx, cy, radius * 0.78)

  commit(scene, key)
  return key
}

/**
 * Power-up icons, drawn in the game's own candy language (emoji rendered as
 * flat grey shapes on some platforms and never matched the art).
 */
export function ensurePowerupIconTexture(
  scene: Phaser.Scene,
  kind: 'clean' | 'undo' | 'moves',
  size = 56,
): string {
  const key = `uipow:${kind}:${size}`
  const ctx = canvasFor(scene, key, size, size)
  if (!ctx) return key
  const c = size / 2
  const s = size * 0.42
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  switch (kind) {
    case 'clean': {
      // A honey-yellow sponge: rounded slab, darker base, air holes, sparkle.
      const g = ctx.createLinearGradient(0, c - s * 0.55, 0, c + s * 0.75)
      g.addColorStop(0, '#ffe574')
      g.addColorStop(0.55, '#f7c934')
      g.addColorStop(1, '#d99a12')
      roundRectPath(ctx, c - s, c - s * 0.62, s * 2, s * 1.3, s * 0.34)
      ctx.fillStyle = g
      ctx.fill()
      ctx.strokeStyle = 'rgba(90,52,0,0.65)'
      ctx.lineWidth = Math.max(2.5, size * 0.05)
      ctx.stroke()
      ctx.fillStyle = 'rgba(146,89,7,0.5)'
      for (const [hx, hy, hr] of [
        [-0.5, -0.2, 0.13],
        [0.15, 0.25, 0.16],
        [0.55, -0.25, 0.11],
        [-0.15, 0.05, 0.09],
      ] as const) {
        ctx.beginPath()
        ctx.arc(c + hx * s, c + hy * s, hr * s, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.beginPath()
      ctx.ellipse(c - s * 0.45, c - s * 0.42, s * 0.3, s * 0.12, -0.3, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'undo': {
      // A bold counter-clockwise arrow sweeping back.
      const r = s * 0.72
      const grad = ctx.createLinearGradient(0, c - r, 0, c + r)
      grad.addColorStop(0, '#9fdcff')
      grad.addColorStop(1, '#3f9fe0')
      ctx.strokeStyle = grad
      ctx.lineWidth = Math.max(6, size * 0.16)
      ctx.beginPath()
      ctx.arc(c, c, r, -2.4, 1.35)
      ctx.stroke()
      const a = -2.4
      const hx = c + Math.cos(a) * r
      const hy = c + Math.sin(a) * r
      const hs = s * 0.5
      ctx.fillStyle = '#9fdcff'
      ctx.beginPath()
      ctx.moveTo(hx - hs * 0.72, hy + hs * 0.3)
      ctx.lineTo(hx + hs * 0.52, hy - hs * 0.52)
      ctx.lineTo(hx + hs * 0.62, hy + hs * 0.75)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'moves': {
      // A chunky candy plus with "+3" energy: gradient cross + outline.
      const g = ctx.createLinearGradient(0, c - s, 0, c + s)
      g.addColorStop(0, '#b6f7a1')
      g.addColorStop(1, '#4cbf47')
      const arm = s * 0.42
      const len = s * 1.02
      roundRectPath(ctx, c - arm / 2, c - len / 2 - s * 0.06, arm, len, arm * 0.4)
      ctx.fillStyle = g
      ctx.fill()
      roundRectPath(ctx, c - len / 2, c - arm / 2 - s * 0.06, len, arm, arm * 0.4)
      ctx.fillStyle = g
      ctx.fill()
      ctx.strokeStyle = 'rgba(20,84,24,0.7)'
      ctx.lineWidth = Math.max(2.5, size * 0.05)
      roundRectPath(ctx, c - arm / 2, c - len / 2 - s * 0.06, arm, len, arm * 0.4)
      ctx.stroke()
      roundRectPath(ctx, c - len / 2, c - arm / 2 - s * 0.06, len, arm, arm * 0.4)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath()
      ctx.ellipse(c - arm * 0.1, c - len * 0.32, arm * 0.3, arm * 0.16, -0.4, 0, Math.PI * 2)
      ctx.fill()
      break
    }
  }
  commit(scene, key)
  return key
}

/**
 * Rotating celebration sunburst: 12 alternating-alpha gold cones radiating
 * from the centre, pre-faded at the rim. Sits behind the win panel.
 */
export function ensureSunburstTexture(scene: Phaser.Scene, size = 720): string {
  const key = `uisunburst:${size}`
  const ctx = canvasFor(scene, key, size, size)
  if (!ctx) return key
  const c = size / 2
  const r = size / 2
  const cones = 12
  for (let i = 0; i < cones; i++) {
    const a0 = (i / cones) * Math.PI * 2
    const a1 = ((i + 0.5) / cones) * Math.PI * 2
    const grad = ctx.createRadialGradient(c, c, r * 0.05, c, c, r)
    const alpha = i % 2 === 0 ? 0.16 : 0.07
    grad.addColorStop(0, `rgba(255,201,60,${alpha})`)
    grad.addColorStop(0.75, `rgba(255,201,60,${alpha * 0.5})`)
    grad.addColorStop(1, 'rgba(255,201,60,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(c, c)
    ctx.arc(c, c, r, a0, a1)
    ctx.closePath()
    ctx.fill()
  }
  commit(scene, key)
  return key
}

/** A small honey droplet sprite (for currency fly-to-counter effects). */
export function ensureDropTexture(scene: Phaser.Scene, size = 28): string {
  const key = `uidrop:${size}`
  const ctx = canvasFor(scene, key, size, size)
  if (!ctx) return key
  const c = size / 2
  const r = size * 0.3
  ctx.fillStyle = '#c47a00'
  ctx.beginPath()
  ctx.arc(c, c + r * 0.35, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(c, c - r * 1.55)
  ctx.lineTo(c - r, c + r * 0.35)
  ctx.lineTo(c + r, c + r * 0.35)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#f3a712'
  ctx.beginPath()
  ctx.arc(c, c + r * 0.35, r * 0.8, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(c, c - r * 1.15)
  ctx.lineTo(c - r * 0.8, c + r * 0.35)
  ctx.lineTo(c + r * 0.8, c + r * 0.35)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255,224,138,0.9)'
  ctx.beginPath()
  ctx.arc(c - r * 0.3, c, r * 0.28, 0, Math.PI * 2)
  ctx.fill()
  commit(scene, key)
  return key
}

/** Win-streak flame: layered teardrop gradient flame with a bright core. */
export function ensureFlameTexture(scene: Phaser.Scene, size = 40): string {
  const key = `uiflame:${size}`
  const ctx = canvasFor(scene, key, size, size)
  if (!ctx) return key
  const c = size / 2
  const s = size * 0.42
  const flame = (scale: number, fill: string) => {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(c, c - s * 1.1 * scale)
    ctx.bezierCurveTo(c + s * 0.2 * scale, c - s * 0.45 * scale, c + s * 0.85 * scale, c - s * 0.25 * scale, c + s * 0.72 * scale, c + s * 0.35 * scale)
    ctx.bezierCurveTo(c + s * 0.62 * scale, c + s * 0.95 * scale, c - s * 0.62 * scale, c + s * 0.95 * scale, c - s * 0.72 * scale, c + s * 0.35 * scale)
    ctx.bezierCurveTo(c - s * 0.85 * scale, c - s * 0.25 * scale, c - s * 0.2 * scale, c - s * 0.45 * scale, c, c - s * 1.1 * scale)
    ctx.closePath()
    ctx.fill()
  }
  flame(1, '#ff6d2e')
  flame(0.72, '#ffb52e')
  flame(0.45, '#ffe9a8')
  commit(scene, key)
  return key
}

/** Shop product icons drawn in the candy language: honey jar / booster crate / gift. */
export function ensureShopIconTexture(
  scene: Phaser.Scene,
  kind: 'honey' | 'pack' | 'gift',
  size = 64,
): string {
  const key = `uishop:${kind}:${size}`
  const ctx = canvasFor(scene, key, size, size)
  if (!ctx) return key
  const c = size / 2
  const s = size * 0.4
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  switch (kind) {
    case 'honey': {
      // Amber jar: glass body gradient, band lid, drip highlight.
      const body = ctx.createLinearGradient(0, c - s * 0.6, 0, c + s)
      body.addColorStop(0, '#ffd25e')
      body.addColorStop(0.5, '#f2a81d')
      body.addColorStop(1, '#c67c05')
      roundRectPath(ctx, c - s * 0.78, c - s * 0.45, s * 1.56, s * 1.4, s * 0.42)
      ctx.fillStyle = body
      ctx.fill()
      ctx.strokeStyle = 'rgba(96,56,0,0.7)'
      ctx.lineWidth = Math.max(2.5, size * 0.045)
      ctx.stroke()
      // Lid
      const lid = ctx.createLinearGradient(0, c - s * 1.05, 0, c - s * 0.45)
      lid.addColorStop(0, '#a9741d')
      lid.addColorStop(1, '#7c4f0d')
      roundRectPath(ctx, c - s * 0.6, c - s * 0.95, s * 1.2, s * 0.55, s * 0.18)
      ctx.fillStyle = lid
      ctx.fill()
      ctx.strokeStyle = 'rgba(50,28,0,0.7)'
      ctx.stroke()
      // Label + gloss
      roundRectPath(ctx, c - s * 0.5, c - s * 0.1, s, s * 0.62, s * 0.16)
      ctx.fillStyle = 'rgba(255,240,200,0.9)'
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.beginPath()
      ctx.ellipse(c - s * 0.45, c - s * 0.15, s * 0.14, s * 0.4, 0.15, 0, Math.PI * 2)
      ctx.fill()
      // A tiny drop on the label
      ctx.fillStyle = '#e89206'
      ctx.beginPath()
      ctx.arc(c, c + s * 0.28, s * 0.16, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(c, c - s * 0.04)
      ctx.lineTo(c - s * 0.15, c + s * 0.26)
      ctx.lineTo(c + s * 0.15, c + s * 0.26)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'pack': {
      // Booster crate: warm wooden chest with a strap + buckle.
      const body = ctx.createLinearGradient(0, c - s * 0.7, 0, c + s * 0.8)
      body.addColorStop(0, '#c98d4a')
      body.addColorStop(1, '#8a5a25')
      roundRectPath(ctx, c - s * 0.95, c - s * 0.65, s * 1.9, s * 1.45, s * 0.22)
      ctx.fillStyle = body
      ctx.fill()
      ctx.strokeStyle = 'rgba(60,34,6,0.75)'
      ctx.lineWidth = Math.max(2.5, size * 0.045)
      ctx.stroke()
      // Lid seam + strap
      ctx.beginPath()
      ctx.moveTo(c - s * 0.95, c - s * 0.18)
      ctx.lineTo(c + s * 0.95, c - s * 0.18)
      ctx.stroke()
      const strap = ctx.createLinearGradient(0, c - s * 0.65, 0, c + s * 0.8)
      strap.addColorStop(0, '#ffd766')
      strap.addColorStop(1, '#d9a112')
      ctx.fillStyle = strap
      ctx.fillRect(c - s * 0.18, c - s * 0.65, s * 0.36, s * 1.45)
      ctx.strokeStyle = 'rgba(90,52,0,0.7)'
      ctx.strokeRect(c - s * 0.18, c - s * 0.65, s * 0.36, s * 1.45)
      // Buckle
      roundRectPath(ctx, c - s * 0.26, c - s * 0.3, s * 0.52, s * 0.42, s * 0.1)
      ctx.fillStyle = '#ffe9a8'
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.beginPath()
      ctx.ellipse(c - s * 0.55, c - s * 0.5, s * 0.28, s * 0.1, -0.1, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'gift': {
      // Gift box: rose body, gold ribbon + bow.
      const body = ctx.createLinearGradient(0, c - s * 0.5, 0, c + s * 0.9)
      body.addColorStop(0, '#ff8fb4')
      body.addColorStop(1, '#d94f7e')
      roundRectPath(ctx, c - s * 0.85, c - s * 0.35, s * 1.7, s * 1.25, s * 0.16)
      ctx.fillStyle = body
      ctx.fill()
      ctx.strokeStyle = 'rgba(112,20,52,0.75)'
      ctx.lineWidth = Math.max(2.5, size * 0.045)
      ctx.stroke()
      // Lid
      roundRectPath(ctx, c - s * 0.95, c - s * 0.62, s * 1.9, s * 0.42, s * 0.14)
      ctx.fillStyle = '#ff9fc0'
      ctx.fill()
      ctx.stroke()
      // Ribbon
      const rib = ctx.createLinearGradient(0, c - s * 0.62, 0, c + s * 0.9)
      rib.addColorStop(0, '#ffe37a')
      rib.addColorStop(1, '#e0ac1a')
      ctx.fillStyle = rib
      ctx.fillRect(c - s * 0.14, c - s * 0.62, s * 0.28, s * 1.52)
      ctx.strokeStyle = 'rgba(120,80,0,0.6)'
      ctx.strokeRect(c - s * 0.14, c - s * 0.62, s * 0.28, s * 1.52)
      // Bow
      ctx.fillStyle = '#ffe37a'
      for (const dir of [-1, 1]) {
        ctx.beginPath()
        ctx.ellipse(c + dir * s * 0.34, c - s * 0.78, s * 0.3, s * 0.18, dir * 0.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(c, c - s * 0.74, s * 0.13, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      break
    }
  }
  commit(scene, key)
  return key
}

/** A small gradient badge disc (counts on power-up buttons / shop cards). */
export function ensureBadgeTexture(scene: Phaser.Scene, base: number, radius = 16): string {
  const key = `uibadge:${base}:${radius}`
  const d = radius * 2
  const ctx = canvasFor(scene, key, d + 8, d + 8)
  if (!ctx) return key
  const c = radius + 4
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 2
  ctx.beginPath()
  ctx.arc(c, c, radius, 0, Math.PI * 2)
  ctx.fillStyle = hex(darken(base, 0.25))
  ctx.fill()
  ctx.restore()
  const g = ctx.createRadialGradient(c - radius * 0.3, c - radius * 0.4, radius * 0.1, c, c, radius * 1.1)
  g.addColorStop(0, hex(lighten(base, 0.38)))
  g.addColorStop(1, hex(darken(base, 0.12)))
  ctx.beginPath()
  ctx.arc(c, c, radius, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.beginPath()
  ctx.arc(c, c, radius - 0.75, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  commit(scene, key)
  return key
}

/** Standalone spinnable restart-icon texture (arrow arc only, transparent bg). */
function ensureRestartIconTexture(scene: Phaser.Scene, radius: number): string {
  const key = `uiicon:restart:${radius}`
  const d = radius * 2
  const ctx = canvasFor(scene, key, d, d)
  if (!ctx) return key
  paintIcon(ctx, 'restart', radius, radius, radius * 0.78)
  commit(scene, key)
  return key
}

/* ─── Currency drop ───────────────────────────────────────────────────────── */

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

/* ─── Buttons ─────────────────────────────────────────────────────────────── */

export interface ButtonOptions {
  width: number
  height: number
  fontSize?: number
  primary?: boolean
  /** Fill for primary buttons; defaults to a warm amber. */
  accent?: number
}

/**
 * Candy-gradient rounded button. Press = sink + darken; release restores.
 * Same signature as always — every scene upgrades for free.
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
  const fill = primary ? accent : colors.buttonSecondary
  const textColor = primary ? colors.buttonTextCss : colors.buttonSecondaryTextCss

  const texKey = ensureButtonTexture(scene, fill, width, height)
  const bg = scene.add.image(0, 0, texKey)

  const text = scene.add
    .text(0, -2, label, {
      fontFamily: FONT_STACK,
      fontSize: `${fontSize}px`,
      color: textColor,
    })
    .setOrigin(0.5)
  text.setShadow(0, 2, 'rgba(0,0,0,0.25)', 2)

  const container = scene.add.container(x, y, [bg, text])
  container.setSize(width, height)
  container.setInteractive({ useHandCursor: true })

  let pressed = false
  const press = () => {
    pressed = true
    feedback.unlock()
    feedback.tap()
    bg.setTint(0xcccccc)
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
    bg.clearTint()
    scene.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: juice.ui.buttonPressMs })
    if (fire) onTap()
  }
  container.on('pointerdown', press)
  container.on('pointerout', () => release(false))
  container.on('pointerup', () => release(true))

  return container
}

/** Circular icon button with a DRAWN icon (crisp on every platform). */
export function makeIconButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  glyph: string,
  onTap: () => void,
  radius = 34,
  accent?: number,
): Phaser.GameObjects.Container {
  const icon: IconName | null =
    glyph === '‹' ? 'back' : glyph === '›' ? 'forward' : glyph === '♪' ? 'sound' : glyph === '×' ? 'close' : null
  const texKey = ensureCircleButtonTexture(scene, icon, radius, accent)
  const bg = scene.add.image(0, 0, texKey)
  const children: Phaser.GameObjects.GameObject[] = [bg]
  if (!icon) {
    children.push(
      scene.add
        .text(0, -1, glyph, {
          fontFamily: FONT_STACK,
          fontSize: `${radius * 1.1}px`,
          color: colors.buttonSecondaryTextCss,
        })
        .setOrigin(0.5),
    )
  }

  const container = scene.add.container(x, y, children)
  // Square hit area from the container size — the reliable container-input path
  // (custom Geom hit areas on containers don't register taps consistently).
  container.setSize(radius * 2, radius * 2)
  container.setInteractive({ useHandCursor: true })
  let pressed = false
  container.on('pointerdown', () => {
    pressed = true
    feedback.unlock()
    feedback.tap()
    scene.tweens.add({ targets: container, scale: 0.9, duration: 60 })
  })
  container.on('pointerup', () => {
    scene.tweens.add({ targets: container, scale: 1, duration: 60 })
    if (!pressed) return
    pressed = false
    onTap()
  })
  container.on('pointerout', () => {
    pressed = false
    scene.tweens.add({ targets: container, scale: 1, duration: 60 })
  })
  return container
}

/**
 * Restart button — the arrow-arc icon lives on its own texture so it can spin
 * when pressed (the sphere base stays put).
 */
export function makeRestartButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onTap: () => void,
  radius = 34,
  accent = 0xffc94d,
): Phaser.GameObjects.Container {
  const baseKey = ensureCircleButtonTexture(scene, null, radius, accent)
  const iconKey = ensureRestartIconTexture(scene, radius)
  const bg = scene.add.image(0, 0, baseKey)
  const icon = scene.add.image(0, 0, iconKey)

  const container = scene.add.container(x, y, [bg, icon])
  container.setSize(radius * 2, radius * 2)
  container.setInteractive({ useHandCursor: true })
  let pressed = false
  container.on('pointerdown', () => {
    pressed = true
    feedback.unlock()
    feedback.tap()
    scene.tweens.add({ targets: container, scale: 0.9, duration: 60 })
  })
  container.on('pointerup', () => {
    scene.tweens.add({ targets: container, scale: 1, duration: 60 })
    if (!pressed) return
    pressed = false
    // Spin the icon so the restart reads as an action, not just a tap.
    icon.angle = 0
    scene.tweens.add({ targets: icon, angle: 360, duration: 420, ease: 'Cubic.easeOut' })
    onTap()
  })
  container.on('pointerout', () => {
    pressed = false
    scene.tweens.add({ targets: container, scale: 1, duration: 60 })
  })
  return container
}

/* ─── Scene transitions ───────────────────────────────────────────────────── */

/**
 * Fade the camera out, then start the target scene (which fades itself back in
 * via fadeIn in its create — see fadeInScene). Every full-screen navigation
 * goes through here so scene changes read as one polished dissolve instead of
 * a hard cut. Re-entrant safe: a second call while fading is ignored.
 */
export function transitionTo(
  scene: Phaser.Scene,
  key: string,
  data?: Record<string, unknown>,
): void {
  const cam = scene.cameras.main
  if (!cam) {
    scene.scene.start(key, data)
    return
  }
  // Ignore a second navigation while one is already fading — input stays live
  // during the fade, and hard-starting the second target would cut the first
  // transition dead and race two scene starts.
  if ((cam as unknown as { _transitioning?: boolean })._transitioning) return
  ;(cam as unknown as { _transitioning?: boolean })._transitioning = true
  cam.fadeOut(juice.ui.sceneFadeMs, 0, 0, 0)
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
    scene.scene.start(key, data)
  })
}

/** Fade the scene in on entry; call first thing in create(). */
export function fadeInScene(scene: Phaser.Scene): void {
  scene.cameras.main.fadeIn(juice.ui.sceneFadeMs, 0, 0, 0)
}
