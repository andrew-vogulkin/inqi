import { ReactNode } from 'react';
import { Route, hrefFor } from '../conventions/routes';
import { color, space, fontSize, fontWeight } from '../theme/tokens';
import { MonoRef } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

/**
 * Admin console shell — desktop-first **top** nav. The prototype's left rail is
 * prototype chrome and is intentionally NOT shipped (FE-01 §2).
 */
export function AdminShell({ children, active }: { children: ReactNode; active: Route }) {
  const session = useSelector((s) => s.session.session);
  const dispatch = useAppDispatch();
  const link = (route: Route, label: string) => (
    <a href={hrefFor({ route })} style={{ color: route === active ? color.brandStrong : color.muted, fontWeight: route === active ? fontWeight.semibold : fontWeight.regular, textDecoration: 'none' }}>{label}</a>
  );
  return (
    <div style={{ minHeight: '100%' }}>
      <header style={{ background: color.surface, borderBottom: `1px solid ${color.lineStrong}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: `${space[3]}px ${space[5]}px`, display: 'flex', alignItems: 'center', gap: space[5] }}>
          <span style={{ fontSize: fontSize.h3, fontWeight: fontWeight.bold, color: color.ink }}>inqi <MonoRef muted>operator</MonoRef></span>
          <nav style={{ display: 'flex', gap: space[4], fontSize: fontSize.base }}>
            {link(Route.Admin, 'Live board')}
            {link(Route.AdminWorkflows, 'Workflows')}
            {link(Route.AdminAudit, 'Audit')}
          </nav>
          <span style={{ flex: 1 }} />
          {session && <span style={{ fontSize: fontSize.sm, color: color.muted }}>{session.customer.email} ({session.customer.role}) · <a href={hrefFor({ route: Route.Home })} onClick={(e) => { e.preventDefault(); dispatch({ type: ActionType.SignedOut }); }}>sign out</a></span>}
        </div>
      </header>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: space[5] }}>{children}</main>
    </div>
  );
}
