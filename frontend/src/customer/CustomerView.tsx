import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useEvents, InqiEvent } from '../lib/socket';
import { signIn } from '../lib/auth';

const TERMINAL = ['REPORT_DELIVERED', 'DENIED', 'DROPPED', 'FAILED', 'CANCELLED'];

// Customer: submit a request, confirm the subject, then watch the report assemble live.
export function CustomerView() {
  const initial = (() => { const m = window.location.hash.match(/^#\/r\/(.+)$/); return m ? m[1] : null; })();
  const [id, setId] = useState<string | null>(initial);
  const [req, setReq] = useState('');
  const [email, setEmail] = useState('');

  async function submit() {
    const inq = await api.createInquiry({ customerEmail: email, rawRequest: req });
    // Dev sign-in so the owner-scoped dashboard read works (AUTH_VERIFIER=stub). In
    // production this is replaced by a real Sign in with Google → signIn(idToken).
    try { await signIn(`stub:${email}`); } catch { /* report webview still works via the public capability route */ }
    window.location.hash = `#/r/${inq.id}`;
    setId(inq.id);
  }

  if (!id) return (
    <section>
      <h2>What are you looking for?</h2>
      <p>Item, service, place to rent, organisation, goods or a trade — describe it.</p>
      <input placeholder="your email" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 8 }} />
      <textarea placeholder="e.g. a refurbished espresso machine for a small cafe in Lisbon, under EUR 1500" value={req} onChange={e => setReq(e.target.value)} rows={4} style={{ width: '100%', padding: 8 }} />
      <button onClick={submit} disabled={!req || !email} style={{ marginTop: 8 }}>Start research</button>
    </section>
  );
  return <LiveReport id={id} />;
}

function LiveReport({ id }: { id: string }) {
  const events = useEvents({ inquiryId: id });
  const [report, setReport] = useState<any>(null);
  const [qToken, setQToken] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const lastLen = useRef(0);

  // Re-assemble the live report whenever new events arrive (options appear + re-rank live).
  useEffect(() => {
    if (events.length === lastLen.current && report) return;
    lastLen.current = events.length;
    api.reportLive(id).then(setReport).catch(() => {});
  }, [events.length, id]);

  // Surface the questionnaire link until the customer confirms the subject.
  useEffect(() => {
    if (confirmed) return;
    api.getInquiry(id).then(inq => {
      const q = inq?.questionnaire;
      if (q?.token && !q.confirmed) setQToken(q.token);
      if (q?.confirmed) setConfirmed(true);
    }).catch(() => {});
  }, [events.length, id, confirmed]);

  async function confirm() {
    if (!qToken) return;
    await api.submitQuestionnaire(qToken, { confirmedSubject: true, answers: {} });
    setConfirmed(true); setQToken(null);
  }

  const state: string = report?.state ?? '…';
  const done = TERMINAL.includes(state);
  const options: any[] = report?.options ?? [];

  return (
    <section>
      <h2>Your inquiry <StatePill state={state} /></h2>
      <p style={{ color: '#888', fontSize: 13 }}>{report?.rawRequest}</p>

      {qToken && !confirmed && (
        <div style={{ padding: 12, background: '#fff8e1', borderRadius: 8, margin: '12px 0' }}>
          Please confirm we understood your request correctly.
          <button onClick={confirm} style={{ marginLeft: 12 }}>Yes, that's right →</button>
        </div>
      )}

      {!done && confirmed && (
        <div style={{ padding: 10, background: '#eef4ff', borderRadius: 8, margin: '12px 0' }}>
          🔎 Research in progress — {options.length} option(s) found so far. This updates live.
        </div>
      )}

      {report?.summary && done && (
        <div style={{ padding: 12, background: '#eef9ee', borderRadius: 8, margin: '12px 0' }}>
          {report.reusedFrom && <em>♻️ Reused from a similar recent report. </em>}{report.summary}
        </div>
      )}

      <h3>Options {options.length > 0 && <span style={{ color: '#888', fontWeight: 400 }}>(ranked live by quality + price)</span>}</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {options.map((o, i) => (
          <div key={o.subjectProvider + i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 10, alignItems: 'center', padding: 10, border: '1px solid #eee', borderRadius: 8 }}>
            <b style={{ color: '#aaa' }}>#{i + 1}</b>
            <div>
              <b>{o.subjectProvider}</b>
              <div style={{ fontSize: 12, color: '#888' }}>
                quality {Math.round((o.qualityScore ?? 0) * 100)}% · score {Math.round((o.score ?? 0) * 100)}%
                {o.availability ? ` · ${o.availability}` : ''}{o.leadTime ? ` · ${o.leadTime}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontWeight: 600 }}>{o.price != null ? `${o.price} ${o.currency ?? ''}` : '—'}</div>
          </div>
        ))}
        {options.length === 0 && <div style={{ color: '#aaa' }}>No options yet…</div>}
      </div>

      <h3 style={{ marginTop: 20 }}>Live activity</h3>
      <Timeline events={events} />
    </section>
  );
}

function Timeline({ events }: { events: InqiEvent[] }) {
  const human = (e: InqiEvent) => {
    const d = e.data ?? {};
    switch (e.type) {
      case 'inquiry.transitioned': return `→ ${d.to}`;
      case 'agent.progress': return `${d.stage}: ${d.message}`;
      case 'wave.released': return `released wave ${d.wave} (${d.count} provider${d.count === 1 ? '' : 's'})`;
      case 'funnel.widened': return `widened the search (+${d.added})`;
      case 'message.sent': return `emailed a provider`;
      case 'message.received': return `reply received`;
      case 'subtask.updated': return `provider ${d.status}`;
      case 'report.ready': return `report ready — ${d.options ?? ''} options`;
      case 'run.reaped': return `recovered a stalled step (${d.action})`;
      default: return e.type;
    }
  };
  const shown = events.filter(e => e.type !== 'agent.heartbeat').slice(-40).reverse();
  return (
    <ol style={{ maxHeight: 280, overflow: 'auto', fontSize: 13, paddingLeft: 18 }}>
      {shown.map(e => (
        <li key={e.id} style={{ marginBottom: 2 }}>
          <span style={{ color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>{e.at ? new Date(e.at).toLocaleTimeString() : ''}</span>{' '}
          {human(e)}
        </li>
      ))}
    </ol>
  );
}

function StatePill({ state }: { state: string }) {
  const color = state === 'REPORT_DELIVERED' ? '#2e7d32' : ['DENIED', 'DROPPED', 'FAILED', 'CANCELLED'].includes(state) ? '#c62828' : '#1565c0';
  return <span style={{ fontSize: 12, fontWeight: 600, color, border: `1px solid ${color}`, borderRadius: 12, padding: '2px 10px', marginLeft: 8 }}>{state}</span>;
}
