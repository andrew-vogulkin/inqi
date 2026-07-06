/**
 * Design tokens — the SINGLE SOURCE for inqi's visual system (FE-01).
 * Components reference these tokens (or the generated CSS variables), never raw hex.
 * Warm-paper, light-mode aesthetic; confident green primary; Geist + Geist Mono.
 */

export const color = {
  appBg: '#faf9f7',          // page background (warm paper)
  surface: '#ffffff',        // cards
  onSolid: '#ffffff',        // text/icon on a solid brand/danger fill
  surfaceSunken: '#f3f2ee',  // panels / insets
  surfaceAlt: '#f0efec',     // alt panels
  ink: '#1c1c1a',            // primary text
  inkSoft: '#3c3b37',        // headings / secondary
  muted: '#6f6e6a',          // meta text
  subtle: '#a3a29d',         // placeholder / disabled
  line: '#e9e8e4',           // hairline borders
  lineStrong: '#d8d7d2',     // dividers
  brand: '#168f5f',          // primary / success / qualified / CTA
  brandStrong: '#0f6f49',    // hover / active
  brandTint: '#eaf6ef',      // success backgrounds
  info: '#2f6fde',           // links / info / contacted-replied
  infoTint: '#eef3fd',
  warn: '#c2733a',           // warning / 402 / SOON / attention
  warnTint: '#fbf3e8',
  danger: '#c0463f',         // error / negative / bounce
  dangerTint: '#fbe4e4',
} as const;
export type ColorToken = keyof typeof color;

export const radius = { sm: 6, md: 8, lg: 12, xl: 14, pill: 9999 } as const;
export type RadiusToken = keyof typeof radius;

/** 4px spacing grid. `space(n)` = n × 4px; named steps cover the common scale. */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;
export type SpaceToken = keyof typeof space;

export const font = {
  ui: "'Geist', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  mono: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/** Dense, editorial type scale. Base 13px (UI range 11–15); headings 17 / 20 / 24. */
export const fontSize = { xs: 11, sm: 12, base: 13, md: 14, lg: 15, h3: 17, h2: 20, h1: 24 } as const;
export type FontSizeToken = keyof typeof fontSize;

export const fontWeight = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;

export const elevation = {
  none: 'none',
  sm: '0 1px 2px rgba(20,20,18,.06)',
  md: '0 2px 8px rgba(20,20,18,.08)',
} as const;
export type ElevationToken = keyof typeof elevation;

/** The whole token set, for the styleguide + CSS-variable generation. */
export const tokens = { color, radius, space, font, fontSize, fontWeight, elevation } as const;
export type Tokens = typeof tokens;
