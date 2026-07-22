import { en } from './en'

export type StringKey = keyof typeof en

/**
 * Minimal i18n layer (spec §10): every user-facing string goes through t().
 * Adding a language = adding a table with the same keys and switching here.
 */
const table: Record<StringKey, string> = en

export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s: string = table[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(`{${k}}`, String(v))
    }
  }
  return s
}

/** Bases that have `.one` / `.other` (CLDR category) variants in the table. */
type PluralBase = 'result.beesLeft'

const pluralRules = new Intl.PluralRules('en')

/** Plural-aware lookup; falls back to `.other` for categories a table omits. */
export function tp(base: PluralBase, n: number, params?: Record<string, string | number>): string {
  const exact = `${base}.${pluralRules.select(n)}` as StringKey
  const key = exact in table ? exact : (`${base}.other` as StringKey)
  return t(key, { n, ...params })
}
