export const GAME_WIDTH = 720
export const GAME_HEIGHT = 1280

export const colors = {
  // Neutral fallbacks (per-chapter visuals come from config/theme.ts).
  background: 0x241a10,
  backgroundDeep: 0x140d06,

  // Bee sprite (constant across chapters so it always reads as "the bee").
  beeBody: 0xffd23f,
  beeDark: 0x2a1d12,
  beeWing: 0xdcefff,
  arrow: 0xffffff,

  // HUD / text
  hudTextCss: '#fff3d6',
  hudWarnCss: '#ff6b57',

  // Panels (modal cards) — neutral dark glass, accent stroke supplied per scene.
  panel: 0x241d31,
  panelDeep: 0x191324,
  panelStroke: 0x4a4066,

  // Buttons
  buttonSecondary: 0x473f5e,
  buttonTextCss: '#241708',
  buttonSecondaryTextCss: '#efe9ff',

  // Stars / rewards
  starGold: 0xffc94d,
  starEmpty: 0x3b3550,
  honey: 0xffc94d,
  honeyCss: '#ffc94d',

  // Particles
  honeyParticle: 0xffc94d,
  dustParticle: 0xe8dcc4,

  // Overlays / locks
  dimBackdrop: 0x000000,
  locked: 0x2c2740,
  lockedStroke: 0x413a5c,
} as const

export const layout = {
  hudTopY: 86,
  // The moves pill is 96 tall and centred here, so its top edge is at
  // movesPillY - 48. Keep that clear of the title's descenders (title sits at
  // hudTopY with a 42px face) or the two visibly collide on device.
  movesPillY: 198,
  boardTop: 286,
  boardBottom: 1150,
  boardPaddingX: 40,
  maxCellSize: 74,
  minCellSize: 15,
  safeTop: 44,
} as const
