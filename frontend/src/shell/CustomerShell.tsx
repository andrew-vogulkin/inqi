import { ReactNode } from 'react';
import { Route, hrefFor } from '../conventions/routes';
import { color, space, fontSize, fontWeight } from '../theme/tokens';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

/** Customer area shell — mobile-first top bar (no left rail). */
export function CustomerShell({ children, active }: { children: ReactNode; active: Route }) {
  const session = useSelector((s) => s.session.session);
  const dispatch = useAppDispatch();
  const link = (route: Route, label: string) => (
    <a href={hrefFor({ route })} style={{ color: route === active ? color.brandStrong : color.muted, fontWeight: route === active ? fontWeight.semibold : fontWeight.regular, textDecoration: 'none' }}>{label}</a>
  );
  return (
    <div style={{ minHeight: '100%' }}>
      <header style={{ position: 'sticky', top: 0, background: color.appBg, borderBottom: `1px solid ${color.line}`, zIndex: 10 }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: `${space[3]}px ${space[4]}px`, display: 'flex', alignItems: 'center', gap: space[4] }}>
          <a href={hrefFor({ route: Route.Home })} style={{ fontSize: fontSize.h3, fontWeight: fontWeight.bold, color: color.ink, textDecoration: 'none' }}>inqi</a>
          <nav style={{ display: 'flex', gap: space[3], fontSize: fontSize.base }}>
            {link(Route.NewInquiry, 'New')}
            {link(Route.Dashboard, 'My inquiries')}
            {link(Route.Credits, 'Credits')}
          </nav>
          <span style={{ flex: 1 }} />
          {session
            ? <span style={{ fontSize: fontSize.sm, color: color.muted }}>{session.customer.email} · <a href={hrefFor({ route: Route.Home })} onClick={(e) => { e.preventDefault(); dispatch({ type: ActionType.SignedOut }); }}>sign out</a></span>
            : <a href={hrefFor({ route: Route.SignIn })} style={{ fontSize: fontSize.sm }}>Sign in</a>}
        </div>
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: space[4] }}>{children}</main>
    </div>
  );
}
