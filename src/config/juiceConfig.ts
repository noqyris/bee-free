/**
 * Every gameplay-feel timing/ease/particle parameter lives here so the whole
 * game can be tuned from one place (spec §7). Scenes must not hardcode feel
 * numbers.
 */
export const juice = {
  flight: {
    msPerCell: 50,
    minDurationMs: 160,
    /** Pixels the bee keeps flying past the board edge before despawning. */
    overshootPx: 760,
    ease: 'Cubic.easeIn',
    /** Sideways arc height as a fraction of cell size. */
    arcFactor: 0.35,
    scaleUp: 1.12,
    trail: {
      frequencyMs: 18,
      speedMin: 5,
      speedMax: 30,
      scaleStart: 0.55,
      alphaStart: 0.9,
      lifespanMs: 260,
      /** Grace period after flight ends so trail particles fade instead of popping. */
      fadeOutMs: 400,
    },
  },
  bump: {
    msPerCell: 55,
    minDurationMs: 110,
    /** Where flight stops, as a fraction of neighbor distance short of the blocker center. */
    contactOffset: 0.58,
    squashAlong: 0.62,
    squashAcross: 1.32,
    squashMs: 80,
    returnMs: 200,
    blockerPulseScale: 1.18,
    blockerPulseMs: 130,
    dust: {
      count: 10,
      /** Puff anchor: this fraction of neighbor distance short of the blocker center. */
      offsetFromBlocker: 0.33,
      speedMin: 30,
      speedMax: 130,
      scaleStart: 0.7,
      alphaStart: 0.8,
      lifespanMinMs: 150,
      lifespanMaxMs: 350,
    },
  },
  escape: {
    shakeMs: 90,
    shakeIntensity: 0.0035,
    burst: {
      count: 16,
      speedMin: 60,
      speedMax: 320,
      scaleStart: 0.9,
      lifespanMinMs: 200,
      lifespanMaxMs: 450,
    },
    comboWindowMs: 2000,
    comboParticleBonus: 4,
    comboParticleCap: 24,
  },
  idle: {
    breatheScale: 1.05,
    breatheMs: 850,
    breatheJitterMs: 300,
    startDelayJitterMs: 500,
    wiggleRad: 0.05,
    wiggleMs: 1300,
    wiggleJitterMs: 400,
  },
  /** Honey blobs appearing along a flown path, rippling in the bee's wake. */
  honey: {
    layStaggerMs: 45,
    splashDots: 3,
  },
  /** Press-to-aim feedback: the grabbed bee lifts slightly under the finger. */
  press: {
    liftScale: 1.12,
    liftMs: 70,
    /** Preview dims to this alpha while the finger has slid off the bee. */
    cancelAlpha: 0.22,
  },
  spawn: {
    staggerMs: 28,
    popMs: 240,
  },
  ui: {
    counterPunchScale: 1.25,
    counterPunchMs: 110,
    buttonPressScale: 0.93,
    buttonPressMs: 60,
    panelSlideMs: 240,
    backdropFadeMs: 200,
    backdropAlpha: 0.62,
    starBaseDelayMs: 250,
    starSlamMs: 260,
    starStaggerMs: 170,
    starLandShakeMs: 60,
    starLandShakeIntensity: 0.004,
    resultDelayWinMs: 400,
    resultDelayLoseMs: 520,
    menuBeeBobMs: 1100,
    failBeeWobbleMs: 900,
    /** Cross-scene fade (Home ↔ Menu ↔ Game ↔ Shop). */
    sceneFadeMs: 150,
    /** Doomed moves-pill pulse (movesLeft < bees remaining). */
    doomedPulseMs: 640,
    doomedPulseAlpha: 0.35,
  },
} as const
