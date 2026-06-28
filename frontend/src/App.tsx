import { CustomerView } from './customer/CustomerView';
import { AdminBoard } from './admin/AdminBoard';

// Minimal routing via hash: #/admin or #/q/<token> or default customer view.
export function App() {
  const hash = window.location.hash;
  const view = hash.startsWith('#/admin') ? 'admin' : 'customer';
  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>inqi</h1>
        <nav style={{ display: 'flex', gap: 12 }}>
          <a href="#/">Customer</a><a href="#/admin">Admin</a>
        </nav>
      </header>
      {view === 'admin' ? <AdminBoard /> : <CustomerView />}
    </div>
  );
}
