import { useEffect, useState } from 'react';
import { CustomerView } from './customer/CustomerView';
import { CustomerDashboard } from './customer/CustomerDashboard';
import { ReportDeepLink } from './customer/ReportDeepLink';
import { AdminBoard } from './admin/AdminBoard';
import { useSession } from './lib/auth';

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

// Hash routing:
//   #/r/:token   → public report deep link (no login)
//   #/admin      → admin board (login + allowlist)
//   #/dashboard  → customer's own inquiries (login)
//   #/i/:id      → customer's own live inquiry view
//   #/           → intake
export function App() {
  const hash = useHashRoute();
  const deep = hash.match(/^#\/r\/([^/?]+)/);

  // The shareable report is fully standalone: wordmark only, no nav, no login.
  if (deep) return (
    <Frame>
      <ReportDeepLink token={decodeURIComponent(deep[1])} />
    </Frame>
  );

  let view: JSX.Element;
  if (hash.startsWith('#/admin')) view = <AdminBoard />;
  else if (hash.startsWith('#/dashboard')) view = <CustomerDashboard />;
  else view = <CustomerView />;

  return (
    <Frame>
      <Nav active={hash} />
      {view}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginBottom: 16 }}>
        <a href="#/" style={{ textDecoration: 'none', color: 'inherit' }}><h1 style={{ margin: 0 }}>inqi</h1></a>
      </header>
      {children}
    </div>
  );
}

function Nav({ active }: { active: string }) {
  const { session, signOut } = useSession();
  const link = (href: string, label: string) => {
    const on = href === '#/' ? (active === '#/' || active === '') : active.startsWith(href);
    return <a href={href} style={{ fontWeight: on ? 700 : 400 }}>{label}</a>;
  };
  return (
    <nav style={{ display: 'flex', gap: 14, alignItems: 'baseline', marginBottom: 20, fontSize: 14 }}>
      {link('#/', 'New inquiry')}
      {link('#/dashboard', 'My inquiries')}
      {link('#/admin', 'Admin')}
      <span style={{ flex: 1 }} />
      {session
        ? <span style={{ color: '#888' }}>{session.customer.email} · <a href="#" onClick={e => { e.preventDefault(); signOut(); }}>sign out</a></span>
        : <span style={{ color: '#aaa' }}>not signed in</span>}
    </nav>
  );
}
