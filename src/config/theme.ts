/**
 * Chapter theming (spec §5): the palette shifts every 25 levels. Each chapter
 * has a background gradient, an accent, and cell colors. Cell fills are kept a
 * shade darker than the bright-yellow bee so bees always pop, in every chapter.
 */
export interface ChapterTheme {
  readonly key: string
  readonly bgTop: number
  readonly bgBottom: number
  readonly accent: number
  readonly accentCss: string
  readonly cellFill: number
  readonly cellStroke: number
  readonly textCss: string
}

export const CHAPTER_THEMES: ReadonlyArray<ChapterTheme> = [
  {
    key: 'golden-hive',
    bgTop: 0x3f2f16,
    bgBottom: 0x201607,
    accent: 0xffc93c,
    accentCss: '#ffc93c',
    cellFill: 0xd99a2e,
    cellStroke: 0x7a4d16,
    textCss: '#fff3d6',
  },
  {
    key: 'amber-sunset',
    bgTop: 0x4a2716,
    bgBottom: 0x27130a,
    accent: 0xff9f43,
    accentCss: '#ff9f43',
    cellFill: 0xdb7d38,
    cellStroke: 0x8a3f1c,
    textCss: '#ffe9d6',
  },
  {
    key: 'lavender-dusk',
    bgTop: 0x2f2552,
    bgBottom: 0x161031,
    accent: 0xc490ff,
    accentCss: '#c490ff',
    cellFill: 0x9d74e0,
    cellStroke: 0x4c3488,
    textCss: '#efe6ff',
  },
  {
    key: 'teal-deep',
    bgTop: 0x123c3b,
    bgBottom: 0x081f1f,
    accent: 0x37d6bf,
    accentCss: '#37d6bf',
    cellFill: 0x2bb4a1,
    cellStroke: 0x146458,
    textCss: '#dcfff8',
  },
  {
    key: 'rose-bloom',
    bgTop: 0x4c1a32,
    bgBottom: 0x290c1b,
    accent: 0xff6fa5,
    accentCss: '#ff6fa5',
    cellFill: 0xe25a86,
    cellStroke: 0x8a2b50,
    textCss: '#ffe3ee',
  },
  {
    key: 'midnight-swarm',
    bgTop: 0x1b2044,
    bgBottom: 0x0a0c20,
    accent: 0x7f9bff,
    accentCss: '#7f9bff',
    cellFill: 0x5f79d6,
    cellStroke: 0x2f3f7a,
    textCss: '#e3e9ff',
  },
]

export function themeForChapter(chapter: number): ChapterTheme {
  const i = Math.max(0, Math.min(CHAPTER_THEMES.length - 1, chapter - 1))
  return CHAPTER_THEMES[i]
}
