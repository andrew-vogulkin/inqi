import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useEvents, InqiEvent } from '../lib/socket';
import { useSession } from '../lib/auth';

const badge = (s?: string) => (({ pending: '⚪', researching: '🔵', contacted: '📨', replied: '💬', qualified: '🟢', failed: '🔴', skipped: '⏭️' } as any)[s ?? 'pending'] ?? '⚪');
const TERMINAL = ['REPORT_DELIVERED', 'DENIED', 'DROPPED', 'FAILED', 'CANCELLED'];

// Admin: live board of inquiries → epics → subtasks → findings, with the agent event stream.
export function AdminBoard() {
  const events = useEvents({ admin: true });
  const { session, signIn, signOut } = useSession();
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [email, setEmail] = useState('');

  useEffect(() => { if (session) api.listInquiries().then(r => setInquiries(Array.isArray(r) ? r : [])).catch(() => {}); }, [events.length, session?.token]);

  if (!session) return (
    <section>
      <h2>Admin sign-in</h2>
      <p style={{ color: '#888' }}>Sign in with Google (admins are granted by the <code>ADMIN_EMAILS</code>/<code>ADMIN_DOMAIN</code> allowlist). In dev (stub verifier), enter an allowlisted email.</p>
      <input placeholder="admin email" value={email} onChange={e => setEmail(e.target.value)} style={{ padding: 8, marginRight: 8 }} />
      <button onClick={() => signIn(`stub:${email}`).catch(() => alert('sign-in failed'))} disabled={!email}>Sign in</button>
    </section>
  );
  const isAdmin = session.customer.role === 'admin';

  return (
    <section style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24 }}>
      <div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          {session.customer.email} ({session.customer.role}) · <a href="#" onClick={(e) => { e.preventDefault(); signOut(); }}>sign out</a>
        </div>
        {!isAdmin && <div style={{ padding: 8, background: '#fff3f3', borderRadius: 6, marginBottom: 8, fontSize: 13 }}>You're signed in as a customer — the board shows only your inquiries; admin actions are hidden.</div>}
        <h2>Inquiries <span style={{ color: '#aaa', fontWeight: 400, fontSize: 13 }}>({inquiries.length})</span></h2>
        {inquiries.map(i => (
          <div key={i.id} onClick={() => setSelected(i.id)}
            style={{ padding: 8, borderBottom: '1px solid #eee', cursor: 'pointer', background: selected === i.id ? '#f0f6ff' : undefined }}>
            <div><StatePill state={i.state} /></div>
            <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>{i.rawRequest.slice(0, 70)}</div>
          </div>
        ))}
      </div>
      <div>
        {selected ? <InquiryDetail id={selected} events={events} isAdmin={isAdmin} /> : <p style={{ color: '#aaa' }}>Select an inquiry to see its live board.</p>}
      </div>
    </section>
  );
}

function InquiryDetail({ id, events, isAdmin }: { id: string; events: InqiEvent[]; isAdmin: boolean }) {
  const [inq, setInq] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const mine = events.filter(e => e.inquiryId === id);

  useEffect(() => {
    api.getInquiry(id).then(setInq).catch(() => {});
    api.reportLive(id).then(setReport).catch(() => {});
  }, [id, mine.length]);

  if (!inq || inq.error) return <p style={{ color: '#aaa' }}>{inq?.error ? 'Not authorized to view this inquiry.' : 'Loading…'}</p>;
  const epics: any[] = inq.epics ?? [];
  const canCancel = isAdmin && !TERMINAL.includes(inq.state);

  return (
    <div>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <StatePill state={inq.state} />
        {canCancel && <button onClick={() => api.cancelInquiry(id)} style={{ fontSize: 12 }}>Cancel run</button>}
      </h2>
      <p style={{ color: '#888', fontSize: 13 }}>{inq.rawRequest}</p>

      {epics.map(ep => {
        const byWave = new Map<number, any[]>();
        for (const s of ep.subtasks ?? []) { const w = byWave.get(s.wave) ?? []; w.push(s); byWave.set(s.wave, w); }
        return (
          <div key={ep.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#666' }}>Epic · {ep.strategy} · target {ep.targetQualifiedOptions} · <b>{ep.status}</b> · released waves [{(ep.releasedWaves ?? []).join(', ')}]</div>
            {[...byWave.keys()].sort((a, b) => a - b).map(w => (
              <div key={w} style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: '#999' }}>Wave {w}</div>
                {byWave.get(w)!.map(s => (
                  <div key={s.id} style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 13 }}>
                    <span style={{ width: 24 }}>{badge(s.status)}</span>
                    <span style={{ width: 180 }}>{s.subjectProviderName}</span>
                    <span style={{ color: '#888' }}>{s.status}{s.personaId ? ` · ${s.personaId}` : ''}{s.result?.price ? ` · ${s.result.price} ${s.result.currency ?? ''}` : ''}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}

      <h3>Findings / options ({report?.options?.length ?? 0})</h3>
      <div style={{ display: 'grid', gap: 4 }}>
        {(report?.options ?? []).map((o: any, i: number) => (
          <div key={i} style={{ fontSize: 13 }}>#{i + 1} <b>{o.subjectProvider}</b> — {o.price != null ? `${o.price} ${o.currency ?? ''}` : '—'} · q{Math.round((o.qualityScore ?? 0) * 100)}% · score {Math.round((o.score ?? 0) * 100)}%</div>
        ))}
      </div>

      <h3 style={{ marginTop: 16 }}>Agent event stream</h3>
      <div style={{ maxHeight: 260, overflow: 'auto', fontSize: 12, fontFamily: 'monospace', background: '#fafafa', padding: 8, borderRadius: 6 }}>
        {mine.filter(e => e.type !== 'agent.heartbeat').slice(-80).reverse().map(e => (
          <div key={e.id}><span style={{ color: '#bbb' }}>{e.at ? new Date(e.at).toLocaleTimeString() : ''}</span> {e.type} {e.data?.stage || ''} {e.data?.message || e.data?.wave != null ? `w${e.data.wave}` : ''} {e.data?.action || ''}</div>
        ))}
      </div>
    </div>
  );
}

function StatePill({ state }: { state: string }) {
  const color = state === 'REPORT_DELIVERED' ? '#2e7d32' : ['DENIED', 'DROPPED', 'FAILED', 'CANCELLED'].includes(state) ? '#c62828' : '#1565c0';
  return <span style={{ fontSize: 12, fontWeight: 600, color, border: `1px solid ${color}`, borderRadius: 12, padding: '2px 10px' }}>{state}</span>;
}
