import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useEvents, InqiEvent } from '../lib/socket';
import { useSession } from '../lib/auth';
import { SignInGate } from '../lib/GoogleSignIn';

const badge = (s?: string) => (({ pending: '⚪', researching: '🔵', contacted: '📨', replied: '💬', qualified: '🟢', failed: '🔴', skipped: '⏭️' } as any)[s ?? 'pending'] ?? '⚪');
const TERMINAL = ['REPORT_DELIVERED', 'DENIED', 'DROPPED', 'FAILED', 'CANCELLED'];

// Admin: live board of inquiries → epics → subtasks → findings, with the agent event stream.
export function AdminBoard() {
  const events = useEvents({ admin: true });
  const { session, signOut } = useSession();
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { if (session) api.listInquiries().then(r => setInquiries(Array.isArray(r) ? r : [])).catch(() => {}); }, [events.length, session?.token]);

  if (!session) return <SignInGate title="Admin sign-in" hint="allowlisted admin email" />;
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
      {isAdmin && <div style={{ gridColumn: '1 / -1' }}><WorkflowsPanel /></div>}
    </section>
  );
}

// HP-12: workflow-version management (list + publish).
function WorkflowsPanel() {
  const [versions, setVersions] = useState<any[]>([]);
  const load = () => api.listWorkflows().then(r => setVersions(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);
  const publish = (v: any) => { if (confirm(`Publish ${v.key} v${v.version} (activate; current active → archived)?`)) api.publishWorkflow(v.id).then(() => alert('Published')).then(load).catch(() => alert('Publish failed')); };
  return (
    <div style={{ marginTop: 24, borderTop: '1px solid #eee', paddingTop: 16 }}>
      <h3>Workflow versions</h3>
      <table style={{ fontSize: 13, borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left', color: '#888' }}><th style={{ padding: '4px 16px 4px 0' }}>key</th><th style={{ padding: '4px 16px 4px 0' }}>version</th><th style={{ padding: '4px 16px 4px 0' }}>status</th><th style={{ padding: '4px 16px 4px 0' }}>pinned</th><th></th></tr></thead>
        <tbody>
          {versions.map(v => (
            <tr key={v.id}>
              <td style={{ padding: '4px 16px 4px 0' }}>{v.key}</td>
              <td style={{ padding: '4px 16px 4px 0' }}>v{v.version}</td>
              <td style={{ padding: '4px 16px 4px 0' }}><b style={{ color: v.status === 'active' ? '#2e7d32' : v.status === 'draft' ? '#1565c0' : '#999' }}>{v.status}</b></td>
              <td style={{ padding: '4px 16px 4px 0' }}>{v.pinnedInquiries}</td>
              <td>{v.status !== 'active' && <button style={{ fontSize: 12 }} onClick={() => publish(v)}>Publish</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const live = isAdmin && !TERMINAL.includes(inq.state);
  const onHold = inq.state === 'ON_HOLD';
  const confirmDo = (label: string, fn: () => Promise<any>) => () => { if (confirm(`${label} this inquiry?`)) fn().then(() => api.getInquiry(id).then(setInq)); };

  return (
    <div>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatePill state={inq.state} />
        {live && !onHold && <button onClick={confirmDo('Pause', () => api.pauseInquiry(id))} style={{ fontSize: 12 }}>⏸ Pause</button>}
        {live && onHold && <button onClick={confirmDo('Resume', () => api.resumeInquiry(id))} style={{ fontSize: 12 }}>▶ Resume</button>}
        {live && <button onClick={confirmDo('Cancel', () => api.cancelInquiry(id))} style={{ fontSize: 12 }}>✕ Cancel</button>}
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

      {isAdmin && inq.customerId && <TopUpControl customerId={inq.customerId} />}
      {isAdmin && <CostPanel id={id} signal={mine.length} />}
      {isAdmin && <AuditPanel id={id} signal={mine.length} />}
    </div>
  );
}

// HP-19: admin manual credit top-up for this inquiry's owner.
function TopUpControl({ customerId }: { customerId: string }) {
  const [amount, setAmount] = useState(5);
  const [msg, setMsg] = useState<string | null>(null);
  const topUp = async () => {
    setMsg(null);
    const r = await api.topUpCredits(customerId, amount, 'admin top-up');
    setMsg(r?.error ? `failed: ${r.error.message ?? r.error.code}` : `✓ balance now ${r.balance}`);
  };
  return (
    <div style={{ marginTop: 16 }}>
      <h3>Credits (owner)</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="number" min={1} value={amount} onChange={e => setAmount(Math.max(1, Number(e.target.value) || 1))} style={{ width: 70, padding: 6 }} />
        <button onClick={topUp} style={{ fontSize: 13 }}>Top up</button>
        {msg && <span style={{ fontSize: 13, color: msg.startsWith('✓') ? '#2e7d32' : '#c62828' }}>{msg}</span>}
      </div>
    </div>
  );
}

// HP-15: operator-only cost summary (tokens + outreach → $).
function CostPanel({ id, signal }: { id: string; signal: number }) {
  const [c, setC] = useState<any>(null);
  useEffect(() => { api.getCost(id).then(setC).catch(() => {}); }, [id, signal]);
  if (!c || c.error) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <h3>Cost to us <span style={{ color: '#2e7d32' }}>~{c.grandTotalUsd} {c.currency}</span> <span style={{ color: '#aaa', fontWeight: 400, fontSize: 12 }}>(operator-only)</span></h3>
      <div style={{ fontSize: 13, color: '#555' }}>
        {(c.perModel ?? []).map((m: any) => (
          <div key={m.model}>{m.model}: {m.promptTokens}+{m.completionTokens} tok · ~{m.estUsd} {c.currency}</div>
        ))}
        {(!c.perModel || c.perModel.length === 0) && <div style={{ color: '#aaa' }}>No model token usage (local / keyless).</div>}
        <div style={{ marginTop: 4 }}>
          outreach: {c.outreach.emails} emails · {c.outreach.replies} replies · {c.outreach.discovery} discovery · {c.outreach.research} research · {c.outreach.embeddings} embeddings · ~{c.outreach.estUsd} {c.currency}
        </div>
        <div style={{ color: '#888' }}>tokens total: {c.tokenTotal}</div>
      </div>
    </div>
  );
}

// HP-14: read-only audit trail for an inquiry (filterable by type).
function AuditPanel({ id, signal }: { id: string; signal: number }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  useEffect(() => { api.getAudit(id, filter).then(r => setEntries(r?.entries ?? [])).catch(() => {}); }, [id, filter, signal]);
  const TYPES = ['', 'denial', 'compliance_block', 'agent_action', 'transition', 'operator_action'];
  const color = (t: string) => (({ denial: '#c62828', compliance_block: '#ad1457', agent_action: '#1565c0', transition: '#6a1b9a', operator_action: '#ef6c00' } as any)[t] ?? '#555');
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Audit trail
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ fontSize: 12 }}>
          {TYPES.map(t => <option key={t} value={t}>{t || 'all types'}</option>)}
        </select>
      </h3>
      <div style={{ maxHeight: 240, overflow: 'auto', fontSize: 12 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid #f3f3f3' }}>
            <span style={{ color: '#bbb' }}>{new Date(e.at).toLocaleString()}</span>{' '}
            <b style={{ color: color(e.type) }}>{e.type}</b> · <span title="actor">{e.actor}</span>
            {e.reason ? <span style={{ color: '#888' }}> — {e.reason}</span> : ''}
            {e.data?.event ? <span style={{ color: '#888' }}> ({e.data.from}→{e.data.to})</span> : ''}
            {e.data?.action ? <span style={{ color: '#888' }}> [{e.data.action}]</span> : ''}
          </div>
        ))}
        {entries.length === 0 && <div style={{ color: '#aaa' }}>No audit entries.</div>}
      </div>
    </div>
  );
}

function StatePill({ state }: { state: string }) {
  const color = state === 'REPORT_DELIVERED' ? '#2e7d32' : ['DENIED', 'DROPPED', 'FAILED', 'CANCELLED'].includes(state) ? '#c62828' : '#1565c0';
  return <span style={{ fontSize: 12, fontWeight: 600, color, border: `1px solid ${color}`, borderRadius: 12, padding: '2px 10px' }}>{state}</span>;
}
