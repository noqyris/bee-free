export const GAME_WIDTH = 720
export const GAME_HEIGHT = 1280

export const colors = {
  background: 0x241a10,
  backgroundDeep: 0x1a120b,
  cellFill: 0xe8b04b,
  cellStroke: 0x8f6a2a,
  cellHighlight: 0xffffff,
  beeBody: 0xffd23f,
  beeDark: 0x33241a,
  beeWing: 0xcfe9ff,
  arrow: 0xffffff,
  hudText: 0xfff3d6,
  hudTextCss: '#fff3d6',
  hudWarnCss: '#ff6b57',
  panel: 0x3a2a1a,
  panelStroke: 0x8f6a2a,
  buttonPrimary: 0xffb020,
  buttonSecondary: 0x6b5232,
  buttonTextCss: '#2a1c0e',
  buttonSecondaryTextCss: '#ffe9bd',
  starGold: 0xffc94d,
  starEmpty: 0x55432c,
  honeyParticle: 0xffc94d,
  dustParticle: 0xd8cbb8,
  dimBackdrop: 0x000000,
} as const

export const layout = {
  hudTopY: 64,
  movesPillY: 168,
  boardTop: 260,
  boardBottom: 1140,
  boardPaddingX: 36,
  maxCellSize: 64,
  minCellSize: 16,
} as const
