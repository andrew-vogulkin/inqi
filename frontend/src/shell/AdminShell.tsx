import { ReactNode } from 'react';
import { Route, hrefFor, navigate } from '../conventions/routes';
import { color, space, fontSize, fontWeight, radius } from '../theme/tokens';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

/**
 * Admin console shell — in-product **left sidebar** (operator console), matching the
 * updated prototype. Three grouped sections; drill-in screens (inquiry, thread,
 * dossier, per-report board/cost) highlight their parent nav item. The prototype's
 * separate demo "navigator rail" is chrome and is intentionally NOT shipped (FE-01 §2).
 */
type Item = { key: string; icon: string; label: string; route: Route; live?: boolean };
const GROUPS: { label: string; items: Item[] }[] = [
  { label: 'Operations', items: [
    { key: 'board', icon: '▦', label: 'Live board', route: Route.Admin, live: true },
    { key: 'run', icon: '⊳', label: 'Run controls', route: Route.AdminRun },
  ] },
  { label: 'Insight', items: [
    { key: 'cost', icon: '$', label: 'Cost per report', route: Route.AdminCostOverview },
    { key: 'audit', icon: '☰', label: 'Audit trail', route: Route.AdminAudit },
  ] },
  { label: 'Configuration', items: [
    { key: 'workflows', icon: '⌥', label: 'Workflow versions', route: Route.AdminWorkflows },
    { key: 'topup', icon: '+', label: 'Credit top-up', route: Route.AdminCredits },
  ] },
];
// Which sidebar item is highlighted for a given route (drill-ins map to their parent).
const ACTIVE_KEY: Partial<Record<Route, string>> = {
  [Route.Admin]: 'board', [Route.AdminReport]: 'board', [Route.AdminInquiry]: 'board', [Route.AdminThread]: 'board', [Route.AdminDossier]: 'board',
  [Route.AdminRun]: 'run',
  [Route.AdminCostOverview]: 'cost', [Route.AdminCost]: 'cost',
  [Route.AdminAudit]: 'audit',
  [Route.AdminWorkflows]: 'workflows',
  [Route.AdminCredits]: 'topup',
};

export function AdminShell({ children, active }: { children: ReactNode; active: Route }) {
  const session = useSelector((s) => s.session.session);
  const dispatch = useAppDispatch();
  const activeKey = ACTIVE_KEY[active] ?? 'board';
  const email = session?.customer.email ?? 'operator';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: color.appBg }}>
      <aside style={{ width: 228, flex: 'none', background: color.surface, borderRight: `1px solid ${color.line}`, display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
        {/* brand */}
        <div style={{ padding: '18px 18px 14px', borderBottom: `1px solid ${color.surfaceAlt}`, display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: color.ink, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: fontWeight.bold, fontSize: fontSize.md }}>i</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: fontWeight.semibold, color: color.ink, lineHeight: 1.1 }}>inqi</div>
            <div style={{ fontSize: fontSize.xs, color: color.subtle }}>Operator console</div>
          </div>
        </div>

        {/* grouped nav */}
        <nav style={{ padding: '12px 12px 4px', flex: 1 }}>
          {GROUPS.map((grp) => (
            <div key={grp.label} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10.5, letterSpacing: '.08em', color: color.subtle, fontWeight: fontWeight.semibold, textTransform: 'uppercase', padding: '0 10px 6px' }}>{grp.label}</div>
              {grp.items.map((item) => {
                const on = item.key === activeKey;
                return (
                  <a key={item.key} href={hrefFor({ route: item.route })}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: radius.md, fontSize: fontSize.base, marginBottom: 1, textDecoration: 'none', background: on ? color.surfaceSunken : 'transparent', color: on ? color.ink : color.muted, fontWeight: on ? fontWeight.semibold : fontWeight.regular }}>
                    <span style={{ width: 18, textAlign: 'center', flex: 'none', fontSize: fontSize.base }}>{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.live && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color.brand, flex: 'none', animation: 'inqi-pulse 1.4s ease-in-out infinite' }} />}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>

        {/* operator footer */}
        <div style={{ padding: '14px 16px', borderTop: `1px solid ${color.surfaceAlt}`, display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 28, height: 28, borderRadius: '50%', background: color.ink, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.sm, fontWeight: fontWeight.semibold, flex: 'none' }}>{email[0]?.toUpperCase() ?? 'A'}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: fontWeight.medium, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
            <div style={{ fontSize: fontSize.xs, color: color.subtle }}>Operator · <a href={hrefFor({ route: Route.SignIn })} onClick={(e) => { e.preventDefault(); dispatch({ type: ActionType.SignedOut }); }} style={{ color: color.subtle }}>sign out</a></div>
          </div>
          <button onClick={() => navigate({ route: Route.Dashboard })} title="Exit to customer app" style={{ fontSize: fontSize.md, color: color.subtle, flex: 'none', background: 'transparent', border: 'none', cursor: 'pointer' }}>⇲</button>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, overflowX: 'hidden', padding: space[5] }}>{children}</main>
    </div>
  );
}
