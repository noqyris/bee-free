import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT, colors } from '../config/gameConfig'
import { juice } from '../config/juiceConfig'
import { COMPASS_COUNT } from '../levels/compass'
import { LEVEL_COUNT } from '../levels'
import { themeForChapter } from '../config/theme'
import { t } from '../i18n'
import { adService } from '../systems/AdService'
import { reviewService } from '../systems/ReviewService'
import { saveManager, winStreakMultiplier } from '../systems/SaveManager'
import {
  makeButton,
  drawHoneyDrop,
  ensureSunburstTexture,
  ensureDropTexture,
  FONT_STACK,
} from '../utils/ui'
import { feedback } from '../systems/feedback'

interface LevelCompleteData {
  levelIndex: number
  /** 'compass' keeps retry/next inside the Compass Hive ladder. */
  mode?: 'compass'
  chapter: number
  stars: number
  honey: number
  movesUsed: number
  budget: number
  threeStarSpare?: number
}

export class LevelCompleteScene extends Phaser.Scene {
  private params!: LevelCompleteData
  private busy = false
  private bonusTaken = false

  constructor() {
    super('LevelComplete')
  }

  init(data: LevelCompleteData): void {
    this.params = data
    this.busy = false
    this.bonusTaken = false
  }

  create(): void {
    const theme = themeForChapter(this.params.chapter)

    const backdrop = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, colors.dimBackdrop, 1)
      .setAlpha(0)
      .setInteractive()
    this.tweens.add({ targets: backdrop, alpha: juice.ui.backdropAlpha, duration: juice.ui.backdropFadeMs })

    // Slow-turning gold sunburst behind the panel — the chart-standard "you
    // won" halo, procedural like everything else.
    const burst = this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, ensureSunburstTexture(this, 900))
      .setAlpha(0)
    this.tweens.add({ targets: burst, alpha: 1, duration: 500 })
    this.tweens.add({ targets: burst, angle: 360, duration: 90_000, repeat: -1 })

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60).setAlpha(0)

    const g = this.add.graphics()
    g.fillStyle(colors.panelDeep, 1)
    g.fillRoundedRect(-284, -324, 568, 648, 40)
    g.fillStyle(colors.panel, 1)
    g.fillRoundedRect(-280, -320, 560, 640, 36)
    g.lineStyle(4, theme.accent, 0.9)
    g.strokeRoundedRect(-280, -320, 560, 640, 36)
    panel.add(g)

    // CONGRATULATIONS over the title: the panel's job is to say "you did it"
    // before it says anything measurable, and "Hive Freed!" names the event
    // without praising the player for it. Small caps above the big gold line,
    // so it reads as a banner rather than a second headline.
    const congrats = this.add
      .text(0, -282, t('result.congrats'), {
        fontFamily: FONT_STACK,
        fontSize: '26px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setScale(0.86)
    panel.add(congrats)
    this.tweens.add({
      targets: congrats,
      alpha: 1,
      scale: 1,
      duration: 340,
      delay: 180,
      ease: 'Back.easeOut',
    })

    panel.add(
      this.add
        .text(0, -238, t('result.win'), {
          fontFamily: FONT_STACK,
          fontSize: '58px',
          color: theme.accentCss,
          stroke: '#000000',
          strokeThickness: 6,
        })
        .setOrigin(0.5),
    )

    // The fanfare lands WITH the panel, not with the last bee leaving — the
    // board already played `win()` at that moment. Music ducks under it.
    this.time.delayedCall(140, () => feedback.celebrate())

    // Star slots, then earned stars slam in one by one.
    const starXs = [-132, 0, 132]
    const starY = -110
    starXs.forEach((x, i) => {
      panel.add(this.add.star(x, starY + (i === 1 ? -14 : 0), 5, 26, 54, colors.starEmpty).setOrigin(0.5))
    })
    for (let i = 0; i < this.params.stars; i++) {
      const yBase = starY + (i === 1 ? -14 : 0)
      const star = this.add
        .star(starXs[i], yBase, 5, 26, 54, colors.starGold)
        .setOrigin(0.5)
        .setScale(3)
        .setAlpha(0)
      panel.add(star)
      this.time.delayedCall(juice.ui.starBaseDelayMs + i * juice.ui.starStaggerMs, () => {
        this.tweens.add({
          targets: star,
          scale: 1,
          alpha: 1,
          duration: juice.ui.starSlamMs,
          ease: 'Cubic.easeIn',
          onComplete: () => {
            feedback.star(i)
            this.cameras.main.shake(juice.ui.starLandShakeMs, juice.ui.starLandShakeIntensity)
          },
        })
      })
    }

    panel.add(
      this.add
        .text(0, -18, t('result.movesUsed', { used: this.params.movesUsed, budget: this.params.budget }), {
          fontFamily: FONT_STACK,
          fontSize: '26px',
          color: colors.hudTextCss,
        })
        .setOrigin(0.5)
        .setAlpha(0.85),
    )

    // A 2-star run gets told exactly what 3 stars would have taken — the star
    // chase drives replays for 300 levels and used to be a black box.
    const spareNeeded = this.params.threeStarSpare ?? 0
    if (this.params.stars === 2 && spareNeeded > 0) {
      panel.add(
        this.add
          .text(0, 14, t('result.threeStarHint', { n: spareNeeded }), {
            fontFamily: FONT_STACK,
            fontSize: '19px',
            color: theme.accentCss,
          })
          .setOrigin(0.5)
          .setAlpha(0.9),
      )
    }

    // Win-streak bonus callout (the flame paid ×1.5/×2 on this haul).
    const mult = winStreakMultiplier(saveManager.winStreak)
    if (mult > 1) {
      panel.add(
        this.add
          .text(0, 78, t('result.streakBonus', { m: mult }), {
            fontFamily: FONT_STACK,
            fontSize: '20px',
            color: '#ffb35c',
          })
          .setOrigin(0.5),
      )
    }

    // Honey reward line — drop + text centred as one cluster. The number TICKS
    // UP as droplets fly in (below), so it starts at 0.
    const honey = this.add.container(0, 48)
    const honeyLabel = this.add
      .text(0, 0, t('result.honey', { n: this.params.honey }), {
        fontFamily: FONT_STACK,
        fontSize: '32px',
        color: colors.honeyCss,
      })
      .setOrigin(0, 0.5)
    const cluster = 30 + 10 + honeyLabel.width // drop Ø + gap + label
    honeyLabel.setX(-cluster / 2 + 40)
    honey.add(drawHoneyDrop(this, -cluster / 2 + 15, 0, 15))
    honey.add(honeyLabel)
    panel.add(honey)
    this.flyHoneyToCounter(honeyLabel)

    // Opt-in rewarded DOUBLER on the happiest screen in the game — "2× your
    // haul" is the top-converting rewarded placement after revives. Created
    // always; visibility POLLS ad readiness (the ad may still be loading).
    const bonusBtn = makeButton(
      this,
      0,
      100,
      t('result.bonusAd'),
      () => void this.watchBonusAd(bonusBtn, honeyLabel),
      { width: 340, height: 54, fontSize: 22, primary: false },
    )
    panel.add(bonusBtn)
    bonusBtn.setVisible(adService.canOfferRewarded())
    const bonusPoll = this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        if (!this.bonusTaken && bonusBtn.active) bonusBtn.setVisible(adService.canOfferRewarded())
      },
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bonusPoll.remove())

    const total = this.params.mode === 'compass' ? COMPASS_COUNT : LEVEL_COUNT
    const hasNext = this.params.levelIndex < total - 1
    panel.add(
      makeButton(
        this,
        0,
        178,
        hasNext ? t('result.next') : t('result.menu'),
        () => void (hasNext ? this.goToLevel(this.params.levelIndex + 1) : this.goMenu()),
        { width: 400, height: 88, fontSize: 36, accent: theme.accent },
      ),
    )

    panel.add(
      makeButton(this, -110, 266, t('result.replay'), () => void this.goToLevel(this.params.levelIndex), {
        width: 200,
        height: 66,
        fontSize: 26,
        primary: false,
      }),
    )
    panel.add(
      makeButton(this, 110, 266, t('result.menu'), () => void this.goMenu(), {
        width: 200,
        height: 66,
        fontSize: 26,
        primary: false,
      }),
    )

    this.tweens.add({
      targets: panel,
      y: GAME_HEIGHT / 2,
      alpha: 1,
      duration: juice.ui.panelSlideMs,
      ease: 'Back.easeOut',
    })

    // Ask for a store review right after a perfect run — the one moment the
    // player is provably happy. ReviewService decides if it's actually due.
    this.time.delayedCall(juice.ui.panelSlideMs + 600, () => {
      void reviewService.maybeRequestReview(this.params.stars)
    })
  }

  /**
   * Fly a fan of honey droplets from the stars down onto the counter while the
   * number ticks up — the reward must be SEEN arriving, not just stated.
   */
  private flyHoneyToCounter(honeyLabel: Phaser.GameObjects.Text): void {
    const total = this.params.honey
    const drops = Math.max(3, Math.min(12, total))
    const dropKey = ensureDropTexture(this, 26)
    const targetX = GAME_WIDTH / 2
    const targetY = GAME_HEIGHT / 2 + 48
    let shown = 0
    honeyLabel.setText(t('result.honey', { n: 0 }))
    for (let i = 0; i < drops; i++) {
      const sx = GAME_WIDTH / 2 + Phaser.Math.Between(-140, 140)
      const sy = GAME_HEIGHT / 2 - 110 + Phaser.Math.Between(-20, 20)
      const drop = this.add.image(sx, sy, dropKey).setDepth(50).setAlpha(0)
      const curve = new Phaser.Curves.QuadraticBezier(
        new Phaser.Math.Vector2(sx, sy),
        new Phaser.Math.Vector2((sx + targetX) / 2 + Phaser.Math.Between(-80, 80), sy - 60),
        new Phaser.Math.Vector2(targetX, targetY),
      )
      this.tweens.addCounter({
        from: 0,
        to: 1,
        delay: juice.ui.starBaseDelayMs + 260 + i * 55,
        duration: 430,
        ease: 'Quad.easeIn',
        onStart: () => drop.setAlpha(1),
        onUpdate: (tw) => {
          const p = curve.getPoint(tw.getValue() ?? 0)
          drop.setPosition(p.x, p.y)
        },
        onComplete: () => {
          drop.destroy()
          shown = Math.min(total, Math.round(((i + 1) / drops) * total))
          honeyLabel.setText(t('result.honey', { n: shown }))
          honeyLabel.setScale(1.15)
          this.tweens.add({ targets: honeyLabel, scale: 1, duration: 90 })
          feedback.star(Math.min(2, i % 3))
        },
      })
    }
  }

  /** Rewarded 2× doubler: pays the level's haul AGAIN; one per win screen. */
  private async watchBonusAd(
    btn: Phaser.GameObjects.Container,
    honeyLabel: Phaser.GameObjects.Text,
  ): Promise<void> {
    if (this.busy || this.bonusTaken) return
    this.busy = true
    const ok = await adService.showRewarded()
    this.busy = false
    if (!this.scene.isActive('LevelComplete')) return
    if (!ok) return
    this.bonusTaken = true
    const bonus = this.params.honey
    saveManager.addHoney(bonus)
    honeyLabel.setText(t('result.honey', { n: this.params.honey + bonus }))
    honeyLabel.setScale(1.2)
    this.tweens.add({ targets: honeyLabel, scale: 1, duration: 140 })
    feedback.escape(1)
    btn.destroy()
  }

  private async goToLevel(index: number): Promise<void> {
    if (this.busy) return
    this.busy = true
    await adService.maybeShowInterstitial(this.params.levelIndex + 1)
    this.scene.stop('Game')
    this.scene.start('Game', { levelIndex: index, mode: this.params.mode })
  }

  private async goMenu(): Promise<void> {
    if (this.busy) return
    this.busy = true
    await adService.maybeShowInterstitial(this.params.levelIndex + 1)
    this.scene.stop('Game')
    this.scene.start('Menu')
  }
}
