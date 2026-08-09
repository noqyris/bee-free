/**
 * Power-ups ("super powers") and the honey economy (spec: monetization goal).
 *
 * Three power-ups, each usable mid-level. The player starts with a few of each;
 * they earn more by spending honey (the soft currency won by playing), by
 * watching a rewarded ad (+1), or by buying packs with real money in the shop.
 * Honey itself is also sold for money — that plus the packs is the revenue.
 */
export type PowerupKey = 'clean' | 'undo' | 'moves'

export const POWERUP_KEYS: readonly PowerupKey[] = ['clean', 'undo', 'moves'] as const

export interface PowerupDef {
  key: PowerupKey
  /** i18n key base: `powerup.<key>.name` / `.desc`. */
  nameKey: `powerup.${PowerupKey}.name`
  descKey: `powerup.${PowerupKey}.desc`
  /** Honey to buy one from the in-level bar / shop. */
  honeyCost: number
  /** Emoji/glyph fallback used until final icon art. */
  glyph: string
}

export const POWERUPS: Record<PowerupKey, PowerupDef> = {
  clean: { key: 'clean', nameKey: 'powerup.clean.name', descKey: 'powerup.clean.desc', honeyCost: 60, glyph: '🧽' },
  undo: { key: 'undo', nameKey: 'powerup.undo.name', descKey: 'powerup.undo.desc', honeyCost: 40, glyph: '↩️' },
  moves: { key: 'moves', nameKey: 'powerup.moves.name', descKey: 'powerup.moves.desc', honeyCost: 30, glyph: '➕' },
}

/** How many of each power-up a brand-new player owns. */
export const STARTING_POWERUPS = 3

/** Moves granted by the "+3 moves" power-up. */
export const MOVES_POWERUP_AMOUNT = 3

/** Honey handed out by one rewarded-ad view (the "watch for honey" option). */
export const AD_HONEY_REWARD = 50

/**
 * Max honey a "Sticky Hive" (flooded) level pays out from collections. Carving
 * the board force-collects 8–15 cells per run; uncapped that is ~5-10x a normal
 * level's haul, which would turn the specials into a farming spot and deflate
 * every honey price in the shop. Normal levels are never near this cap.
 */
export const FLOODED_HONEY_CAP = 6

// (The win-screen rewarded bonus is now a 2× DOUBLER of the level's actual
// haul — see LevelCompleteScene.watchBonusAd — so no flat constant remains.)

// ── Shop: real-money products (StoreKit / ASC IDs live in monetization.ts) ──

export type ShopKind = 'honey' | 'pack' | 'bundle' | 'removeAds'

export interface ShopProduct {
  /** Stable product id (also the StoreKit product identifier). */
  id: string
  kind: ShopKind
  titleKey: string
  /** Display price fallback; the store's localized price overrides at runtime. */
  price: string
  /** Honey granted on purchase (honey packs + bundle). */
  honey?: number
  /** Power-ups granted on purchase: key -> count. */
  powerups?: Partial<Record<PowerupKey, number>>
  /** Marketing flair. */
  badgeKey?: string
  best?: boolean
}

/**
 * The shop line-up. Honey packs fund buying power-ups with soft currency; the
 * per-power-up packs are the "10 for $0.99" the design asked for; the Starter is
 * the early best-value bundle that anchors the rest.
 */
export const SHOP_PRODUCTS: ShopProduct[] = [
  {
    id: 'com.beefree.hiveescape.starter',
    kind: 'bundle',
    titleKey: 'shop.starter.title',
    price: '$1.99',
    honey: 400,
    powerups: { clean: 5, undo: 5, moves: 5 },
    badgeKey: 'shop.badge.best',
    best: true,
  },
  { id: 'com.beefree.hiveescape.honey.s', kind: 'honey', titleKey: 'shop.honey.s', price: '$0.99', honey: 500 },
  { id: 'com.beefree.hiveescape.honey.m', kind: 'honey', titleKey: 'shop.honey.m', price: '$2.99', honey: 1800, badgeKey: 'shop.badge.popular' },
  { id: 'com.beefree.hiveescape.honey.l', kind: 'honey', titleKey: 'shop.honey.l', price: '$4.99', honey: 3500 },
  { id: 'com.beefree.hiveescape.pack.clean', kind: 'pack', titleKey: 'shop.pack.clean', price: '$0.99', powerups: { clean: 10 } },
  { id: 'com.beefree.hiveescape.pack.undo', kind: 'pack', titleKey: 'shop.pack.undo', price: '$0.99', powerups: { undo: 10 } },
  { id: 'com.beefree.hiveescape.pack.moves', kind: 'pack', titleKey: 'shop.pack.moves', price: '$0.99', powerups: { moves: 10 } },
]
