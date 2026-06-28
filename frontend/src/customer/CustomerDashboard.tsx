import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/auth';
import { SignInGate } from '../lib/GoogleSignIn';
import { StatePill } from './LiveReport';

/** Customer's own inquiries (login-gated, owner-scoped server-side via the Bearer session). */
export function CustomerDashboard() {
  const { session } = useSession();
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    setItems(null); setError(null);
    api.listInquiries()
      .then(r => setItems(Array.isArray(r) ? r : []))
      .catch(() => setError('Could not load your inquiries.'));
  }, [session?.token]);

  if (!session) return <SignInGate title="Sign in to see your inquiries" hint="your email" />;

  return (
    <section>
      <CreditsPanel signal={items?.length ?? 0} />
      <h2>Your inquiries {items && <span style={{ color: '#aaa', fontWeight: 400, fontSize: 13 }}>({items.length})</span>}</h2>
      {error && <p style={{ color: '#c62828' }}>{error}</p>}
      {items === null && !error && <p style={{ color: '#aaa' }}>Loading…</p>}
      {items?.length === 0 && <p style={{ color: '#aaa' }}>No inquiries yet. <a href="#/">Start one →</a></p>}
      <div style={{ display: 'grid', gap: 6 }}>
        {(items ?? []).map(i => (
          <a key={i.id} href={`#/i/${i.id}`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'center', padding: 10, border: '1px solid #eee', borderRadius: 8, textDecoration: 'none', color: 'inherit' }}>
            <StatePill state={i.state} />
            <span style={{ fontSize: 14 }}>{(i.rawRequest ?? '').slice(0, 90)}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

// HP-19: the customer's credit balance + ledger history.
function CreditsPanel({ signal }: { signal: number }) {
  const [c, setC] = useState<any>(null);
  useEffect(() => { api.myCredits().then(setC).catch(() => {}); }, [signal]);
  if (!c || c.error) return null;
  const label = (k: string) => (({ topup: 'top-up', reserve: 'reserved', charge: 'charged', refund: 'refunded' } as any)[k] ?? k);
  const sign = (k: string) => (k === 'topup' || k === 'refund' ? '+' : k === 'reserve' ? '−' : '·');
  return (
    <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 8, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Credits</h3>
        <b style={{ color: c.balance > 0 ? '#2e7d32' : '#c62828', fontSize: 20 }}>{c.balance}</b>
        <span style={{ color: '#aaa', fontSize: 12 }}>1 credit per report run</span>
      </div>
      {(c.history ?? []).length > 0 && (
        <div style={{ maxHeight: 160, overflow: 'auto', fontSize: 12, marginTop: 8 }}>
          {c.history.map((e: any) => (
            <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '70px 56px 1fr auto', gap: 8, padding: '2px 0', borderBottom: '1px solid #f5f5f5' }}>
              <span style={{ color: '#888' }}>{label(e.kind)}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: e.kind === 'reserve' ? '#c62828' : e.kind === 'charge' ? '#888' : '#2e7d32' }}>{sign(e.kind)}{e.amount}</span>
              <span style={{ color: '#aaa' }}>{e.reason ?? (e.inquiryId ? `inquiry ${String(e.inquiryId).slice(0, 8)}…` : '')}</span>
              <span style={{ color: '#ccc' }}>{new Date(e.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
