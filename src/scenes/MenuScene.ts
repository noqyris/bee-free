import Phaser from 'phaser'
import { GAME_WIDTH, colors } from '../config/gameConfig'
import { LEVEL_COUNT } from '../levels'
import { CHAPTER_THEMES, themeForChapter, type ChapterTheme } from '../config/theme'
import { saveManager } from '../systems/SaveManager'
import { adService } from '../systems/AdService'
import { paintBackground, type Background } from '../utils/background'
import { t, type StringKey } from '../i18n'
import { makeIconButton, drawHoneyDrop, transitionTo, fadeInScene, FONT_STACK } from '../utils/ui'
import { feedback } from '../systems/feedback'

/**
 * The level map, and nothing else. The store row and the Continue button moved
 * to HomeScene: they used to live down here, which pushed the last grid row and
 * the page dots into the bottom of the screen where the ad banner sits.
 */
const CHAPTER_SIZE = 25
const COLS = 5
const ROWS = 5
const GRID_TOP = 352
const GRID_BOTTOM = 976
const GRID_LEFT = 112
const GRID_RIGHT = GAME_WIDTH - 112
/** Horizontal swipe: at least this many px, within this much time. */
const SWIPE_MIN_PX = 60
const SWIPE_MAX_MS = 500

export class MenuScene extends Phaser.Scene {
  private currentChapter = 1
  private bg!: Background
  private page!: Phaser.GameObjects.Container
  private chapterTitle!: Phaser.GameObjects.Text
  private chapterSub!: Phaser.GameObjects.Text
  private dots: Phaser.GameObjects.Arc[] = []
  private ringTween?: Phaser.Tweens.Tween

  constructor() {
    super('Menu')
  }

  create(): void {
    // Phaser reuses the Scene instance across scene.start, so class-field
    // initializers do NOT re-run on re-entry — reset per-session state here.
    this.dots = []
    this.ringTween = undefined
    this.currentChapter = Math.ceil(saveManager.currentLevel / CHAPTER_SIZE)
    const theme = themeForChapter(this.currentChapter)
    fadeInScene(this)
    this.bg = paintBackground(this, theme)

    this.buildHeader()
    this.buildChapterNav()
    this.buildDots()
    this.buildSwipe()
    this.renderChapter(this.currentChapter)

    void adService.showBanner()
  }

  /**
   * Back arrow on the left, then the stat pills. The pills sit on their own row
   * ABOVE the wordmark: side by side, the title runs straight into both of them
   * at this width.
   */
  private buildHeader(): void {
    // Top row shares Home's y=56 inset (top edge clears the y=44 safe line), with
    // a clear gap between the back button and the stars pill.
    makeIconButton(this, 58, 86, '‹', () => transitionTo(this, 'Home'), 30).setDepth(60)
    this.statPill(118, 56, 170, `${saveManager.totalStars()}/${LEVEL_COUNT * 3}`, 'star', colors.hudTextCss, 26)
    // The honey pill is the Shop door here exactly as it is on Home — same
    // affordance, same '+' badge, so the pattern learned there works here too.
    this.statPill(GAME_WIDTH - 40 - 170, 56, 170, String(saveManager.honey), 'honey', colors.honeyCss, 28)

    this.add
      .text(GAME_WIDTH / 2, 170, t('menu.levels'), {
        fontFamily: FONT_STACK,
        fontSize: '48px',
        color: '#ffd23f',
        stroke: '#241708',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
  }

  /** Rounded "glass" chip: translucent fill, hairline rim, glyph + value. */
  private statPill(
    x: number,
    y: number,
    w: number,
    value: string,
    kind: 'star' | 'honey',
    textCss: string,
    fontSize: number,
  ): void {
    const h = 60
    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.32)
    g.fillRoundedRect(x, y, w, h, h / 2)
    g.lineStyle(2, kind === 'honey' ? themeForChapter(this.currentChapter).accent : 0xffffff, kind === 'honey' ? 0.5 : 0.1)
    g.strokeRoundedRect(x, y, w, h, h / 2)
    if (kind === 'honey') {
      drawHoneyDrop(this, x + 30, y + h / 2, 12)
    } else {
      this.add.star(x + 30, y + h / 2, 5, 8, 17, colors.starGold).setOrigin(0.5)
    }
    this.add
      .text(x + 54, y + h / 2, value, {
        fontFamily: FONT_STACK,
        fontSize: `${fontSize}px`,
        color: textCss,
      })
      .setOrigin(0, 0.5)
    if (kind === 'honey') {
      this.add
        .text(x + w - 24, y + h / 2, '＋', {
          fontFamily: FONT_STACK,
          fontSize: '30px',
          color: themeForChapter(this.currentChapter).accentCss,
        })
        .setOrigin(0.5)
      this.add
        .rectangle(x + w / 2, y + h / 2, w, h, 0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          feedback.tap()
          transitionTo(this, 'Shop', { returnTo: 'Menu' })
        })
    }
  }

  private buildChapterNav(): void {
    this.chapterTitle = this.add
      .text(GAME_WIDTH / 2, 236, '', {
        fontFamily: FONT_STACK,
        fontSize: '44px',
        color: colors.hudTextCss,
      })
      .setOrigin(0.5)
    this.chapterSub = this.add
      .text(GAME_WIDTH / 2, 280, '', {
        fontFamily: FONT_STACK,
        fontSize: '24px',
        color: colors.hudTextCss,
      })
      .setOrigin(0.5)
      .setAlpha(0.6)

    // Flanking the chapter name and vertically centred on the whole two-line
    // "Chapter N / <name>" block, clear of the "Levels" title above.
    makeIconButton(this, 176, 258, '‹', () => this.changeChapter(-1), 28)
    makeIconButton(this, GAME_WIDTH - 176, 258, '›', () => this.changeChapter(1), 28)
  }

  /** Page dots — each one is a direct jump to its chapter, not just an indicator. */
  private buildDots(): void {
    const y = GRID_BOTTOM + 76
    const n = CHAPTER_THEMES.length
    const spacing = 30
    const startX = GAME_WIDTH / 2 - ((n - 1) * spacing) / 2
    for (let i = 0; i < n; i++) {
      const x = startX + i * spacing
      this.dots.push(this.add.circle(x, y, 6, 0xffffff, 0.3))
      // A 30×44 invisible hit pad per dot: chapter 1 → 12 in one tap instead
      // of eleven presses on the arrows.
      this.add
        .rectangle(x, y, spacing, 44, 0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          if (i + 1 === this.currentChapter) return
          feedback.tap()
          this.currentChapter = i + 1
          this.bg.retint(themeForChapter(this.currentChapter))
          this.renderChapter(this.currentChapter)
        })
    }
  }

  /** Horizontal swipe over the grid pages chapters — the gesture a level map owes. */
  private buildSwipe(): void {
    let downX = 0
    let downY = 0
    let downAt = 0
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      downX = p.x
      downY = p.y
      downAt = p.downTime
    })
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
      const dx = p.x - downX
      const dy = p.y - downY
      const dt = p.upTime - downAt
      if (dt > SWIPE_MAX_MS) return
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return
      this.changeChapter(dx < 0 ? 1 : -1)
    })
  }

  private changeChapter(delta: number): void {
    const next = Phaser.Math.Clamp(this.currentChapter + delta, 1, CHAPTER_THEMES.length)
    if (next === this.currentChapter) return
    feedback.tap()
    this.currentChapter = next
    const theme = themeForChapter(next)
    this.bg.retint(theme)
    this.renderChapter(next)
  }

  private renderChapter(chapter: number): void {
    // Stop the previous current-node pulse before destroying its ring, else the
    // repeat:-1 tween keeps running on the detached child (Phaser doesn't remove
    // tweens whose target was destroyed).
    this.ringTween?.remove()
    this.ringTween = undefined
    this.page?.destroy()
    this.page = this.add.container(0, 0)
    const theme = themeForChapter(chapter)

    this.chapterTitle.setText(t('menu.chapter', { n: chapter })).setColor(theme.accentCss)
    // Chapter name + its star tally, so completionists can see at a glance
    // which chapter still owes them stars.
    const first = (chapter - 1) * CHAPTER_SIZE + 1
    let got = 0
    for (let id = first; id < first + CHAPTER_SIZE && id <= LEVEL_COUNT; id++) {
      got += saveManager.starsFor(id)
    }
    this.chapterSub.setText(
      `${t(`chapter.${chapter}` as StringKey)}  ·  ${t('menu.chapterStars', { got, total: CHAPTER_SIZE * 3 })}`,
    )

    this.dots.forEach((d, i) =>
      d.setFillStyle(0xffffff, i === chapter - 1 ? 0.95 : 0.28).setScale(i === chapter - 1 ? 1.3 : 1),
    )

    const colStep = (GRID_RIGHT - GRID_LEFT) / (COLS - 1)
    const rowStep = (GRID_BOTTOM - GRID_TOP) / (ROWS - 1)

    for (let i = 0; i < CHAPTER_SIZE; i++) {
      const levelId = (chapter - 1) * CHAPTER_SIZE + i + 1
      if (levelId > LEVEL_COUNT) break
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const x = GRID_LEFT + col * colStep
      const y = GRID_TOP + row * rowStep
      this.buildNode(x, y, levelId, theme)
    }

    // Fade the page in for a smooth chapter change.
    this.page.setAlpha(0)
    this.tweens.add({ targets: this.page, alpha: 1, duration: 180 })
  }

  private buildNode(x: number, y: number, levelId: number, theme: ChapterTheme): void {
    const unlocked = saveManager.isUnlocked(levelId)
    const isCurrent = levelId === saveManager.currentLevel
    const stars = saveManager.starsFor(levelId)
    const radius = 48

    const node = this.add.container(x, y)
    this.page.add(node)

    // Shadow + hex body
    const shadow = this.add.image(0, 5, 'hex').setScale(radius / 62).setTint(0x000000).setAlpha(0.25)
    const body = this.add.image(0, 0, 'hex').setScale(radius / 62)
    body.setTint(unlocked ? theme.cellFill : colors.locked)
    node.add([shadow, body])

    if (isCurrent) {
      body.setTint(theme.accent)
      const ring = this.add.image(0, 0, 'hex').setScale((radius / 62) * 1.16).setTint(0xffffff).setAlpha(0.9)
      ring.setDepth(-1)
      node.add(ring)
      this.ringTween = this.tweens.add({
        targets: ring,
        scale: (radius / 62) * 1.24,
        alpha: 0.35,
        duration: 720,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }

    const label = this.add
      .text(0, stars > 0 || !unlocked ? -8 : 0, String(levelId), {
        fontFamily: FONT_STACK,
        fontSize: '30px',
        color: unlocked ? '#241708' : '#b3a9d0',
      })
      .setOrigin(0.5)
    node.add(label)

    if (!unlocked) {
      // Small drawn padlock (avoids emoji-font risk).
      const lock = this.add.graphics()
      lock.fillStyle(0x8f88a8, 1)
      lock.fillRoundedRect(-11, 8, 22, 17, 4)
      lock.lineStyle(4, 0x8f88a8, 1)
      lock.strokeCircle(0, 6, 8)
      node.add(lock)
      label.setY(-14)
    } else if (stars > 0) {
      const starY = 18
      for (let s = 0; s < 3; s++) {
        node.add(
          this.add
            // Unearned pips take the chapter's own stroke tone so they recede
            // into the amber hex instead of reading as an off-palette cool blue.
            .star(-16 + s * 16, starY, 5, 4, 8.5, s < stars ? colors.starGold : theme.cellStroke)
            .setOrigin(0.5),
        )
      }
    }

    if (unlocked) {
      // Square hit area from the node size (reliable container-input path).
      node.setSize(radius * 1.9, radius * 1.9)
      node.setInteractive({ useHandCursor: true })
      // Phaser fires pointerup on whatever sits under the RELEASE point, so a
      // swipe that merely ENDS on this node would otherwise start the level
      // with a stale downX. Only a press that began here (and stayed) counts.
      let pressed = false
      let downX = 0
      node.on('pointerdown', (p: Phaser.Input.Pointer) => {
        pressed = true
        downX = p.x
        feedback.unlock()
        feedback.tap()
        this.tweens.add({ targets: node, scale: 0.9, duration: 60 })
      })
      node.on('pointerout', () => {
        pressed = false
        this.tweens.add({ targets: node, scale: 1, duration: 60 })
      })
      node.on('pointerup', (p: Phaser.Input.Pointer) => {
        this.tweens.add({ targets: node, scale: 1, duration: 60 })
        if (!pressed) return
        pressed = false
        // A horizontal drag that started on this node is a page swipe, not a
        // level pick — let the scene-level swipe handler take it.
        if (Math.abs(p.x - downX) >= SWIPE_MIN_PX) return
        this.startLevel(levelId)
      })
    }
  }

  private startLevel(levelId: number): void {
    transitionTo(this, 'Game', { levelIndex: levelId - 1 })
  }
}
