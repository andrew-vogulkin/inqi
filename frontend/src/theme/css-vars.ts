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
/* Sonar brand loader (design "Variant B"): one ping per heartbeat — a slow lub-dub
   pulse of the mark sends a wavefront out; echo targets light as it reaches them. */
@keyframes inqi-sonar-wave { 0% { transform: translate(-50%,-50%) scale(.6); opacity:.6; } 55% { opacity:.16; } 73% { transform: translate(-50%,-50%) scale(2.4); opacity:0; } 100% { transform: translate(-50%,-50%) scale(2.4); opacity:0; } }
@keyframes inqi-sonar-wave-dub { 0%,12% { transform: translate(-50%,-50%) scale(.6); opacity:0; } 14% { opacity:.4; } 46% { transform: translate(-50%,-50%) scale(1.5); opacity:0; } 100% { transform: translate(-50%,-50%) scale(1.5); opacity:0; } }
@keyframes inqi-sonar-echo { 0% { opacity:0; transform:scale(.2); } 4% { opacity:1; transform:scale(1.35); } 9% { opacity:.95; transform:scale(1); } 46% { opacity:0; transform:scale(.85); } 100% { opacity:0; transform:scale(.85); } }
@keyframes inqi-sonar-heart { 0% { transform: translate(-50%,-50%) scale(1); } 5% { transform: translate(-50%,-50%) scale(1.09); } 11% { transform: translate(-50%,-50%) scale(1); } 17% { transform: translate(-50%,-50%) scale(1.05); } 24% { transform: translate(-50%,-50%) scale(1); } 100% { transform: translate(-50%,-50%) scale(1); } }
@media (prefers-reduced-motion: reduce) {
  [data-sonar] * { animation: none !important; }
}
/* Horizontal scroller with an ALWAYS-visible scrollbar — macOS overlay scrollbars
   hide until scrolled, which reads as "cannot scroll right" on wide content
   (workflow diagrams). Applied via className to overflow-x containers. */
.inqi-hscroll { overflow-x: auto; scrollbar-width: thin; scrollbar-color: var(--color-line-strong) var(--color-surface-sunken); }
.inqi-hscroll::-webkit-scrollbar { height: 10px; }
.inqi-hscroll::-webkit-scrollbar-track { background: var(--color-surface-sunken); border-radius: 5px; }
.inqi-hscroll::-webkit-scrollbar-thumb { background: var(--color-line-strong); border-radius: 5px; border: 2px solid var(--color-surface-sunken); }
.inqi-hscroll::-webkit-scrollbar-thumb:hover { background: var(--color-subtle); }
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
