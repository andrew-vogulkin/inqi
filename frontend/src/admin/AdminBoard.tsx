import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useEvents, InqiEvent } from '../lib/socket';

// Admin: live board of all inquiries, epics, subtasks and results.
export function AdminBoard() {
  const events = useEvents({ admin: true });
  const [inquiries, setInquiries] = useState<any[]>([]);
  useEffect(() => { api.listInquiries().then(setInquiries); }, [events.length]);

  // group subtask states from the live stream
  const subtasks = new Map<string, any>();
  for (const e of events) if (e.subtaskId && (e.type === 'subtask.created' || e.type === 'subtask.updated'))
    subtasks.set(e.subtaskId, { ...subtasks.get(e.subtaskId), ...e.data, id: e.subtaskId });

  return (
    <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      <div>
        <h2>Inquiries</h2>
        {inquiries.map(i => <div key={i.id} style={{ padding: 8, borderBottom: '1px solid #eee' }}>
          <b>{i.state}</b> — {i.rawRequest.slice(0, 60)}
        </div>)}
      </div>
      <div>
        <h2>Subtasks (live)</h2>
        {[...subtasks.values()].map(s => <div key={s.id} style={{ padding: 6 }}>
          <span style={{ display: 'inline-block', width: 90 }}>w{s.wave} {badge(s.status)}</span>
          {s.subjectProviderName} {s.result ? `— $${s.result.price}, ${s.result.availability}` : ''}
        </div>)}
        <h3 style={{ marginTop: 24 }}>Event stream</h3>
        <div style={{ maxHeight: 240, overflow: 'auto', fontSize: 12, fontFamily: 'monospace' }}>
          {events.slice(-50).reverse().map((e: InqiEvent) => <div key={e.id}>{e.type} {e.data?.stage || ''} {e.data?.message || ''}</div>)}
        </div>
      </div>
    </section>
  );
}
const badge = (s?: string) => ({ pending: '⚪', researching: '🔵', qualified: '🟢', failed: '🔴' } as any)[s ?? 'pending'] ?? '⚪';
