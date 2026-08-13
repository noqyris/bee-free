import Phaser from 'phaser'
import { BoardState } from '../systems/BoardState'
import {
  SQRT3,
  axialToPixel,
  pixelToAxial,
  directionAngle,
  neighborDistance,
  unitCenterBounds,
} from '../systems/HexGrid'
import { getLevel, LEVEL_COUNT, chapterOf } from '../levels'
import { getCompassLevel, COMPASS_COUNT } from '../levels/compass'
import { beeTextureKey } from './PreloadScene'
import type { Axial, CellOccupant, Direction, LevelData, TapOutcome } from '../types'
import { GATE_ANY } from '../types'
import { GAME_WIDTH, GAME_HEIGHT, colors, layout } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { themeForChapter, type ChapterTheme } from '../config/theme'
import { paintBackground } from '../utils/background'
import { difficultyDirector } from '../systems/DifficultyDirector'
import { estimateMinMoves } from '../systems/SolverSearch'
import { saveManager } from '../systems/SaveManager'
import { t } from '../i18n'
import {
  makeIconButton,
  makeRestartButton,
  makeButton,
  drawHoneyDrop,
  transitionTo,
  fadeInScene,
  ensureCardTexture,
  ensurePowerupIconTexture,
  ensureBadgeTexture,
  ensureFlameTexture,
  ensureDropTexture,
  FONT_STACK,
} from '../utils/ui'
import { adService } from '../systems/AdService'
import { feedback } from '../systems/feedback'
import {
  POWERUPS,
  POWERUP_KEYS,
  MOVES_POWERUP_AMOUNT,
  FLOODED_HONEY_CAP,
  type PowerupKey,
} from '../config/powerups'

interface GameSceneData {
  levelIndex?: number
  /** 'compass' runs the rotation mode off its own 50-level ladder. */
  mode?: 'compass'
}

/** Compass gate/bee palette (color index → tint). Readable at a glance. */
export const COMPASS_TINTS = [0xff6b6b, 0x5ab7ff, 0xffd93d] as const

/** Pointy-top hexagon outline (vertex at 12 o'clock) around a world point. */
function hexPoints(cx: number, cy: number, radius: number): Phaser.Types.Math.Vector2Like[] {
  const pts: Phaser.Types.Math.Vector2Like[] = []
  for (let i = 0; i < 6; i++) {
    const a = Phaser.Math.DegToRad(60 * i - 90)
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) })
  }
  return pts
}

type EscapedOutcome = Extract<TapOutcome, { kind: 'escaped' }>
type BlockedOutcome = Extract<TapOutcome, { kind: 'blocked' }>
/**
 * How long a press must be held before releasing LAUNCHES rather than turns.
 * 260ms: long enough that a quick aiming tap never fires a bee by accident,
 * short enough that committing does not feel like waiting.
 */
const LAUNCH_HOLD_MS = 260

type StuckOutcome = Extract<TapOutcome, { kind: 'stuck' }>
type ParkedOutcome = Extract<TapOutcome, { kind: 'parked' }>

export class GameScene extends Phaser.Scene {
  private board!: BoardState
  private level!: LevelData
  private theme!: ChapterTheme
  private levelIndex = 0
  private cellSize = 48
  private beeScale = 0.6
  private origin = { x: 0, y: 0 }
  private beeSprites = new Map<number, Phaser.GameObjects.Sprite>()
  private movesText!: Phaser.GameObjects.Text
  private burstEmitter!: Phaser.GameObjects.Particles.ParticleEmitter
  private dustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter
  private inputLocked = false
  private comboCount = 0
  private lastEscapeAt = -Infinity
  private previewGfx!: Phaser.GameObjects.Graphics
  /** Live honey overlays, keyed "q,r". Honey is permanent — blobs only ever fade OUT on undo/clean. */
  private honeyBlobs = new Map<string, Phaser.GameObjects.Image>()
  private pending?: { occ: CellOccupant; q: number; r: number }
  /** True once the press has been held long enough that release will LAUNCH. */
  private launchArmed = false
  private armTimer?: Phaser.Time.TimerEvent
  /** Set when the player took a revive (ad or +moves on the fail screen); caps the win at 1 star. */
  private usedRevive = false
  /**
   * Board snapshots taken before each move, for the Undo power-up. cleanSpent
   * records whether that move consumed a Honey Cleaner, so undoing it can
   * refund the charge — the player must never pay two consumables to be back
   * where they started.
   */
  private history: Array<{ board: BoardState; cleanSpent: boolean }> = []
  /** Non-null while the Honey Cleaner is armed and waiting for a target tap. */
  private cleanArmed = false
  private powerupBtns = new Map<PowerupKey, { count: Phaser.GameObjects.Text }>()
  private powerupContainers = new Map<PowerupKey, Phaser.GameObjects.Container>()
  private powerupBusy = false
  private honeyChip?: Phaser.GameObjects.Text
  private cleanHint?: Phaser.GameObjects.Container
  /** Hornet sprites by "q,r", so a denied tap can wobble the wall that ate it. */
  private hornetSprites = new Map<string, Phaser.GameObjects.Sprite>()
  /** The moves pill chrome, redrawn red + pulsing when the board turns doomed. */
  private movesPillGfx!: Phaser.GameObjects.Graphics
  private movesPillPulse?: Phaser.Tweens.Tween
  private wasDoomed = false
  /** The three mini star pips under the moves pill (3-star transparency). */
  private starPips: Phaser.GameObjects.Star[] = []
  /** True when the BOARD plays by the sealed-rim rules (turning, doors). */
  private compassMode = false
  /** True only when the separate Compass ladder was loaded, not the campaign. */
  private compassLadder = false

  constructor() {
    super('Game')
  }

  init(data: GameSceneData): void {
    // Read the rules off the LEVEL, not off how the scene was launched. The
    // campaign is moving onto the sealed-rim rules level by level, so a board
    // decides for itself; `mode` only still picks which ladder to load.
    this.compassLadder = data.mode === 'compass'
    this.compassMode = data.mode === 'compass'
    const max = this.compassLadder ? COMPASS_COUNT - 1 : LEVEL_COUNT - 1
    this.levelIndex = Phaser.Math.Clamp(data.levelIndex ?? 0, 0, max)
  }

  create(): void {
    this.level = this.compassLadder ? getCompassLevel(this.levelIndex) : getLevel(this.levelIndex)
    if (this.level.compass) this.compassMode = true
    this.theme = themeForChapter(chapterOf(this.level.id))
    // Silent difficulty easing: bonus moves after a fail streak (spec §4).
    const bonus = difficultyDirector.bonusMovesFor(this.level.id)
    this.board = new BoardState({ ...this.level, moveBudget: this.level.moveBudget + bonus })
    this.beeSprites.clear()
    this.honeyBlobs.clear()
    this.hornetSprites.clear()
    this.inputLocked = false
    this.comboCount = 0
    this.lastEscapeAt = -Infinity
    this.pending = undefined
    this.usedRevive = false
    this.history = []
    this.cleanArmed = false
    this.powerupBusy = false
    this.powerupBtns.clear()
    this.wasDoomed = false
    this.movesPillPulse = undefined
    this.starPips = []

    fadeInScene(this)
    paintBackground(this, this.theme)
    this.layoutBoard()
    this.drawCells()
    this.refreshHoney(false)
    this.createEmitters()
    this.previewGfx = this.add.graphics().setDepth(90)
    this.spawnOccupants()
    this.buildHud()
    this.buildPowerupBar()
    this.showCoach()

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this)
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this)
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this)

    // Coming back from the Shop overlay (honey chip / power-up modal): whatever
    // was bought must show up immediately, mid-level.
    this.events.off(Phaser.Scenes.Events.RESUME, this.onSceneResume, this)
    this.events.on(Phaser.Scenes.Events.RESUME, this.onSceneResume, this)

    // The banner is up on every screen (Home, level map, board): each of them
    // keeps its content above layout.bannerSafeBottom, so the native bar at the
    // bottom of the screen has nowhere to cover. showBanner is idempotent, and
    // it stays up until a "remove ads" purchase takes it down.
    void adService.showBanner()
  }

  /** Keep each queen's crown and each bee's direction arrow pinned to its sprite. */
  override update(): void {
    for (const sprite of this.beeSprites.values()) {
      if (!sprite.active) continue
      const crown = sprite.getData('crown') as Phaser.GameObjects.Image | undefined
      if (crown) crown.setPosition(sprite.x, sprite.y - this.cellSize * 0.62)
      const arrow = sprite.getData('arrow') as Phaser.GameObjects.Image | undefined
      if (arrow && arrow.visible) {
        const angle = sprite.getData('arrowAngle') as number
        const off = sprite.getData('arrowOff') as number
        arrow.setPosition(sprite.x + Math.cos(angle) * off, sprite.y + Math.sin(angle) * off)
      }
      // The shadow tracks position but NEVER rotation — that is the whole
      // reason it is a separate object instead of part of the sprite sheet.
      // It also stays level while the bee banks through a flight, which is
      // what keeps the board reading as a surface with things above it.
      const shadow = sprite.getData('shadow') as Phaser.GameObjects.Ellipse | undefined
      if (shadow) shadow.setPosition(sprite.x, sprite.y + this.cellSize * 0.42)
    }
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  private layoutBoard(): void {
    const b = unitCenterBounds(this.level.cells)
    const unitW = b.maxX - b.minX + SQRT3
    const unitH = b.maxY - b.minY + 2
    const availW = GAME_WIDTH - 2 * layout.boardPaddingX
    const availH = layout.boardBottom - layout.boardTop
    this.cellSize = Phaser.Math.Clamp(
      Math.min(availW / unitW, availH / unitH),
      layout.minCellSize,
      layout.maxCellSize,
    )
    // The logo bee is a WIDE mark (stinger to head fills its frame edge to
    // edge), unlike the old upright chibi, so it needs a smaller multiplier to
    // sit inside a hex instead of spilling over the rim.
    this.beeScale = (1.32 * this.cellSize) / 128
    const cx = ((b.minX + b.maxX) / 2) * this.cellSize
    const cy = ((b.minY + b.maxY) / 2) * this.cellSize
    this.origin = {
      x: GAME_WIDTH / 2 - cx,
      y: (layout.boardTop + layout.boardBottom) / 2 - cy,
    }
  }

  private cellToWorld(q: number, r: number): { x: number; y: number } {
    const p = axialToPixel(q, r, this.cellSize)
    return { x: this.origin.x + p.x, y: this.origin.y + p.y }
  }

  private drawCells(): void {
    const s = this.cellSize / 62
    for (const [q, r] of this.level.cells) {
      const { x, y } = this.cellToWorld(q, r)
      // Themed comb cell, built the way the logo builds its tiles: drop shadow,
      // dark rim, an inset bevel ring catching the light, the face, and a soft
      // elliptical sheen up top.
      this.add.image(x, y + s * 4, 'hex').setScale(s).setTint(0x000000).setAlpha(0.18)
      this.add.image(x, y, 'hex').setScale(s).setTint(this.theme.cellStroke)
      this.add.image(x, y, 'hex').setScale(s * 0.94).setTint(0xffffff).setAlpha(0.16)
      this.add.image(x, y, 'hex').setScale(s * 0.88).setTint(this.theme.cellFill)
      this.add
        .image(x, y - s * 9, 'hexGloss')
        .setScale(s * 0.52)
        .setTint(0xffffff)
        .setAlpha(0.13)
    }
    this.drawGates()
  }

  /**
   * Compass gates: a pulsing colored chevron just OUTSIDE each gated rim
   * crossing, pointing outward — "this door, this color". The rest of the rim
   * is a wall in this mode, so the doors are the level's whole geography.
   */
  private drawGates(): void {
    for (const [q, r, dir, color] of this.board.gates) {
      const { x, y } = this.cellToWorld(q, r)
      const angle = directionAngle(dir)
      const off = this.cellSize * 1.12
      const gx = x + Math.cos(angle) * off
      const gy = y + Math.sin(angle) * off
      const tint = COMPASS_TINTS[color % COMPASS_TINTS.length]
      const ring = this.add
        .image(gx, gy, 'hex')
        .setScale((this.cellSize / 62) * 0.55)
        .setTint(tint)
        .setAlpha(0.9)
        .setDepth(7)
      const arrow = this.add
        .image(gx, gy, 'arrow')
        .setRotation(angle)
        .setScale(0.8)
        .setTint(0xffffff)
        .setDepth(8)
      this.tweens.add({
        targets: [ring, arrow],
        alpha: 0.55,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }
  }

  /**
   * Sync the honey overlays with the board. The trail is the whole game, so its
   * ARRIVAL has to tell the story: when `orderedPath` is passed (the cells the
   * bee just flew over, in flight order), new blobs pop in staggered along it —
   * the honey visibly ripples in the bee's wake instead of blinking on at once.
   * Blobs leaving the board (undo, Honey Cleaner) fade out.
   */
  private refreshHoney(animate: boolean, orderedPath?: ReadonlyArray<Axial>): void {
    const s = this.cellSize / 62
    const seen = new Set<string>()
    const pathIndex = new Map<string, number>()
    orderedPath?.forEach((cell, i) => pathIndex.set(`${cell.q},${cell.r}`, i))

    for (const cell of this.board.stickyCells()) {
      const key = `${cell.q},${cell.r}`
      seen.add(key)
      if (this.honeyBlobs.has(key)) continue
      const { x, y } = this.cellToWorld(cell.q, cell.r)
      const blob = this.add.image(x, y, 'honey').setScale(s * 0.92).setDepth(6)
      this.honeyBlobs.set(key, blob)
      if (animate) {
        const delay = (pathIndex.get(key) ?? 0) * juice.honey.layStaggerMs
        blob.setScale(s * 0.5).setAlpha(0)
        this.tweens.add({
          targets: blob,
          scale: s * 0.92,
          alpha: 1,
          delay,
          duration: 180,
          ease: 'Back.easeOut',
          onStart: () => {
            // A tiny splash as each blob lands sells "smeared in the wake".
            this.burstEmitter.explode(juice.honey.splashDots, x, y)
          },
        })
      }
    }

    for (const [key, blob] of this.honeyBlobs) {
      if (seen.has(key)) continue
      this.honeyBlobs.delete(key)
      if (!animate) {
        blob.destroy()
        continue
      }
      this.tweens.add({
        targets: blob,
        alpha: 0,
        scale: s * 0.6,
        duration: 200,
        onComplete: () => blob.destroy(),
      })
    }
  }

  private createEmitters(): void {
    const burst = juice.escape.burst
    this.burstEmitter = this.add.particles(0, 0, 'dot', {
      emitting: false,
      speed: { min: burst.speedMin, max: burst.speedMax },
      angle: { min: 0, max: 360 },
      scale: { start: burst.scaleStart, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: burst.lifespanMinMs, max: burst.lifespanMaxMs },
      tint: colors.honeyParticle,
      blendMode: Phaser.BlendModes.ADD,
    })
    this.burstEmitter.setDepth(120)

    const dust = juice.bump.dust
    this.dustEmitter = this.add.particles(0, 0, 'dot', {
      emitting: false,
      speed: { min: dust.speedMin, max: dust.speedMax },
      angle: { min: 0, max: 360 },
      scale: { start: dust.scaleStart, end: 0 },
      alpha: { start: dust.alphaStart, end: 0 },
      lifespan: { min: dust.lifespanMinMs, max: dust.lifespanMaxMs },
      tint: colors.dustParticle,
    })
    this.dustEmitter.setDepth(120)
  }

  /**
   * Spawn all board sprites. `instant` (undo's rebuild) skips the level-intro
   * stagger and pop — a paid single-step-back must read as a precise step, not
   * as restarting the level.
   */
  private spawnOccupants(instant = false): void {
    this.board.allOccupants().forEach((occ, i) => {
      const { x, y } = this.cellToWorld(occ.q, occ.r)

      if (occ.kind === 'hornet') {
        const hornet = this.add.sprite(x, y, 'hornet').setDepth(8)
        this.hornetSprites.set(`${occ.q},${occ.r}`, hornet)
        if (instant) {
          hornet.setScale(this.beeScale)
          return
        }
        hornet.setScale(0)
        this.time.delayedCall(i * juice.spawn.staggerMs, () => {
          this.tweens.add({
            targets: hornet,
            scale: this.beeScale,
            duration: juice.spawn.popMs,
            ease: 'Back.easeOut',
          })
        })
        return
      }

      // The bee FACES the way it will fly, at rest and not just in flight. In a
      // puzzle whose whole subject is direction, the piece has to carry its own
      // axis — reading a detached arrow to learn where a bee points is work the
      // art should be doing. (It also let the arrow move in off the neighbours.)
      // A colour-matched bee wears its exit colour ON ITS STRIPES, from a sheet
      // drawn that way — not a runtime tint, which multiplies and turns the
      // gold body muddy.
      const texKey =
        occ.kind === 'queen'
          ? 'beeQueen'
          : this.compassMode
            ? beeTextureKey(occ.color)
            : 'bee'
      const sprite = this.add.sprite(x, y, texKey, 0)
      sprite.setScale(0)
      sprite.setDepth(occ.kind === 'queen' ? 12 : 10)
      this.faceBee(sprite, occ.dir)

      // Grounding shadow, under the bee and under the honey glow, level always.
      const shadow = this.add
        .ellipse(x, y + this.cellSize * 0.42, this.cellSize * 0.62, this.cellSize * 0.16, 0x000000, 0.22)
        .setDepth(occ.kind === 'queen' ? 11 : 9)
        .setScale(0)
      sprite.setData('shadow', shadow)

      const angle = directionAngle(occ.dir)
      // The chevron used to be the ONLY direction signal, which is why it was
      // flung 0.76×cellSize out — far enough to clear the wide body, and far
      // enough to spill onto neighbouring cells. The body carries the heading
      // now, so the chevron survives only where it also encodes something else:
      // Compass gate colour. Everywhere else the board loses eight floating
      // triangles and reads as bees instead of bees-plus-signage.
      const off = this.cellSize * 0.7
      const arrow = this.add
        .image(x + Math.cos(angle) * off, y + Math.sin(angle) * off, 'arrow')
        .setRotation(angle)
        .setScale(0)
        .setDepth(occ.kind === 'queen' ? 13 : 11) // above the bee body, never tucked behind it
      // Compass mode: the bee's gate color is worn on the body and the aim
      // arrow — match the gate, read the route at a glance.
      if (this.compassMode && occ.color !== undefined && occ.color >= 0) {
        // Only the chevron is tinted. The body carries its colour in the art.
        arrow.setTint(COMPASS_TINTS[occ.color % COMPASS_TINTS.length])
      }
      sprite.setData('arrow', arrow)
      sprite.setData('arrowAngle', angle)
      sprite.setData('arrowOff', off)

      if (occ.kind === 'queen') {
        const crown = this.add
          .image(x, y - this.cellSize * 0.62, 'crown')
          .setDepth(13)
          .setScale(instant ? (this.cellSize / 62) * 0.9 : 0)
        sprite.setData('crown', crown)
        if (!instant) {
          // Handle stored so stopIdle can cancel it if the queen is tapped mid-pop.
          const crownTween = this.tweens.add({
            targets: crown,
            scale: (this.cellSize / 62) * 0.9,
            delay: i * juice.spawn.staggerMs,
            duration: juice.spawn.popMs,
            ease: 'Back.easeOut',
          })
          sprite.setData('crownTween', crownTween)
        }
      }

      this.beeSprites.set(occ.id, sprite)
      if (instant) {
        sprite.setScale(this.beeScale)
        // The instant path (undo, rescue rebuild) skips the pop tween, so the
        // shadow has to be shown here or every rewound bee floats.
        ;(sprite.getData('shadow') as Phaser.GameObjects.Ellipse | undefined)?.setScale(1)
        this.startIdle(sprite)
        return
      }
      // The timer handle is kept on the sprite so a tap arriving before the
      // pop fires can cancel it (stopIdle) instead of racing the action tween.
      const spawnTimer = this.time.delayedCall(i * juice.spawn.staggerMs, () => {
        sprite.setData('spawnTimer', undefined)
        const shadow = sprite.getData('shadow') as Phaser.GameObjects.Ellipse | undefined
        if (shadow) this.tweens.add({ targets: shadow, scale: 1, duration: juice.spawn.popMs })
        this.tweens.add({
          targets: sprite,
          scale: this.beeScale,
          duration: juice.spawn.popMs,
          ease: 'Back.easeOut',
          onComplete: () => this.startIdle(sprite),
        })
      })
      sprite.setData('spawnTimer', spawnTimer)
    })
  }

  /**
   * One-line contextual coaching, shown only on the level where a rule first
   * applies.
   */
  private showCoach(): void {
    const id = this.level.id
    const kinds = new Set(this.board.allOccupants().map((o) => o.kind))
    let key:
      | 'coach.tap'
      | 'coach.trail'
      | 'coach.trailDry'
      | 'coach.queen'
      | 'coach.hornet'
      | 'compass.coach'
      | 'compass.coachColor'
      | null = null
    // Compass mode re-teaches the verb set on its first three levels — the
    // rotate-then-fly input is new even to a campaign veteran.
    if (this.compassMode) {
      if (id <= 3) key = 'compass.coach'
      // Colour matching is a SECOND lesson, and it is taught on the levels that
      // FIRST ship coloured doors rather than at a hardcoded id — the campaign
      // introduces them at a different point than the old compass ladder did,
      // and a lesson pinned to an id silently teaches the wrong level the day
      // the curve moves.
      else if (this.isFirstColouredLevels(id)) key = 'compass.coachColor'
    } else if (id === 1) key = 'coach.tap'
    else if (id <= 3) key = 'coach.trail'
    else if (id === 8 || id === 20 || id === 70) key = 'coach.trailDry'
    // Hornet walls first appear at L12 — teach them THEN, not 18 levels later.
    else if (id >= 12 && id <= 14 && kinds.has('hornet')) key = 'coach.hornet'
    else if (id >= 16 && id <= 18 && kinds.has('queen')) key = 'coach.queen'
    if (!key) return

    const banner = this.add
      .text(GAME_WIDTH / 2, layout.movesPillY + 108, t(key), {
        fontFamily: FONT_STACK,
        fontSize: '24px',
        color: this.theme.accentCss,
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 120 },
      })
      .setOrigin(0.5)
      .setDepth(200)
    this.tweens.add({
      targets: banner,
      alpha: { from: 0, to: 1 },
      duration: 260,
      hold: 4200,
      yoyo: true,
      onComplete: () => banner.destroy(),
    })
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  private buildHud(): void {
    this.add
      .text(GAME_WIDTH / 2, layout.hudTopY, t('hud.level', { n: this.level.id }), {
        fontFamily: FONT_STACK,
        fontSize: '42px',
        color: this.theme.textCss,
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(200)

    // Compass badge: the mode's promise, visible for the whole run.
    if (this.compassMode) {
      const badge = this.add
        .text(GAME_WIDTH / 2, layout.hudTopY + 40, t('hud.compassBadge'), {
          fontFamily: FONT_STACK,
          fontSize: '24px',
          fontStyle: 'bold',
          color: '#0b2a3a',
          backgroundColor: '#7fd6ff',
          padding: { x: 14, y: 5 },
        })
        .setOrigin(0.5)
        .setDepth(200)
      badge.setScale(0)
      this.tweens.add({ targets: badge, scale: 1, duration: 400, ease: 'Back.easeOut', delay: 250 })
    }

    // Sticky Hive badge: the special-level promise, visible for the whole run.
    if (this.level.flooded) {
      const badge = this.add
        .text(GAME_WIDTH / 2, layout.hudTopY + 40, t('hud.stickyHive'), {
          fontFamily: FONT_STACK,
          fontSize: '24px',
          fontStyle: 'bold',
          color: '#3a2708',
          backgroundColor: '#ffc93d',
          padding: { x: 14, y: 5 },
        })
        .setOrigin(0.5)
        .setDepth(200)
      badge.setScale(0)
      this.tweens.add({ targets: badge, scale: 1, duration: 400, ease: 'Back.easeOut', delay: 250 })
    }

    // Moves pill with an accent ring — kept as a field so the doomed state can
    // redraw it red and pulse it.
    this.movesPillGfx = this.add.graphics().setDepth(200)
    this.drawMovesPill(false)

    this.add
      .text(GAME_WIDTH / 2, layout.movesPillY + 26, t('hud.moves'), {
        fontFamily: FONT_STACK,
        fontSize: '20px',
        color: this.theme.textCss,
      })
      .setOrigin(0.5)
      .setDepth(200)
      .setAlpha(0.65)

    this.movesText = this.add
      .text(GAME_WIDTH / 2, layout.movesPillY - 8, String(this.board.movesLeft), {
        fontFamily: FONT_STACK,
        fontSize: '56px',
        color: this.theme.textCss,
      })
      .setOrigin(0.5)
      .setDepth(200)

    // Three mini star pips under the pill: the live "what can this run still
    // earn" readout. The 3rd greys out the moment perfect play can no longer
    // keep enough spare moves — the star economy stops being a black box.
    const pipY = layout.movesPillY + 62
    this.starPips = [0, 1, 2].map((i) =>
      this.add
        .star(GAME_WIDTH / 2 + (i - 1) * 34, pipY, 5, 6, 12.5, colors.starGold)
        .setDepth(200),
    )
    this.updateStarPips()

    makeIconButton(this, 66, layout.hudTopY, '‹', () => transitionTo(this, 'Menu'), 34).setDepth(200)
    this.buildSoundToggle()
    this.buildStreakFlame()
    makeRestartButton(
      this,
      GAME_WIDTH - 66,
      layout.hudTopY,
      () => this.scene.restart({ levelIndex: this.levelIndex }),
      34,
      this.theme.accent,
    ).setDepth(200)
  }

  /** The moves pill chrome; warn=true switches the ring/fill to the alarm red. */
  private drawMovesPill(warn: boolean): void {
    const g = this.movesPillGfx
    g.clear()
    g.fillStyle(warn ? 0x3a0d08 : 0x000000, warn ? 0.55 : 0.34)
    g.fillRoundedRect(GAME_WIDTH / 2 - 116, layout.movesPillY - 48, 232, 96, 30)
    g.lineStyle(3, warn ? 0xff6b57 : this.theme.accent, 0.8)
    g.strokeRoundedRect(GAME_WIDTH / 2 - 116, layout.movesPillY - 48, 232, 96, 30)
  }

  /**
   * Grey out star pips the run can no longer earn. Best case from here is one
   * tap per remaining bee, so the spare (against the level's REAL budget — the
   * silent easing bonus must not flatter the projection) is
   * budget - movesUsed - remaining; the 3rd star needs threeStarSpare of it.
   * A revive caps the run at 1 star, so it greys the 2nd too.
   */
  private updateStarPips(): void {
    if (this.starPips.length === 0) return
    // Hop-aware bound (goals + honey on their exit rays): on honeyed boards
    // "one tap per bee" flatters the projection badly — a flooded board's true
    // remainder is 2-3x the bee count, and the pips would stay gold to the end.
    // With a Honey Cleaner in stock only the bee count is guaranteed (a clean
    // wipes a lane in one tap), so fall back rather than grey a reachable star.
    const remainderBound =
      saveManager.powerupCount('clean') > 0 ? this.board.remaining : estimateMinMoves(this.board)
    const bestSpare = this.level.moveBudget - this.board.movesUsed - remainderBound
    const threeGone = this.usedRevive || bestSpare < this.level.threeStarSpare
    const twoGone = this.usedRevive
    const set = (pip: Phaser.GameObjects.Star, gone: boolean): void => {
      pip.setFillStyle(gone ? colors.starEmpty : colors.starGold)
      pip.setAlpha(gone ? 0.55 : 1)
    }
    set(this.starPips[0], false)
    set(this.starPips[1], twoGone)
    set(this.starPips[2], threeGone)
  }

  /**
   * Win-streak flame beside the moves pill — only once a streak exists.
   * Consecutive wins multiply the honey haul; the flame is the visible stake.
   */
  private buildStreakFlame(): void {
    const streak = saveManager.winStreak
    if (streak < 2) return
    const c = this.add.container(GAME_WIDTH / 2 + 146, layout.movesPillY - 26).setDepth(200)
    const flame = this.add.image(0, 0, ensureFlameTexture(this, 44))
    c.add(flame)
    c.add(
      this.add
        .text(1, 6, t('hud.streakCount', { n: streak }), {
          fontFamily: FONT_STACK,
          fontSize: '17px',
          color: '#5a2404',
        })
        .setOrigin(0.5),
    )
    this.tweens.add({
      targets: flame,
      scaleX: 1.1,
      scaleY: 0.94,
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  /** In-level sound toggle — muting must not require leaving to the Home screen. */
  private buildSoundToggle(): void {
    const btn = makeIconButton(
      this,
      GAME_WIDTH - 66 - 78,
      layout.hudTopY,
      '♪',
      () => {
        const next = !saveManager.get().settings.sfx
        saveManager.updateSettings({ sfx: next })
        btn.setAlpha(next ? 1 : 0.45)
      },
      26,
    )
    btn.setDepth(200)
    btn.setAlpha(saveManager.get().settings.sfx ? 1 : 0.45)
  }

  // ── Power-ups ───────────────────────────────────────────────────────────────

  private buildPowerupBar(): void {
    // Honey balance chip (top-left, clear of the back button + banner-safe
    // area). It doubles as the in-level Shop door: the game pauses underneath,
    // so buying honey mid-puzzle never costs the player their board.
    const chip = this.add.container(168, layout.hudTopY).setDepth(200)
    const cg = this.add.graphics()
    cg.fillStyle(0x000000, 0.32)
    cg.fillRoundedRect(-56, -22, 112, 44, 22)
    cg.lineStyle(2, this.theme.accent, 0.6)
    cg.strokeRoundedRect(-56, -22, 112, 44, 22)
    chip.add(cg)
    chip.add(drawHoneyDrop(this, -36, 0, 10))
    this.honeyChip = this.add
      .text(-16, 0, String(saveManager.honey), { fontFamily: FONT_STACK, fontSize: '22px', color: this.theme.textCss })
      .setOrigin(0, 0.5)
    chip.add(this.honeyChip)
    chip.add(
      this.add
        .text(44, 0, '＋', { fontFamily: FONT_STACK, fontSize: '24px', color: this.theme.accentCss })
        .setOrigin(0.5),
    )
    const chipHit = this.add.rectangle(0, 0, 112, 44, 0, 0).setInteractive({ useHandCursor: true })
    chip.add(chipHit)
    chipHit.on('pointerdown', () => {
      if (this.inputLocked || this.powerupBusy) return
      feedback.tap()
      this.openShopOverlay()
    })

    const n = POWERUP_KEYS.length
    const gap = 14
    const w = Math.min(200, (GAME_WIDTH - 2 * layout.boardPaddingX - (n - 1) * gap) / n)
    const totalW = n * w + (n - 1) * gap
    let x = (GAME_WIDTH - totalW) / 2 + w / 2
    for (const key of POWERUP_KEYS) {
      this.makePowerupButton(key, x, layout.powerupBarY, w)
      x += w + gap
    }
    this.refreshPowerupCounts()
  }

  private makePowerupButton(key: PowerupKey, x: number, y: number, w: number): void {
    const def = POWERUPS[key]
    const h = 86
    const c = this.add.container(x, y).setDepth(200)
    const cardKey = ensureCardTexture(this, colors.buttonSecondary, this.theme.accent, w, h)
    c.add(this.add.image(0, 0, cardKey))
    c.add(this.add.image(0, -14, ensurePowerupIconTexture(this, key, 52)))
    c.add(
      this.add
        .text(0, 26, t(def.nameKey), {
          fontFamily: FONT_STACK,
          fontSize: '15px',
          color: this.theme.textCss,
          align: 'center',
          wordWrap: { width: w - 10 },
        })
        .setOrigin(0.5)
        .setShadow(0, 1, 'rgba(0,0,0,0.4)', 2),
    )
    c.add(this.add.image(w / 2 - 16, -h / 2 + 16, ensureBadgeTexture(this, this.theme.accent, 15)))
    const count = this.add
      .text(w / 2 - 16, -h / 2 + 15, '0', { fontFamily: FONT_STACK, fontSize: '19px', color: '#241a0c' })
      .setOrigin(0.5)
    c.add(count)
    const hit = this.add.rectangle(0, 0, w, h, 0, 0).setInteractive({ useHandCursor: true })
    c.add(hit)
    let pressed = false
    hit.on('pointerdown', () => {
      pressed = true
      this.tweens.add({ targets: c, scale: 0.94, duration: 60 })
    })
    hit.on('pointerout', () => {
      pressed = false
      this.tweens.add({ targets: c, scale: 1, duration: 60 })
    })
    hit.on('pointerup', () => {
      this.tweens.add({ targets: c, scale: 1, duration: 60 })
      if (!pressed) return
      pressed = false
      this.onPowerupTap(key)
    })
    this.powerupBtns.set(key, { count })
    this.powerupContainers.set(key, c)
  }

  private refreshPowerupCounts(): void {
    for (const key of POWERUP_KEYS) {
      const btn = this.powerupBtns.get(key)
      if (btn) btn.count.setText(String(saveManager.powerupCount(key)))
    }
    if (this.honeyChip) this.honeyChip.setText(String(saveManager.honey))
  }

  /** Open the Shop OVER the paused board — the level survives the detour. */
  private openShopOverlay(): void {
    this.pending = undefined
    this.previewGfx.clear()
    if (this.cleanArmed) this.exitCleanMode()
    this.scene.pause()
    this.scene.launch('Shop', { overlay: true, returnTo: 'Game' })
  }

  private onSceneResume(): void {
    this.refreshPowerupCounts()
  }

  private onPowerupTap(key: PowerupKey): void {
    if (this.powerupBusy || this.inputLocked) return
    // Cleaner is a toggle; tapping it again (or another power-up) disarms it.
    if (this.cleanArmed) {
      this.exitCleanMode()
      if (key === 'clean') return
    }
    if (this.board.status !== 'playing') return
    if (saveManager.powerupCount(key) <= 0) {
      void this.offerGetPowerup(key)
      return
    }
    feedback.tap()
    if (key === 'clean') this.armClean()
    else if (key === 'undo') this.doUndo()
    else if (key === 'moves') this.useMoves()
  }

  private armClean(): void {
    this.cleanArmed = true
    const c = this.powerupContainers.get('clean')
    c?.setScale(1.08)
    this.cleanHint?.destroy()
    const hint = this.add.container(GAME_WIDTH / 2, layout.movesPillY + 108).setDepth(210)
    const hg = this.add.graphics()
    hg.fillStyle(0x000000, 0.55)
    hg.fillRoundedRect(-190, -22, 380, 44, 22)
    hint.add(hg)
    hint.add(
      this.add
        .text(0, 0, t('powerup.tapTarget'), { fontFamily: FONT_STACK, fontSize: '20px', color: '#ffe08a' })
        .setOrigin(0.5),
    )
    this.cleanHint = hint
  }

  private exitCleanMode(): void {
    this.cleanArmed = false
    this.powerupContainers.get('clean')?.setScale(1)
    this.cleanHint?.destroy()
    this.cleanHint = undefined
  }

  private useMoves(): void {
    if (!saveManager.usePowerup('moves')) return
    this.board.grantExtraMoves(MOVES_POWERUP_AMOUNT)
    this.updateMovesHud()
    this.refreshPowerupCounts()
    feedback.escape(1)
  }

  private doUndo(): void {
    if (this.history.length === 0) {
      this.flashToast(t('powerup.undo.nothing'))
      return
    }
    if (!saveManager.usePowerup('undo')) return
    const entry = this.history.pop()
    if (!entry) return
    // The snapshot predates any budget extension bought/earned since (the +3
    // Moves power-up, the ad revive). Top it up to the live budget so undo can
    // never destroy moves the player paid real value for.
    const budgetGap = this.board.moveBudget - entry.board.moveBudget
    if (budgetGap > 0) entry.board.grantExtraMoves(budgetGap)
    // A Honey Cleaner consumed by the reverted move comes back — undoing must
    // not cost two consumables just to stand where you already stood.
    if (entry.cleanSpent) saveManager.grantPowerup('clean', 1)
    this.board = entry.board
    this.pending = undefined
    this.previewGfx.clear()
    this.rebuildBoardView()
    this.updateMovesHud()
    this.refreshPowerupCounts()
    feedback.undo()
  }

  /**
   * If the move just played SEALED the hive, take it back — and charge a move
   * for it.
   *
   * This is the single biggest change to how the game feels, and it comes
   * straight out of the session measurements: 99% of losses were the board
   * sealing shut rather than the budget running out, the player still held ~3.8
   * moves when it happened, and 2-3 bees were always stranded, never one. So a
   * loss never said "I almost had it" — it said "there is nothing left to try",
   * which is the worst thing a puzzle can say to someone deciding whether to
   * tap Retry. It also made the move budget an inert dial (widening it 1 → 4
   * moved the win rate 32% → 33%) and flattened stars, because you either
   * played the exact optimum or died.
   *
   * Rewinding turns a positional death into a price. The move is still spent —
   * a FREE rewind would make the game "tap everything until something works" —
   * so repeated mistakes still run the budget down and the run still ends, just
   * with one bee left instead of a locked board.
   *
   * Returns true when it handled the move, so the caller stops there.
   */
  private rescueIfSealed(): boolean {
    if (!this.board.isSealed()) return false
    const entry = this.history.pop()
    if (!entry) return false // opening position: nothing to step back to

    // Same budget/consumable bookkeeping undo does — a rescue must never
    // destroy moves or charges the player paid for.
    const budgetGap = this.board.moveBudget - entry.board.moveBudget
    if (budgetGap > 0) entry.board.grantExtraMoves(budgetGap)
    if (entry.cleanSpent) saveManager.grantPowerup('clean', 1)

    this.board = entry.board
    this.board.chargeMove() // the mistake costs a move, just not the board
    this.pending = undefined
    this.previewGfx.clear()
    this.rebuildBoardView()
    this.updateMovesHud()
    this.refreshPowerupCounts()
    feedback.bump()
    this.flashToast(t('hud.sealed'))

    // Charging the move can itself end the run — that is the point. Losing now
    // means the budget ran out, which is the loss the player can learn from.
    if (this.board.status !== 'playing') {
      this.resolveAfterAction()
      return true
    }
    return true
  }

  /**
   * Tear down and respawn all board visuals from the (restored) board state.
   * Sprites come back instantly (no spawn stagger) so the undo reads as a
   * precise step back; honey removed by the restore fades out.
   */
  private rebuildBoardView(): void {
    for (const sprite of this.beeSprites.values()) {
      ;(sprite.getData('arrow') as Phaser.GameObjects.Image | undefined)?.destroy()
      ;(sprite.getData('crown') as Phaser.GameObjects.Image | undefined)?.destroy()
      ;(sprite.getData('shadow') as Phaser.GameObjects.Ellipse | undefined)?.destroy()
      this.tweens.killTweensOf(sprite)
      sprite.destroy()
    }
    this.beeSprites.clear()
    for (const hornet of this.hornetSprites.values()) {
      this.tweens.killTweensOf(hornet)
      hornet.destroy()
    }
    this.hornetSprites.clear()
    this.refreshHoney(true)
    this.spawnOccupants(true)
  }

  private async offerGetPowerup(key: PowerupKey): Promise<void> {
    if (this.powerupBusy) return
    this.powerupBusy = true
    const def = POWERUPS[key]
    const canAd = adService.canOfferRewarded()
    const canHoney = saveManager.honey >= def.honeyCost

    // Rows: honey buy (or a greyed "not enough honey" line), optional ad,
    // always a Shop door, always Cancel — there must never be a dead end where
    // a broke player meets a modal with nothing but Cancel in it.
    const rows = 2 + (canAd ? 1 : 0) + 1
    const half = 150 + rows * 37

    const modal = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(400)
    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6)
      .setInteractive()
    modal.add(dim)
    const panel = this.add.graphics()
    panel.fillStyle(0x2a1c0c, 1)
    panel.fillRoundedRect(-250, -half, 500, half * 2, 28)
    panel.lineStyle(3, this.theme.accent, 0.8)
    panel.strokeRoundedRect(-250, -half, 500, half * 2, 28)
    modal.add(panel)
    modal.add(this.add.image(0, -half + 52, ensurePowerupIconTexture(this, key, 72)))
    modal.add(
      this.add
        .text(0, -half + 98, t(def.nameKey), { fontFamily: FONT_STACK, fontSize: '30px', color: '#fff3d6' })
        .setOrigin(0.5),
    )
    modal.add(
      this.add
        .text(0, -half + 148, t(def.descKey), {
          fontFamily: FONT_STACK,
          fontSize: '18px',
          color: '#d9c39a',
          align: 'center',
          wordWrap: { width: 440 },
        })
        .setOrigin(0.5),
    )

    const close = (): void => {
      modal.destroy()
      // Deferred a tick ON PURPOSE: the dim closes on pointerdown, and Phaser
      // runs this handler BEFORE the scene-level POINTER_DOWN. Clearing the
      // flag synchronously let that same gesture press (and its release fly)
      // whatever bee sat under the dismiss tap — including the queen.
      this.time.delayedCall(0, () => {
        this.powerupBusy = false
      })
    }
    let y = -half + 216
    if (canHoney) {
      const buy = makeButton(
        this,
        0,
        y,
        t('powerup.buyHoney', { cost: def.honeyCost }),
        () => {
          if (saveManager.spendHoney(def.honeyCost)) {
            saveManager.grantPowerup(key, 1)
            this.refreshPowerupCounts()
          }
          close()
        },
        { width: 300, height: 60, fontSize: 24, accent: 0xffb020 },
      )
      buy.addAt(drawHoneyDrop(this, -126, 0, 11), buy.length - 1)
      modal.add(buy)
      y += 74
    } else {
      modal.add(
        this.add
          .text(0, y, t('powerup.needHoney', { cost: def.honeyCost }), {
            fontFamily: FONT_STACK,
            fontSize: '20px',
            color: '#a08a66',
          })
          .setOrigin(0.5),
      )
      y += 74
    }
    if (canAd) {
      modal.add(
        makeButton(
          this,
          0,
          y,
          t('powerup.watchAd'),
          () => {
            close()
            void this.watchAdForPowerup(key)
          },
          { width: 300, height: 60, fontSize: 24, primary: false },
        ),
      )
      y += 74
    }
    modal.add(
      makeButton(
        this,
        0,
        y,
        t('powerup.goShop'),
        () => {
          close()
          this.openShopOverlay()
        },
        { width: 300, height: 60, fontSize: 24, primary: false },
      ),
    )
    y += 74
    modal.add(
      makeButton(this, 0, y, t('powerup.cancel'), close, { width: 300, height: 56, fontSize: 22, primary: false }),
    )
    dim.on('pointerdown', close)
  }

  private async watchAdForPowerup(key: PowerupKey): Promise<void> {
    const ok = await adService.showRewarded()
    if (!this.scene.isActive('Game')) return
    if (ok) {
      saveManager.grantPowerup(key, 1)
      this.refreshPowerupCounts()
    } else {
      this.flashToast(t('ads.notReady'))
    }
  }

  private flashToast(msg: string): void {
    // Below the star pips (movesPillY+62), transient, above the board's top.
    const toast = this.add
      .text(GAME_WIDTH / 2, layout.movesPillY + 108, msg, {
        fontFamily: FONT_STACK,
        fontSize: '20px',
        color: '#ffe08a',
        backgroundColor: '#000000aa',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(210)
    this.tweens.add({ targets: toast, alpha: 0, duration: 900, delay: 500, onComplete: () => toast.destroy() })
  }

  private updateMovesHud(): void {
    this.movesText.setText(String(this.board.movesLeft))
    // Hop-aware bound instead of a bare bee count: honey on the exit rays is
    // guaranteed extra taps, so on honeyed (and especially flooded) boards the
    // bare count under-warned — the alarm arrived at the very end or never.
    // EXCEPT while the player holds a Honey Cleaner: one clean flight wipes a
    // whole lane without a landing, so only the bee count is truly guaranteed
    // then — the alarm must never call a savable board lost.
    const bound =
      saveManager.powerupCount('clean') > 0 ? this.board.remaining : estimateMinMoves(this.board)
    const doomed = this.board.status === 'playing' && this.board.movesLeft < bound
    this.movesText.setColor(doomed ? colors.hudWarnCss : this.theme.textCss)
    this.movesText.setScale(1)
    this.tweens.add({
      targets: this.movesText,
      scale: juice.ui.counterPunchScale,
      duration: juice.ui.counterPunchMs,
      yoyo: true,
      ease: 'Quad.easeOut',
    })
    this.updateStarPips()

    // Doomed = fewer moves than bees: mathematically lost unless the player
    // adds moves or restarts. A red number alone was invisible while staring at
    // the board — pulse the pill, buzz once, and say the way out, exactly once
    // per doomed episode (undo / +moves / revive clears it).
    if (doomed && !this.wasDoomed) {
      this.wasDoomed = true
      this.drawMovesPill(true)
      feedback.warning()
      this.flashToast(t('hud.doomed'))
      this.movesPillPulse = this.tweens.add({
        targets: this.movesPillGfx,
        alpha: juice.ui.doomedPulseAlpha,
        duration: juice.ui.doomedPulseMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    } else if (!doomed && this.wasDoomed) {
      this.wasDoomed = false
      this.movesPillPulse?.remove()
      this.movesPillPulse = undefined
      this.movesPillGfx.setAlpha(1)
      this.drawMovesPill(false)
    }
  }

  // ── Input (press to aim, release to fly) ────────────────────────────────────

  private cellAt(pointer: Phaser.Input.Pointer): Axial {
    return pixelToAxial(pointer.worldX - this.origin.x, pointer.worldY - this.origin.y, this.cellSize)
  }

  /** Press a tappable occupant → show where it will fly (green safe / red bad). */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    feedback.unlock() // first user gesture resumes the audio context (iOS)
    // powerupBusy = the get-power-up modal is open. Scene-level pointer events
    // still fire UNDER the modal, so without this guard a tap on a modal button
    // that overlaps a bee would press-and-commit that bee's flight.
    if (this.inputLocked || this.powerupBusy || this.board.status !== 'playing') return
    const cell = this.cellAt(pointer)
    const occ = this.board.occupantAt(cell.q, cell.r)
    if (!occ) return
    if (!occ.isTappable()) {
      // A wall that LOOKS tappable must answer the tap: dead silence reads as
      // broken input. A dull thud + a stubborn wobble says "immovable".
      feedback.deny()
      const hornet = this.hornetSprites.get(`${occ.q},${occ.r}`)
      if (hornet) {
        // The tap may land mid-spawn-pop; killing that tween would freeze the
        // wall at a partial scale forever, so pin the final scale first.
        this.tweens.killTweensOf(hornet)
        hornet.setScale(this.beeScale)
        hornet.setAngle(0)
        this.tweens.add({
          targets: hornet,
          angle: { from: -4, to: 4 },
          duration: 45,
          yoyo: true,
          repeat: 2,
          ease: 'Sine.easeInOut',
          onComplete: () => hornet.setAngle(0),
        })
      }
      return
    }
    this.pending = { occ, q: cell.q, r: cell.r }
    this.launchArmed = false
    // Compass: a SHORT press turns the bee, a LONG press launches it. The
    // player cannot feel a millisecond threshold, so the moment it passes we
    // say so — a tick, and the lane preview goes solid. Without that signal the
    // control is a coin flip.
    this.armTimer?.remove(false)
    this.armTimer = this.compassMode
      ? this.time.delayedCall(LAUNCH_HOLD_MS, () => {
          if (!this.pending) return
          this.launchArmed = true
          feedback.press()
          this.previewGfx.setAlpha(1)
        })
      : undefined
    if (this.compassMode) this.previewGfx.setAlpha(juice.press.previewDimAlpha)
    this.drawPreview(occ)
    // The grab itself must be felt: soft tick + the bee lifts under the finger.
    feedback.press()
    const sprite = this.beeSprites.get(occ.id)
    if (sprite) {
      this.tweens.killTweensOf(sprite)
      this.tweens.add({
        targets: sprite,
        scale: this.beeScale * juice.press.liftScale,
        duration: juice.press.liftMs,
        ease: 'Quad.easeOut',
      })
    }
  }

  /**
   * While aiming: sliding off the pressed bee dims the preview and drops the
   * lift — the standard "release to cancel" affordance, now actually visible.
   */
  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const pending = this.pending
    if (!pending) return
    const cell = this.cellAt(pointer)
    const onTarget = cell.q === pending.q && cell.r === pending.r
    this.previewGfx.setAlpha(onTarget ? 1 : juice.press.cancelAlpha)
    const sprite = this.beeSprites.get(pending.occ.id)
    if (sprite && sprite.active) {
      const target = onTarget ? this.beeScale * juice.press.liftScale : this.beeScale
      if (Math.abs(sprite.scaleX - target) > 0.001) {
        this.tweens.killTweensOf(sprite)
        this.tweens.add({ targets: sprite, scale: target, duration: juice.press.liftMs })
      }
    }
  }

  /** Release on the same occupant → commit the flight. Release elsewhere → cancel. */
  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const pending = this.pending
    this.pending = undefined
    this.previewGfx.clear()
    this.previewGfx.setAlpha(1)
    if (!pending || this.inputLocked || this.powerupBusy || this.board.status !== 'playing') return

    const cell = this.cellAt(pointer)
    if (this.compassMode) {
      this.armTimer?.remove(false)
      this.armTimer = undefined
      // Released off the bee cancels, exactly as in the campaign.
      if (cell.q !== pending.q || cell.r !== pending.r) {
        const lifted = this.beeSprites.get(pending.occ.id)
        if (lifted && lifted.active) this.startIdle(lifted)
        return
      }
      // SHORT press turns the bee (free), LONG press launches it. Aiming and
      // committing are the two verbs of the mode, and putting them on the same
      // finger — one gesture, two durations — is what lets a bee be turned
      // several times and then sent without ever moving the hand.
      //
      // Decided from the gesture's OWN timestamps, not from whether the arming
      // timer got to run. Both come off the DOM events, so they say when the
      // finger actually moved. `launchArmed` only says whether a scene timer
      // fired first: stall the loop for 300 ms and a 80 ms tap is delivered
      // AFTER the 260 ms timer, launching a bee the player meant to turn — a
      // spent move in a game where the budget is the whole difficulty dial.
      // The timer stays: it is what makes the threshold visible and felt.
      const heldMs = pointer.upTime - pointer.downTime
      const longPress = heldMs > 0 ? heldMs >= LAUNCH_HOLD_MS : this.launchArmed
      if (!longPress) {
        this.rotatePending(pending)
        return
      }
    } else if (cell.q !== pending.q || cell.r !== pending.r) {
      // Released off the bee → cancel; settle the lifted sprite back to rest.
      const lifted = this.beeSprites.get(pending.occ.id)
      if (lifted && lifted.active) this.startIdle(lifted)
      return
    }

    const occ = pending.occ
    // Fetch the sprite BEFORE mutating state, so a (currently-unreachable)
    // missing sprite can never silently consume a move and skip resolution.
    const sprite = this.beeSprites.get(occ.id)
    if (!sprite) return

    // Honey Cleaner: this tap wipes honey instead of laying it, and is consumed.
    const cleaning = this.cleanArmed
    if (cleaning) {
      if (!saveManager.usePowerup('clean')) {
        this.exitCleanMode()
        return
      }
      this.exitCleanMode()
      this.refreshPowerupCounts()
    }

    // Snapshot for Undo (bounded), taken before the state changes; remembers a
    // spent Cleaner so undoing the move can refund it.
    this.history.push({ board: this.board.clone(), cleanSpent: cleaning })
    if (this.history.length > 40) this.history.shift()

    const outcome = cleaning
      ? this.board.tapClean(pending.q, pending.r)
      : this.board.tap(pending.q, pending.r)
    if (!outcome) {
      const entry = this.history.pop() // nothing happened; discard the snapshot
      if (entry?.cleanSpent) saveManager.grantPowerup('clean', 1)
      return
    }

    this.updateMovesHud()
    this.inputLocked = true
    this.stopIdle(sprite)
    this.beginFlightPose(sprite, occ)

    if (outcome.kind === 'escaped') {
      // The queen leaving EARLY is the game's worst moment — it must never be
      // scored like a triumph. No combo, no happy chime, no gold burst.
      const fatal = occ.kind === 'queen' && this.board.queenLeftEarly
      if (fatal) {
        this.comboCount = 0
        feedback.queenFail()
        sprite.setTint(0xff9090)
        this.animateEscape(occ, sprite, outcome, false)
      } else {
        const now = this.time.now
        this.comboCount =
          now - this.lastEscapeAt <= juice.escape.comboWindowMs ? this.comboCount + 1 : 1
        this.lastEscapeAt = now
        feedback.escape(this.comboCount)
        this.animateEscape(occ, sprite, outcome)
      }
    } else if (outcome.kind === 'stuck') {
      this.comboCount = 0
      feedback.stuck()
      this.animateStuck(occ, sprite, outcome)
    } else if (outcome.kind === 'parked') {
      // Rush Hive: the bee travelled and stopped. It is a move that changed the
      // board, not a failure, so it keeps the flight read — no bump buzz.
      this.comboCount = 0
      feedback.stuck()
      this.animatePark(occ, sprite, outcome)
    } else {
      this.comboCount = 0
      feedback.bump()
      this.animateBump(occ, sprite, outcome)
    }
  }


  /**
   * Is this one of the first few levels to carry COLOURED doors? Answered from
   * the ladder itself, so the colour lesson lands wherever the curve happens to
   * introduce matching.
   */
  private isFirstColouredLevels(id: number): boolean {
    const coloured = (l: LevelData | undefined): boolean =>
      !!l && (l.gates ?? []).some((g) => g[3] !== GATE_ANY)
    if (!coloured(this.level)) return false
    const at = (levelId: number): LevelData | undefined => {
      const idx = levelId - 1
      if (idx < 0) return undefined
      return this.compassLadder ? getCompassLevel(idx) : getLevel(idx)
    }
    // Within three levels of the first coloured one.
    for (let back = 1; back <= 3; back++) {
      if (!coloured(at(id - back))) return true
    }
    return false
  }

  /**
   * Compass rotation: turn the pressed bee one direction step, swing its aim
   * arrow, and redraw the lane preview so the next release can commit it.
   * Free — flights are the only budget cost in this mode.
   */
  private rotatePending(pending: { occ: CellOccupant; q: number; r: number }): void {
    const dir = this.board.rotate(pending.q, pending.r)
    if (dir === undefined) return
    feedback.press()
    const sprite = this.beeSprites.get(pending.occ.id)
    if (sprite && sprite.active) {
      const angle = directionAngle(dir)
      const off = sprite.getData('arrowOff') as number
      const arrow = sprite.getData('arrow') as Phaser.GameObjects.Image | undefined
      if (arrow) {
        this.tweens.add({
          targets: arrow,
          x: sprite.x + Math.cos(angle) * off,
          y: sprite.y + Math.sin(angle) * off,
          rotation: angle,
          duration: 110,
          ease: 'Quad.easeOut',
        })
      }
      sprite.setData('arrowAngle', angle)
      // The body carries the heading now, so a rotation has to turn the bee
      // itself — otherwise the chevron swings and the bee keeps facing the old
      // way. startIdle (next line) restores the pose from faceRot.
      sprite.setData('faceRot', angle + Math.PI / 2)
      this.startIdle(sprite)
    }
    this.drawPreview(pending.occ)
  }

  /** Draw the flight-path preview for a pressed occupant. */
  private drawPreview(occ: CellOccupant): void {
    // The armed Honey Cleaner flies THROUGH honey and wipes it — previewing the
    // normal sticky trace would show the exact opposite of what release does.
    const cleaning = this.cleanArmed
    const outcome = cleaning ? this.board.previewClean(occ) : this.board.trace(occ)
    const start = this.cellToWorld(occ.q, occ.r)
    const { ux, uy } = this.flightUnit(occ)
    const stepPx = neighborDistance(this.cellSize)
    const willViolate =
      occ.kind === 'queen' && this.board.remaining > 1 && outcome.kind === 'escaped'

    // green = clean escape, amber = will stick on honey, red = bump / queen early.
    // Getting stuck is a legal move even for the queen (she stays on the board),
    // so only an *escaping* queen-with-others-left is painted bad.
    let mode: 'safe' | 'stuck' | 'bad'
    if (outcome.kind === 'stuck') mode = 'stuck'
    else if (outcome.kind === 'escaped' && !willViolate) mode = 'safe'
    else mode = 'bad'
    const color = mode === 'safe' ? 0x5dff9b : mode === 'stuck' ? 0xffb43a : 0xff5a5a

    const cells = outcome.path.length + 1
    const dist = outcome.kind === 'blocked' ? stepPx * cells - stepPx * 0.5 : stepPx * cells
    const ex = start.x + ux * dist
    const ey = start.y + uy * dist

    const g = this.previewGfx
    g.clear()

    if (cleaning) {
      // Cool "wipe" tint over the honey this flight will CLEAR (start cell +
      // every honey cell crossed) — the opposite story of the amber lay-preview.
      g.fillStyle(0x9be8ff, 0.4)
      const startsOnHoney = this.board.isSticky(occ.q, occ.r)
      if (startsOnHoney) {
        g.fillPoints(hexPoints(start.x, start.y, this.cellSize * 0.88), true)
      }
      for (const cell of outcome.path) {
        if (!this.board.isSticky(cell.q, cell.r)) continue
        const p = this.cellToWorld(cell.q, cell.r)
        g.fillPoints(hexPoints(p.x, p.y, this.cellSize * 0.88), true)
      }
    } else {
      // Show the honey this flight is about to leave behind. That mess is the
      // real cost of the move — without it the player only learns about the
      // trail after it has already cost them the level. Strong fill + a dark
      // amber rim, because a 0.32-alpha wash disappeared on amber-brown themes.
      for (const cell of outcome.path) {
        const p = this.cellToWorld(cell.q, cell.r)
        const pts = hexPoints(p.x, p.y, this.cellSize * 0.8)
        g.fillStyle(0xf3a712, 0.45)
        g.fillPoints(pts, true)
        g.lineStyle(3, 0x8a5200, 0.7)
        g.strokePoints(pts, true, true)
      }
    }

    g.lineStyle(Math.max(6, this.cellSize * 0.16), color, 0.85)
    g.beginPath()
    g.moveTo(start.x, start.y)
    g.lineTo(ex, ey)
    g.strokePath()

    const head = this.cellSize * 0.34
    const px = -uy
    const py = ux
    g.fillStyle(color, 0.95)
    if (mode === 'safe') {
      g.fillTriangle(
        ex + ux * head,
        ey + uy * head,
        ex - ux * head * 0.4 + px * head * 0.7,
        ey - uy * head * 0.4 + py * head * 0.7,
        ex - ux * head * 0.4 - px * head * 0.7,
        ey - uy * head * 0.4 - py * head * 0.7,
      )
    } else if (mode === 'stuck') {
      // A filled drop at the honey cell = "it will get stuck here".
      g.fillCircle(ex, ey, this.cellSize * 0.24)
      g.lineStyle(Math.max(4, this.cellSize * 0.08), 0x7a4a00, 0.9)
      g.strokeCircle(ex, ey, this.cellSize * 0.24)
    } else {
      const s = this.cellSize * 0.26
      g.lineStyle(Math.max(6, this.cellSize * 0.14), color, 0.95)
      g.beginPath()
      g.moveTo(ex - s + px * s, ey - s + py * s)
      g.lineTo(ex + s - px * s, ey + s - py * s)
      g.moveTo(ex - s - px * s, ey - s - py * s)
      g.lineTo(ex + s + px * s, ey + s + py * s)
      g.strokePath()
    }
  }

  // ── Animations ────────────────────────────────────────────────────────────

  private flightUnit(occ: CellOccupant): { ux: number; uy: number } {
    const angle = directionAngle(occ.dir)
    return { ux: Math.cos(angle), uy: Math.sin(angle) }
  }

  /**
   * Put a bee into its flying pose: flap the wings and swing it round to point the
   * way it is about to travel. The sprite is drawn head-up, so facing direction θ
   * is a rotation of θ + 90°. Rest pose (upright, static) is restored by startIdle.
   */
  private beginFlightPose(sprite: Phaser.GameObjects.Sprite, occ: CellOccupant): void {
    sprite.play(`${sprite.texture.key}-fly`, true)
    // Snap to face the flight direction immediately (not a gradual turn): escapes
    // are quick, and a round bee mid-turn reads as "never turned".
    this.faceBee(sprite, occ.dir)
  }

  /**
   * Point a bee along `dir`. The body art faces EAST and `directionAngle` gives
   * 0 for east, so the rotation is the angle itself — but a bee aimed westward
   * would then be flying belly-up, so it is MIRRORED instead of turned past
   * vertical. That is the standard side-view trick and the reason this is one
   * helper rather than a `setRotation` at each call site.
   */
  private faceBee(sprite: Phaser.GameObjects.Sprite, dir: Direction): void {
    const a = directionAngle(dir)
    const leftward = Math.cos(a) < -1e-6
    sprite.setRotation(a)
    sprite.setFlipY(leftward)
    sprite.setData('faceRot', a)
    sprite.setData('faceFlip', leftward)
  }

  private animateEscape(
    occ: CellOccupant,
    sprite: Phaser.GameObjects.Sprite,
    outcome: EscapedOutcome,
    celebrate = true,
  ): void {
    const stepPx = neighborDistance(this.cellSize)
    const { ux, uy } = this.flightUnit(occ)
    const cellsToEdge = outcome.path.length + 1
    const edgeDist = stepPx * (cellsToEdge - 0.5)
    const totalDist = stepPx * cellsToEdge + juice.flight.overshootPx
    const duration = Math.max(
      juice.flight.minDurationMs,
      (totalDist / stepPx) * juice.flight.msPerCell,
    )
    const arcH = juice.flight.arcFactor * this.cellSize
    const sx = sprite.x
    const sy = sprite.y

    sprite.setDepth(100)
    const trailCfg = juice.flight.trail
    const trail = this.add.particles(0, 0, 'dot', {
      follow: sprite,
      frequency: trailCfg.frequencyMs,
      speed: { min: trailCfg.speedMin, max: trailCfg.speedMax },
      scale: { start: trailCfg.scaleStart, end: 0 },
      alpha: { start: trailCfg.alphaStart, end: 0 },
      lifespan: trailCfg.lifespanMs,
      tint: celebrate ? colors.honeyParticle : 0xff6b57,
      blendMode: Phaser.BlendModes.ADD,
    })
    trail.setDepth(99)

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      ease: juice.flight.ease,
      onUpdate: (tween) => {
        const v = tween.getValue() ?? 0
        const d = totalDist * v
        const arc = arcH * Math.sin(Math.PI * v)
        sprite.x = sx + ux * d - uy * arc
        sprite.y = sy + uy * d + ux * arc
        // Streamline while flying: the sprite is turned head-forward, so its local
        // y-axis runs along the flight path — stretch it a touch and pinch across,
        // so the bee clearly reads as darting IN its direction, not just drifting.
        const fs = this.beeScale * (1 + (juice.flight.scaleUp - 1) * v)
        sprite.setScale(fs * 0.9, fs * 1.16)
      },
      onComplete: () => {
        // Let in-flight trail particles fade out instead of vanishing.
        trail.stop()
        this.time.delayedCall(juice.flight.trail.fadeOutMs, () => trail.destroy())
        sprite.destroy()
      },
    })

    // The bee CROSSES the board edge well before the tween ends (it keeps
    // flying overshootPx off-screen purely for looks). Everything that matters
    // resolves at the crossing: burst/shake, and — crucially — the board
    // resolution, so input unlocks for the next chain-tap instead of the player
    // waiting out several hundred ms of cosmetic off-screen flight.
    // Cubic-in easing: distance fraction f is reached at t = cbrt(f).
    const f = Math.min(1, edgeDist / totalDist)
    this.time.delayedCall(duration * Math.cbrt(f), () => {
      if (celebrate) {
        const count =
          juice.escape.burst.count +
          Math.min(juice.escape.comboParticleCap, juice.escape.comboParticleBonus * (this.comboCount - 1))
        this.burstEmitter.explode(count, sx + ux * edgeDist, sy + uy * edgeDist)
        this.cameras.main.shake(juice.escape.shakeMs, juice.escape.shakeIntensity)
      } else {
        // Queen-early loss: an alarm flash, not a celebration.
        this.cameras.main.flash(160, 255, 80, 70)
        this.cameras.main.shake(juice.escape.shakeMs * 2, juice.escape.shakeIntensity * 2)
      }
      // Retire the sprite from play bookkeeping NOW: undo's rebuild and new
      // taps must never touch the despawning cosmetic sprite.
      ;(sprite.getData('crown') as Phaser.GameObjects.Image | undefined)?.destroy()
      ;(sprite.getData('arrow') as Phaser.GameObjects.Image | undefined)?.destroy()
      ;(sprite.getData('shadow') as Phaser.GameObjects.Ellipse | undefined)?.destroy()
      this.beeSprites.delete(occ.id)
      this.resolveAfterAction(outcome.path)
    })
  }

  private animateBump(occ: CellOccupant, sprite: Phaser.GameObjects.Sprite, outcome: BlockedOutcome): void {
    const stepPx = neighborDistance(this.cellSize)
    const { ux, uy } = this.flightUnit(occ)
    const distToBlocker = stepPx * (outcome.path.length + 1)
    const travel = distToBlocker - stepPx * juice.bump.contactOffset
    const duration = Math.max(juice.bump.minDurationMs, (travel / stepPx) * juice.bump.msPerCell)
    const sx = sprite.x
    const sy = sprite.y

    sprite.setDepth(100)
    this.tweens.add({
      targets: sprite,
      x: sx + ux * travel,
      y: sy + uy * travel,
      duration,
      ease: 'Quad.easeIn',
      onComplete: () => {
        // Anchor the puff to the blocker (fixed offset), not to flight length.
        const contactDist = distToBlocker - juice.bump.dust.offsetFromBlocker * stepPx
        this.dustEmitter.explode(juice.bump.dust.count, sx + ux * contactDist, sy + uy * contactDist)
        this.squashBlocker(outcome.blocker)

        // Squash along the motion axis (sprite x-axis is the flight axis).
        this.tweens.add({
          targets: sprite,
          scaleX: this.beeScale * juice.bump.squashAlong,
          scaleY: this.beeScale * juice.bump.squashAcross,
          duration: juice.bump.squashMs,
          yoyo: true,
          ease: 'Quad.easeOut',
          onComplete: () => {
            this.tweens.add({
              targets: sprite,
              x: sx,
              y: sy,
              duration: juice.bump.returnMs,
              ease: 'Back.easeOut',
              onComplete: () => {
                sprite.setDepth(10)
                sprite.setScale(this.beeScale)
                this.startIdle(sprite)
                this.resolveAfterAction(outcome.path)
              },
            })
          },
        })
      },
    })
  }

  /**
   * Bee flies into a honey cell, plops to a stop — and COLLECTS the honey it
   * landed in (the blob under it fades out via refreshHoney, a "+1" floats up).
   */
  private animateStuck(occ: CellOccupant, sprite: Phaser.GameObjects.Sprite, outcome: StuckOutcome): void {
    const cells = outcome.path.length + 1 // straight to the honey cell
    const duration = Math.max(juice.flight.minDurationMs, cells * juice.flight.msPerCell)
    const target = this.cellToWorld(outcome.at.q, outcome.at.r)

    sprite.setDepth(100)
    this.tweens.add({
      targets: sprite,
      x: target.x,
      y: target.y,
      duration,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.dustEmitter.explode(juice.bump.dust.count, target.x, target.y)
        this.popCollectedHoney(target.x, target.y)
        // Gooey plop: squash then settle, and stay put where the honey was.
        this.tweens.add({
          targets: sprite,
          scaleX: this.beeScale * 1.25,
          scaleY: this.beeScale * 0.75,
          duration: juice.bump.squashMs,
          yoyo: true,
          ease: 'Quad.easeOut',
          onComplete: () => {
            sprite.setDepth(occ.kind === 'queen' ? 12 : 10)
            sprite.setScale(this.beeScale)
            this.startIdle(sprite)
            this.resolveAfterAction(outcome.path)
          },
        })
      },
    })
  }

  /**
   * Rush Hive parking: the bee slides down its lane and thumps to a stop
   * against whatever blocked it. Deliberately reads like arrival rather than
   * rejection — the board changed, and the bee is now somebody else's wall.
   * No honey pop: nothing was collected.
   */
  private animatePark(occ: CellOccupant, sprite: Phaser.GameObjects.Sprite, outcome: ParkedOutcome): void {
    const cells = outcome.path.length
    const duration = Math.max(juice.flight.minDurationMs, cells * juice.flight.msPerCell)
    const target = this.cellToWorld(outcome.at.q, outcome.at.r)

    sprite.setDepth(100)
    this.tweens.add({
      targets: sprite,
      x: target.x,
      y: target.y,
      duration,
      // Ease OUT, not in: a car rolling to a stop, not a dive into honey.
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.dustEmitter.explode(juice.bump.dust.count, target.x, target.y)
        this.tweens.add({
          targets: sprite,
          scaleX: this.beeScale * 1.18,
          scaleY: this.beeScale * 0.82,
          duration: juice.bump.squashMs,
          yoyo: true,
          ease: 'Quad.easeOut',
          onComplete: () => {
            sprite.setDepth(occ.kind === 'queen' ? 12 : 10)
            sprite.setScale(this.beeScale)
            this.startIdle(sprite)
            this.resolveAfterAction(outcome.path)
          },
        })
      },
    })
  }

  /**
   * Collection celebration: "+1" floats up AND a droplet flies a bezier arc
   * into the honey chip, which pops — the reward is SEEN arriving.
   */
  private popCollectedHoney(x: number, y: number): void {
    feedback.collect()
    const pop = this.add.container(x, y - this.cellSize * 0.5).setDepth(150)
    pop.add(drawHoneyDrop(this, -20, 0, 9))
    pop.add(
      this.add
        .text(-6, 0, t('hud.plusHoney', { n: 1 }), {
          fontFamily: FONT_STACK,
          fontSize: '24px',
          color: colors.honeyCss,
          stroke: '#241708',
          strokeThickness: 4,
        })
        .setOrigin(0, 0.5),
    )
    this.tweens.add({
      targets: pop,
      y: y - this.cellSize * 1.4,
      alpha: { from: 1, to: 0 },
      duration: 850,
      ease: 'Quad.easeOut',
      onComplete: () => pop.destroy(),
    })

    // The flying droplet → honey chip (top-left), chip pops on arrival.
    const drop = this.add.image(x, y, ensureDropTexture(this, 26)).setDepth(210)
    const curve = new Phaser.Curves.QuadraticBezier(
      new Phaser.Math.Vector2(x, y),
      new Phaser.Math.Vector2((x + 168) / 2 + 60, Math.min(y, layout.hudTopY) - 90),
      new Phaser.Math.Vector2(168, layout.hudTopY),
    )
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 520,
      delay: 140,
      ease: 'Quad.easeIn',
      onUpdate: (tw) => {
        const p = curve.getPoint(tw.getValue() ?? 0)
        drop.setPosition(p.x, p.y)
      },
      onComplete: () => {
        drop.destroy()
        if (this.honeyChip) {
          const chip = this.honeyChip.parentContainer
          if (chip) {
            chip.setScale(1.12)
            this.tweens.add({ targets: chip, scale: 1, duration: 110 })
          }
        }
      },
    })
  }

  private squashBlocker(at: Axial): void {
    const blocker = this.board.occupantAt(at.q, at.r)
    if (!blocker) return
    const blockerSprite = this.beeSprites.get(blocker.id)
    if (!blockerSprite) return
    this.stopIdle(blockerSprite)
    this.tweens.add({
      targets: blockerSprite,
      scale: this.beeScale * juice.bump.blockerPulseScale,
      duration: juice.bump.blockerPulseMs,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        blockerSprite.setScale(this.beeScale)
        this.startIdle(blockerSprite)
      },
    })
  }

  // ── Idle life ─────────────────────────────────────────────────────────────

  private startIdle(sprite: Phaser.GameObjects.Sprite): void {
    if (!sprite.active) return
    // Idempotent: never stack a second infinite breathe pair.
    this.tweens.killTweensOf(sprite)
    // Back to the rest pose: wings still (frame 0), upright, no flap. The idle only
    // breathes — no rotation/wiggle, which is the "spinning" the player did not want.
    sprite.stop()
    sprite.setFrame(0)
    sprite.setScale(this.beeScale)
    // Back to the bee's OWN heading, not to upright — the resting pose carries
    // the direction now, so snapping to 0 would erase it after every flight.
    sprite.setRotation((sprite.getData('faceRot') as number | undefined) ?? 0)
    sprite.setFlipY((sprite.getData('faceFlip') as boolean | undefined) ?? false)
    this.tweens.add({
      targets: sprite,
      scale: this.beeScale * juice.idle.breatheScale,
      duration: juice.idle.breatheMs + Math.random() * juice.idle.breatheJitterMs,
      delay: Math.random() * juice.idle.startDelayJitterMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    // Reveal the flight-direction chevron while the bee is at rest and tappable.
    // Tried and reverted: hiding it once the BODY faces its heading. It reads
    // fine in isolation, but the six headings are 60° apart and leftward bees
    // are mirrored, so E/NE/SE became genuinely hard to tell apart on a packed
    // board. The body's heading is worth having as reinforcement; it is not
    // worth having INSTEAD.
    const arrow = sprite.getData('arrow') as Phaser.GameObjects.Image | undefined
    if (arrow) arrow.setVisible(true).setScale((this.cellSize / 64) * 0.9)
    this.startIdleFlutter(sprite)
  }

  /**
   * A resting bee twitches a wing every few seconds. Eight bees that only
   * scale-breathe read as eight stickers; one wing moving somewhere on the
   * board reads as a hive that is alive and waiting for you. The interval is
   * jittered per bee so they never flutter in unison, which would look
   * mechanical — the point is that the board is never quite still.
   */
  private startIdleFlutter(sprite: Phaser.GameObjects.Sprite): void {
    this.stopIdleFlutter(sprite)
    const schedule = (): void => {
      if (!sprite.active) return
      const timer = this.time.delayedCall(
        juice.idle.flutterEveryMs + Math.random() * juice.idle.flutterJitterMs,
        () => {
          // Only while genuinely at rest: a bee mid-flight owns its own frames.
          if (!sprite.active || sprite.anims.isPlaying) return
          const frames = [1, 2, 1, 0]
          frames.forEach((f, i) => {
            this.time.delayedCall(i * juice.idle.flutterFrameMs, () => {
              if (sprite.active && !sprite.anims.isPlaying) sprite.setFrame(f)
            })
          })
          schedule()
        },
      )
      sprite.setData('flutterTimer', timer)
    }
    schedule()
  }

  private stopIdleFlutter(sprite: Phaser.GameObjects.Sprite): void {
    const timer = sprite.getData('flutterTimer') as Phaser.Time.TimerEvent | undefined
    if (timer) {
      timer.remove(false)
      sprite.setData('flutterTimer', undefined)
    }
  }

  private stopIdle(sprite: Phaser.GameObjects.Sprite): void {
    // The resting wing-flutter schedules itself forward; kill it before the bee
    // commits to an action or a stray frame lands mid-flight.
    this.stopIdleFlutter(sprite)
    // A tap can land before the staggered spawn pop has even started —
    // cancel the pending timer so it cannot re-animate the sprite mid-action.
    const spawnTimer = sprite.getData('spawnTimer') as Phaser.Time.TimerEvent | undefined
    if (spawnTimer) {
      spawnTimer.remove(false)
      sprite.setData('spawnTimer', undefined)
    }
    // A queen's crown pops in on its own tween; cancel it too and snap the crown
    // to full size, else it could animate against a destroyed image after escape.
    const crownTween = sprite.getData('crownTween') as Phaser.Tweens.Tween | undefined
    if (crownTween) {
      crownTween.remove()
      sprite.setData('crownTween', undefined)
      const crown = sprite.getData('crown') as Phaser.GameObjects.Image | undefined
      crown?.setScale((this.cellSize / 62) * 0.9)
    }
    this.tweens.killTweensOf(sprite)
    sprite.setScale(this.beeScale)
    sprite.setRotation(0)
    // Hide the arrow the moment the bee is committed to a flight/action.
    const arrow = sprite.getData('arrow') as Phaser.GameObjects.Image | undefined
    if (arrow) arrow.setVisible(false)
  }

  // ── Resolution ────────────────────────────────────────────────────────────

  /**
   * Rewarded-ad revive: hand the player extra moves and put them straight back
   * into the board they just lost. Called by LevelFailedScene once the ad has
   * actually paid out. Only ever offered for an out-of-moves loss — a queen
   * violation is unrecoverable, so there is nothing to revive into.
   */
  reviveWithExtraMoves(extra: number): void {
    this.board.grantExtraMoves(extra)
    // The undo snapshots predate the revive; extend them too, or one undo
    // would silently evaporate the moves the player just watched an ad for.
    for (const entry of this.history) entry.board.grantExtraMoves(extra)
    this.usedRevive = true
    this.inputLocked = false
    this.pending = undefined
    this.previewGfx.clear()
    this.updateMovesHud()
  }

  private resolveAfterAction(path?: ReadonlyArray<Axial>): void {
    this.inputLocked = false
    // The trail was laid the moment the tap resolved; show it once the bee has
    // actually made the trip, so the honey ripples in along its wake.
    this.refreshHoney(true, path)
    if (this.rescueIfSealed()) return
    const status = this.board.status
    if (status === 'won') {
      // 3 stars require finishing with the level's spare margin left; else 2.
      // The spare is measured against the level's REAL budget (movesUsed vs
      // moveBudget), so neither the silent fail-streak bonus nor a bought +3
      // Moves can inflate the score. A revive caps the win at 1 star — the
      // level still counts as beaten, but a bought second chance never earns a
      // perfect run.
      const spare = this.level.moveBudget - this.board.movesUsed
      const stars = this.usedRevive ? 1 : spare >= this.level.threeStarSpare ? 3 : 2
      difficultyDirector.recordWin(this.level.id)
      // Sticky Hive levels force-collect most of the board — cap their haul so
      // the special stays a puzzle, not a honey farm (see FLOODED_HONEY_CAP).
      const collected = this.level.flooded
        ? Math.min(this.board.collectedHoney, FLOODED_HONEY_CAP)
        : this.board.collectedHoney
      // Which SAVE TRACK a win lands in follows the ladder, never the rules.
      // Conflating the two cost a real bug: once the campaign started carrying
      // sealed-rim rules, every campaign win was recorded against the Compass
      // track and the player's progress never advanced.
      const honey = this.compassLadder
        ? saveManager.recordCompassWin(this.level.id, stars, COMPASS_COUNT, collected)
        : saveManager.recordWin(this.level.id, stars, LEVEL_COUNT, collected)
      this.inputLocked = true
      feedback.win()
      this.time.delayedCall(juice.ui.resultDelayWinMs, () => {
        this.scene.launch('LevelComplete', {
          mode: this.compassLadder ? 'compass' : undefined,
          levelIndex: this.levelIndex,
          chapter: chapterOf(this.level.id),
          stars,
          honey,
          movesUsed: this.board.movesUsed,
          budget: this.board.moveBudget,
          threeStarSpare: this.level.threeStarSpare,
        })
        this.scene.pause()
      })
    } else if (status === 'lost') {
      difficultyDirector.recordFail(this.level.id)
      // The win streak does NOT break here: the fail screen's revive is the
      // "save your streak" moment. It breaks when the player gives up there.
      this.inputLocked = true
      feedback.fail()
      this.time.delayedCall(juice.ui.resultDelayLoseMs, () => {
        this.scene.launch('LevelFailed', {
          mode: this.compassLadder ? 'compass' : undefined,
          levelIndex: this.levelIndex,
          chapter: chapterOf(this.level.id),
          beesLeft: this.board.remaining,
          queenLeftEarly: this.board.queenLeftEarly,
        })
        this.scene.pause()
      })
    }
  }
}
