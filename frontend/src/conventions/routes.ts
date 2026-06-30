import { LayoutMode } from './enums';

/**
 * Route table (convention #1). Hash-based (`#/path`) so the SPA needs no server
 * rewrite. Patterns use `:param` segments. Feature pages are placeholders in FE-01;
 * real screens land in FE-02+.
 */
export const Route = {
  Home: '/',
  StyleGuide: '/styleguide',
  SignIn: '/signin',
  Dashboard: '/dashboard',
  NewInquiry: '/new',
  Credits: '/credits',
  Inquiry: '/i/:id',
  Freemium: '/f/:id',
  Dossier: '/d/:id/:ref',
  Report: '/r/:token',
  Questionnaire: '/q/:token',
  Admin: '/admin',
  AdminRun: '/admin/run',                 // FE-12 run controls (top-level; auto-selects an inquiry)
  AdminCostOverview: '/admin/cost',       // FE-13 cost (top-level; auto-selects an inquiry)
  AdminCredits: '/admin/topup',           // FE-16 operator credit top-up
  AdminAudit: '/admin/audit',
  AdminWorkflows: '/admin/workflows',
  AdminInquiry: '/admin/i/:id',
  AdminCost: '/admin/i/:id/cost',
  AdminSubtask: '/admin/s/:id',
  AdminThread: '/admin/t/:id',
  AdminDossier: '/admin/d/:id/:ref',
} as const;
export type Route = (typeof Route)[keyof typeof Route];

export interface RouteMeta {
  layout: LayoutMode;
  requiresAuth: boolean; // signed-out → SignIn redirect (401 screen)
  adminOnly: boolean;    // non-admin → Forbidden (403 screen)
}

/** Per-route layout + guard policy. */
export const ROUTE_META: Record<Route, RouteMeta> = {
  [Route.Home]: { layout: LayoutMode.Customer, requiresAuth: false, adminOnly: false },
  [Route.StyleGuide]: { layout: LayoutMode.Bare, requiresAuth: false, adminOnly: false },
  [Route.SignIn]: { layout: LayoutMode.Bare, requiresAuth: false, adminOnly: false },
  [Route.Dashboard]: { layout: LayoutMode.Customer, requiresAuth: true, adminOnly: false },
  [Route.NewInquiry]: { layout: LayoutMode.Customer, requiresAuth: true, adminOnly: false },
  [Route.Credits]: { layout: LayoutMode.Customer, requiresAuth: true, adminOnly: false },
  [Route.Inquiry]: { layout: LayoutMode.Customer, requiresAuth: true, adminOnly: false },
  [Route.Freemium]: { layout: LayoutMode.Customer, requiresAuth: true, adminOnly: false },
  [Route.Dossier]: { layout: LayoutMode.Customer, requiresAuth: true, adminOnly: false },     // customer provenance (redacted outreach)
  [Route.Report]: { layout: LayoutMode.Bare, requiresAuth: true, adminOnly: false },          // HP-24: report deep link now owner-gated
  [Route.Questionnaire]: { layout: LayoutMode.Bare, requiresAuth: true, adminOnly: false },    // HP-24: questionnaire now owner-gated
  [Route.Admin]: { layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true },
  [Route.AdminRun]: { layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true },            // FE-12 run controls (top-level)
  [Route.AdminCostOverview]: { layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true },   // FE-13 cost (top-level)
  [Route.AdminCredits]: { layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true },        // FE-16 credit top-up
  [Route.AdminAudit]: { layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true },          // FE-14 audit trail
  [Route.AdminWorkflows]: { layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true },      // FE-15 workflow versions
  [Route.AdminInquiry]: { layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true },
  [Route.AdminCost]: { layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true },          // FE-13 per-report cost rollup
  [Route.AdminSubtask]: { layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true },      // FE-11 subtask system view
  [Route.AdminThread]: { layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true },        // FE-17 outreach thread
  [Route.AdminDossier]: { layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true },     // admin provenance (may show the chain)
};

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

/** Build a hash href for a route, filling `:params`. */
export function hrefFor({ route, params = {} }: { route: Route; params?: Record<string, string> }): string {
  const path = route.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''));
  return `#${path}`;
}

/** Imperative navigation (FE-02: sign-in → Dashboard; 401 → Sign in). */
export function navigate({ route, params = {} }: { route: Route; params?: Record<string, string> }): void {
  window.location.hash = hrefFor({ route, params }).slice(1); // strip '#'; the browser re-adds it
}

/**
 * HP-24 — bounce a signed-out deep link to Sign in, remembering where to resume.
 * The current hash path is carried as `?returnTo=` so sign-in (or a notification link)
 * can land the user back where they intended.
 */
export function redirectToSignIn(): void {
  const current = window.location.hash.replace(/^#/, '') || '/';
  if (current.split('?')[0] === Route.SignIn) return; // already there — don't loop
  window.location.hash = `${Route.SignIn}?returnTo=${encodeURIComponent(current)}`;
}

/** Read a same-app `returnTo` target from the current hash query (set by `redirectToSignIn`). */
export function readReturnTo(): string | null {
  const q = window.location.hash.split('?')[1];
  const rt = q ? new URLSearchParams(q).get('returnTo') : null;
  return rt && rt.startsWith('/') && !rt.startsWith('//') ? rt : null; // same-app hash paths only
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const ps = pattern.split('/').filter(Boolean);
  const xs = path.split('/').filter(Boolean);
  if (ps.length !== xs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(':')) params[ps[i].slice(1)] = decodeURIComponent(xs[i]);
    else if (ps[i] !== xs[i]) return null;
  }
  return params;
}

/** Parse the current hash into a typed route match, or null (→ 404). */
export function matchRoute(hash: string): RouteMatch | null {
  const path = (hash.replace(/^#/, '') || '/').split('?')[0];
  // Exact (static) routes win over param routes.
  const all = Object.values(Route) as Route[];
  const ordered = [...all].sort((a, b) => Number(a.includes(':')) - Number(b.includes(':')));
  for (const route of ordered) {
    const params = matchPattern(route, path);
    if (params) return { route, params };
  }
  return null;
}
