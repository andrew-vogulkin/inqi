import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/auth';
import { SignInGate } from '../lib/GoogleSignIn';
import { LiveReport } from './LiveReport';

// Customer: sign in, submit a request (credit-gated, HP-19), then watch the report
// assemble live. The customer's own live view is `#/i/:id`; the shareable, login-free
// report link is `#/r/:token` (see ReportDeepLink).
export function CustomerView() {
  const initial = (() => { const m = window.location.hash.match(/^#\/i\/(.+)$/); return m ? m[1] : null; })();
  const { session } = useSession();
  const [id, setId] = useState<string | null>(initial);

  if (id) return <LiveReport id={id} owner />;
  if (!session) return <SignInGate title="Sign in to start an inquiry" hint="your email" />;
  return <IntakeForm onStarted={setId} />;
}

function IntakeForm({ onStarted }: { onStarted: (id: string) => void }) {
  const [req, setReq] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => { api.myCredits().then(c => setBalance(typeof c?.balance === 'number' ? c.balance : null)).catch(() => {}); }, []);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const inq = await api.createInquiry({ rawRequest: req });
      if (inq?.error) {
        setError(inq.error.code === 'CREDITS_INSUFFICIENT'
          ? "You're out of credits. Ask an admin to top up your balance, then try again."
          : (inq.error.message ?? 'could not start the inquiry'));
        return;
      }
      if (!inq?.id) throw new Error('could not start the inquiry');
      window.location.hash = `#/i/${inq.id}`;
      onStarted(inq.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not start the inquiry');
    } finally { setBusy(false); }
  }

  const noCredits = balance === 0;
  return (
    <section>
      <h2>What are you looking for?</h2>
      <p>Item, service, place to rent, organisation, goods or a trade — describe it.</p>
      {balance !== null && (
        <div style={{ fontSize: 13, color: noCredits ? '#c62828' : '#2e7d32', marginBottom: 8 }}>
          Credits: <b>{balance}</b>{noCredits && ' — top up needed to run a report'}
        </div>
      )}
      <textarea placeholder="e.g. a refurbished espresso machine for a small cafe in Lisbon, under EUR 1500" value={req} onChange={e => setReq(e.target.value)} rows={4} style={{ width: '100%', padding: 8 }} />
      <button onClick={submit} disabled={!req || busy} style={{ marginTop: 8 }}>{busy ? 'Starting…' : 'Start research (1 credit)'}</button>
      {error && <p style={{ color: '#c62828' }}>{error}</p>}
    </section>
  );
}
