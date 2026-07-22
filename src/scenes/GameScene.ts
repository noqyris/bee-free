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
import type { Axial, CellOccupant, LevelData, TapOutcome } from '../types'
import { GAME_WIDTH, colors, layout } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { themeForChapter, type ChapterTheme } from '../config/theme'
import { paintBackground } from '../utils/background'
import { difficultyDirector } from '../systems/DifficultyDirector'
import { saveManager } from '../systems/SaveManager'
import { t } from '../i18n'
import { makeIconButton, FONT_STACK } from '../utils/ui'

interface GameSceneData {
  levelIndex?: number
}

type EscapedOutcome = Extract<TapOutcome, { kind: 'escaped' }>
type BlockedOutcome = Extract<TapOutcome, { kind: 'blocked' }>

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
  private pending?: { occ: CellOccupant; q: number; r: number }

  constructor() {
    super('Game')
  }

  init(data: GameSceneData): void {
    this.levelIndex = Phaser.Math.Clamp(data.levelIndex ?? 0, 0, LEVEL_COUNT - 1)
  }

  create(): void {
    this.level = getLevel(this.levelIndex)
    this.theme = themeForChapter(chapterOf(this.level.id))
    // Silent difficulty easing: bonus moves after a fail streak (spec §4).
    const bonus = difficultyDirector.bonusMovesFor(this.level.id)
    this.board = new BoardState({ ...this.level, moveBudget: this.level.moveBudget + bonus })
    this.beeSprites.clear()
    this.inputLocked = false
    this.comboCount = 0
    this.lastEscapeAt = -Infinity
    this.pending = undefined

    paintBackground(this, this.theme)
    this.layoutBoard()
    this.drawCells()
    this.createEmitters()
    this.previewGfx = this.add.graphics().setDepth(90)
    this.spawnOccupants()
    this.buildHud()
    this.showCoach()

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this)
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this)
  }

  /** Keep each queen's crown pinned above her sprite through idle and flight. */
  override update(): void {
    for (const sprite of this.beeSprites.values()) {
      const crown = sprite.getData('crown') as Phaser.GameObjects.Image | undefined
      if (crown && sprite.active) {
        crown.setPosition(sprite.x, sprite.y - this.cellSize * 0.62)
      }
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
    this.beeScale = (1.6 * this.cellSize) / 128
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
      // Themed cell: stroke-colored border hex behind a slightly smaller fill.
      this.add.image(x, y + s * 4, 'hex').setScale(s).setTint(0x000000).setAlpha(0.18)
      this.add.image(x, y, 'hex').setScale(s).setTint(this.theme.cellStroke)
      this.add.image(x, y, 'hex').setScale(s * 0.88).setTint(this.theme.cellFill)
      this.add.image(x, y - s * 6, 'hex').setScale(s * 0.6).setTint(0xffffff).setAlpha(0.08)
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

  private spawnOccupants(): void {
    this.board.allOccupants().forEach((occ, i) => {
      const { x, y } = this.cellToWorld(occ.q, occ.r)

      if (occ.kind === 'hornet') {
        const hornet = this.add.sprite(x, y, 'hornet').setScale(0).setDepth(8)
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

      const rot = directionAngle(occ.dir)
      const sprite = this.add.sprite(x, y, occ.kind === 'queen' ? 'beeQueen' : 'bee')
      sprite.setRotation(rot)
      sprite.setScale(0)
      sprite.setDepth(occ.kind === 'queen' ? 12 : 10)
      sprite.setData('baseRot', rot)

      if (occ.kind === 'queen') {
        const crown = this.add
          .image(x, y - this.cellSize * 0.62, 'crown')
          .setScale((this.cellSize / 62) * 0.9)
          .setDepth(13)
          .setScale(0)
        sprite.setData('crown', crown)
        this.tweens.add({
          targets: crown,
          scale: (this.cellSize / 62) * 0.9,
          delay: i * juice.spawn.staggerMs,
          duration: juice.spawn.popMs,
          ease: 'Back.easeOut',
        })
      }

      this.beeSprites.set(occ.id, sprite)
      // The timer handle is kept on the sprite so a tap arriving before the
      // pop fires can cancel it (stopIdle) instead of racing the action tween.
      const spawnTimer = this.time.delayedCall(i * juice.spawn.staggerMs, () => {
        sprite.setData('spawnTimer', undefined)
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

  /** One-line contextual coaching for newly introduced mechanics. */
  private showCoach(): void {
    const id = this.level.id
    const kinds = new Set(this.board.allOccupants().map((o) => o.kind))
    let key: 'coach.tap' | 'coach.queen' | 'coach.hornet' | null = null
    if (id <= 2) key = 'coach.tap'
    else if (kinds.has('queen') && id <= 16) key = 'coach.queen'
    else if (kinds.has('hornet') && id <= 30) key = 'coach.hornet'
    if (!key) return

    const banner = this.add
      .text(GAME_WIDTH / 2, layout.movesPillY + 92, t(key), {
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

    // Moves pill with an accent ring.
    const pill = this.add.graphics().setDepth(200)
    pill.fillStyle(0x000000, 0.34)
    pill.fillRoundedRect(GAME_WIDTH / 2 - 116, layout.movesPillY - 48, 232, 96, 30)
    pill.lineStyle(3, this.theme.accent, 0.8)
    pill.strokeRoundedRect(GAME_WIDTH / 2 - 116, layout.movesPillY - 48, 232, 96, 30)

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

    makeIconButton(this, 66, layout.hudTopY, '‹', () => this.scene.start('Menu'), 34).setDepth(200)
    makeIconButton(
      this,
      GAME_WIDTH - 66,
      layout.hudTopY,
      '↻',
      () => this.scene.restart({ levelIndex: this.levelIndex }),
      34,
    ).setDepth(200)
  }

  private updateMovesHud(): void {
    this.movesText.setText(String(this.board.movesLeft))
    const doomed = this.board.status === 'playing' && this.board.movesLeft < this.board.remaining
    this.movesText.setColor(doomed ? colors.hudWarnCss : this.theme.textCss)
    this.movesText.setScale(1)
    this.tweens.add({
      targets: this.movesText,
      scale: juice.ui.counterPunchScale,
      duration: juice.ui.counterPunchMs,
      yoyo: true,
      ease: 'Quad.easeOut',
    })
  }

  // ── Input (press to aim, release to fly) ────────────────────────────────────

  private cellAt(pointer: Phaser.Input.Pointer): Axial {
    return pixelToAxial(pointer.worldX - this.origin.x, pointer.worldY - this.origin.y, this.cellSize)
  }

  /** Press a tappable occupant → show where it will fly (green safe / red bad). */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.inputLocked || this.board.status !== 'playing') return
    const cell = this.cellAt(pointer)
    const occ = this.board.occupantAt(cell.q, cell.r)
    if (!occ || !occ.isTappable()) return
    this.pending = { occ, q: cell.q, r: cell.r }
    this.drawPreview(occ)
  }

  /** Release on the same occupant → commit the flight. Release elsewhere → cancel. */
  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const pending = this.pending
    this.pending = undefined
    this.previewGfx.clear()
    if (!pending || this.inputLocked || this.board.status !== 'playing') return

    const cell = this.cellAt(pointer)
    if (cell.q !== pending.q || cell.r !== pending.r) return // released off the bee → cancel

    const occ = pending.occ
    const outcome = this.board.tap(pending.q, pending.r)
    if (!outcome) return

    this.updateMovesHud()
    const sprite = this.beeSprites.get(occ.id)
    if (!sprite) return
    this.inputLocked = true
    this.stopIdle(sprite)

    if (outcome.kind === 'escaped') {
      const now = this.time.now
      this.comboCount = now - this.lastEscapeAt <= juice.escape.comboWindowMs ? this.comboCount + 1 : 1
      this.lastEscapeAt = now
      this.animateEscape(occ, sprite, outcome)
    } else {
      this.comboCount = 0
      this.animateBump(occ, sprite, outcome)
    }
  }

  /** Draw the flight-path preview for a pressed occupant. */
  private drawPreview(occ: CellOccupant): void {
    const outcome = this.board.trace(occ)
    const start = this.cellToWorld(occ.q, occ.r)
    const { ux, uy } = this.flightUnit(occ)
    const stepPx = neighborDistance(this.cellSize)
    const willViolate = occ.kind === 'queen' && this.board.remaining > 1
    const safe = outcome.kind === 'escaped' && !willViolate
    const color = safe ? 0x5dff9b : 0xff5a5a

    const dist =
      outcome.kind === 'escaped'
        ? stepPx * (outcome.path.length + 1)
        : stepPx * (outcome.path.length + 1) - stepPx * 0.5
    const ex = start.x + ux * dist
    const ey = start.y + uy * dist

    const g = this.previewGfx
    g.clear()
    g.lineStyle(Math.max(6, this.cellSize * 0.16), color, 0.85)
    g.beginPath()
    g.moveTo(start.x, start.y)
    g.lineTo(ex, ey)
    g.strokePath()

    // Arrowhead (safe) or a blocked marker (bad).
    const head = this.cellSize * 0.34
    const px = -uy
    const py = ux
    g.fillStyle(color, 0.95)
    if (safe) {
      g.fillTriangle(
        ex + ux * head,
        ey + uy * head,
        ex - ux * head * 0.4 + px * head * 0.7,
        ey - uy * head * 0.4 + py * head * 0.7,
        ex - ux * head * 0.4 - px * head * 0.7,
        ey - uy * head * 0.4 - py * head * 0.7,
      )
    } else {
      // A cross at the stop point = "blocked / don't".
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

  private animateEscape(occ: CellOccupant, sprite: Phaser.GameObjects.Sprite, outcome: EscapedOutcome): void {
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
      tint: colors.honeyParticle,
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
        sprite.setScale(this.beeScale * (1 + (juice.flight.scaleUp - 1) * v))
      },
      onComplete: () => {
        // Let in-flight trail particles fade out instead of vanishing.
        trail.stop()
        this.time.delayedCall(juice.flight.trail.fadeOutMs, () => trail.destroy())
        const crown = sprite.getData('crown') as Phaser.GameObjects.Image | undefined
        crown?.destroy()
        sprite.destroy()
        this.beeSprites.delete(occ.id)
        this.resolveAfterAction()
      },
    })

    // Cubic-in easing: distance fraction f is reached at t = cbrt(f).
    const f = Math.min(1, edgeDist / totalDist)
    this.time.delayedCall(duration * Math.cbrt(f), () => {
      const count =
        juice.escape.burst.count +
        Math.min(juice.escape.comboParticleCap, juice.escape.comboParticleBonus * (this.comboCount - 1))
      this.burstEmitter.explode(count, sx + ux * edgeDist, sy + uy * edgeDist)
      this.cameras.main.shake(juice.escape.shakeMs, juice.escape.shakeIntensity)
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
                this.resolveAfterAction()
              },
            })
          },
        })
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
    // Idempotent: never stack a second infinite breathe/wiggle pair.
    this.tweens.killTweensOf(sprite)
    const baseRot = (sprite.getData('baseRot') as number) ?? 0
    sprite.setScale(this.beeScale)
    sprite.setRotation(baseRot)
    this.tweens.add({
      targets: sprite,
      scale: this.beeScale * juice.idle.breatheScale,
      duration: juice.idle.breatheMs + Math.random() * juice.idle.breatheJitterMs,
      delay: Math.random() * juice.idle.startDelayJitterMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.tweens.add({
      targets: sprite,
      rotation: baseRot + juice.idle.wiggleRad,
      duration: juice.idle.wiggleMs + Math.random() * juice.idle.wiggleJitterMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  private stopIdle(sprite: Phaser.GameObjects.Sprite): void {
    // A tap can land before the staggered spawn pop has even started —
    // cancel the pending timer so it cannot re-animate the sprite mid-action.
    const spawnTimer = sprite.getData('spawnTimer') as Phaser.Time.TimerEvent | undefined
    if (spawnTimer) {
      spawnTimer.remove(false)
      sprite.setData('spawnTimer', undefined)
    }
    this.tweens.killTweensOf(sprite)
    sprite.setScale(this.beeScale)
    sprite.setRotation((sprite.getData('baseRot') as number) ?? 0)
  }

  // ── Resolution ────────────────────────────────────────────────────────────

  private resolveAfterAction(): void {
    this.inputLocked = false
    const status = this.board.status
    if (status === 'won') {
      // 3 stars require finishing with the level's spare margin left; else 2.
      // (1 star is reserved for the rewarded +3-moves revive, wired in M5.)
      const stars = this.board.movesLeft >= this.level.threeStarSpare ? 3 : 2
      difficultyDirector.recordWin(this.level.id)
      const honey = saveManager.recordWin(this.level.id, stars, LEVEL_COUNT)
      this.inputLocked = true
      this.time.delayedCall(juice.ui.resultDelayWinMs, () => {
        this.scene.launch('LevelComplete', {
          levelIndex: this.levelIndex,
          chapter: chapterOf(this.level.id),
          stars,
          honey,
          movesUsed: this.board.movesUsed,
          budget: this.board.moveBudget,
        })
        this.scene.pause()
      })
    } else if (status === 'lost') {
      difficultyDirector.recordFail(this.level.id)
      this.inputLocked = true
      this.time.delayedCall(juice.ui.resultDelayLoseMs, () => {
        this.scene.launch('LevelFailed', {
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
