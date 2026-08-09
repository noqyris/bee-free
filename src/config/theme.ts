/**
 * Chapter theming (spec §5): the palette shifts every 25 levels. Each chapter
 * has a background gradient, an accent, and cell colors. Cell fills are kept
 * clearly darker than BOTH the bright-yellow bee and the amber honey pool, so
 * bees pop and — now that honey sits under every bee and never dries — the honey
 * reads as a distinct wet layer even in the amber-toned early chapters.
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
    cellFill: 0xa9741d,
    cellStroke: 0x6b4211,
    textCss: '#fff3d6',
  },
  {
    key: 'amber-sunset',
    bgTop: 0x4a2716,
    bgBottom: 0x27130a,
    accent: 0xff9f43,
    accentCss: '#ff9f43',
    cellFill: 0xa85824,
    cellStroke: 0x6e3416,
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
  // Ch7–12 — the back half (L151–300). Non-amber cell fills so the honey keeps
  // popping, each palette clearly distinct from the last.
  {
    key: 'emerald-grove',
    bgTop: 0x123a24,
    bgBottom: 0x081f13,
    accent: 0x49d98a,
    accentCss: '#49d98a',
    cellFill: 0x2ba368,
    cellStroke: 0x145a38,
    textCss: '#dcffe9',
  },
  {
    key: 'crimson-ember',
    bgTop: 0x481420,
    bgBottom: 0x270a11,
    accent: 0xff6b7d,
    accentCss: '#ff6b7d',
    cellFill: 0xd44a5c,
    cellStroke: 0x821f2e,
    textCss: '#ffe0e5',
  },
  {
    key: 'violet-nebula',
    bgTop: 0x2c1a4c,
    bgBottom: 0x160b28,
    accent: 0xb17bff,
    accentCss: '#b17bff',
    cellFill: 0x8a55d9,
    cellStroke: 0x442a80,
    textCss: '#efe6ff',
  },
  {
    key: 'glacier-ice',
    bgTop: 0x123246,
    bgBottom: 0x081a26,
    accent: 0x53c6ff,
    accentCss: '#53c6ff',
    cellFill: 0x2f9ad6,
    cellStroke: 0x14587a,
    textCss: '#ddf4ff',
  },
  {
    key: 'coral-sunset',
    bgTop: 0x4a2413,
    bgBottom: 0x28120a,
    accent: 0xff8a5c,
    accentCss: '#ff8a5c',
    cellFill: 0xdb6a3f,
    cellStroke: 0x8a3b1c,
    textCss: '#ffe7db',
  },
  {
    key: 'royal-abyss',
    bgTop: 0x241844,
    bgBottom: 0x100a24,
    accent: 0xc9a24a,
    accentCss: '#c9a24a',
    cellFill: 0x6a4fb0,
    cellStroke: 0x342866,
    textCss: '#efe8ff',
  },
]

export function themeForChapter(chapter: number): ChapterTheme {
  const i = Math.max(0, Math.min(CHAPTER_THEMES.length - 1, chapter - 1))
  return CHAPTER_THEMES[i]
}
