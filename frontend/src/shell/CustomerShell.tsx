import { ReactNode } from 'react';
import { Route, hrefFor } from '../conventions/routes';
import { color, space, fontSize, fontWeight, radius } from '../theme/tokens';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

/**
 * Customer area shell — a thin brand bar (no left rail; screens own their own
 * headers/actions, matching the prototype) + a centered content column.
 */
export function CustomerShell({ children }: { children: ReactNode; active?: Route }) {
  const session = useSelector((s) => s.session.session);
  const dispatch = useAppDispatch();
  return (
    <div style={{ minHeight: '100%', background: color.appBg }}>
      <header style={{ position: 'sticky', top: 0, background: color.appBg, borderBottom: `1px solid ${color.line}`, zIndex: 10 }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: `${space[3]}px ${space[5]}px`, display: 'flex', alignItems: 'center', gap: space[2] }}>
          <a href={hrefFor({ route: Route.Dashboard })} style={{ display: 'flex', alignItems: 'center', gap: space[2], textDecoration: 'none' }}>
            <span style={{ width: 24, height: 24, borderRadius: radius.sm, background: color.brand, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: fontWeight.bold, fontSize: fontSize.base }}>i</span>
            <span style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: color.ink, letterSpacing: '-.01em' }}>inqi</span>
          </a>
          <span style={{ flex: 1 }} />
          {session
            ? <span style={{ fontSize: fontSize.sm, color: color.muted }}>{session.customer.email} · <a href={hrefFor({ route: Route.SignIn })} onClick={(e) => { e.preventDefault(); dispatch({ type: ActionType.SignedOut }); }}>sign out</a></span>
            : <a href={hrefFor({ route: Route.SignIn })} style={{ fontSize: fontSize.sm }}>Sign in</a>}
        </div>
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: `${space[8]}px ${space[6]}px ${space[12]}px` }}>{children}</main>
    </div>
  );
}
