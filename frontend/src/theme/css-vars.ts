import { color, radius, space, fontSize, elevation, font } from './tokens';

/**
 * Generate the `:root` CSS-variable block from the design tokens (single source).
 * Kebab-cases each token: color.brandStrong → `--color-brand-strong`. Base/global
 * CSS references these; components may use either the TS tokens or `var(--…)`.
 */
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

export function cssVariables(): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(color)) lines.push(`--color-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(radius)) lines.push(`--radius-${kebab(k)}: ${typeof v === 'number' ? `${v}px` : v};`);
  for (const [k, v] of Object.entries(space)) lines.push(`--space-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(fontSize)) lines.push(`--font-size-${kebab(k)}: ${v}px;`);
  for (const [k, v] of Object.entries(elevation)) lines.push(`--elevation-${kebab(k)}: ${v};`);
  lines.push(`--font-ui: ${font.ui};`);
  lines.push(`--font-mono: ${font.mono};`);
  return `:root {\n  ${lines.join('\n  ')}\n}`;
}

/** Base/reset styles + token-driven body, injected once at boot. */
export function baseStyles(): string {
  return `
* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--font-size-base);
  line-height: 1.5;
  color: var(--color-ink);
  background: var(--color-app-bg);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--color-info); text-decoration: none; }
a:hover { text-decoration: underline; }
button { font-family: inherit; }
h1, h2, h3 { color: var(--color-ink-soft); margin: 0; font-weight: 600; }
::placeholder { color: var(--color-subtle); }
@keyframes inqi-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes inqi-spin { to { transform: rotate(360deg); } }
@keyframes inqi-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
`;
}

/** Inject the token CSS variables + base styles into <head> exactly once. */
export function injectTokens(doc: Document = document): void {
  const id = 'inqi-tokens';
  if (doc.getElementById(id)) return;
  const el = doc.createElement('style');
  el.id = id;
  el.textContent = `${cssVariables()}\n${baseStyles()}`;
  doc.head.appendChild(el);
}
