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

    paintBackground(this, this.theme)
    this.layoutBoard()
    this.drawCells()
    this.createEmitters()
    this.spawnBees()
    this.buildHud()

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this)
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

  private spawnBees(): void {
    this.board.allOccupants().forEach((occ, i) => {
      const { x, y } = this.cellToWorld(occ.q, occ.r)
      const rot = directionAngle(occ.dir)
      const sprite = this.add.sprite(x, y, 'bee')
      sprite.setRotation(rot)
      sprite.setScale(0)
      sprite.setDepth(10)
      sprite.setData('baseRot', rot)
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

  // ── Input ─────────────────────────────────────────────────────────────────

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.inputLocked || this.board.status !== 'playing') return
    const cell = pixelToAxial(
      pointer.worldX - this.origin.x,
      pointer.worldY - this.origin.y,
      this.cellSize,
    )
    const occ = this.board.occupantAt(cell.q, cell.r)
    if (!occ) return
    const outcome = this.board.tap(cell.q, cell.r)
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
        })
        this.scene.pause()
      })
    }
  }
}
