import { useState } from 'react';
import { api } from '../lib/api';
import { useEvents } from '../lib/socket';

// Customer: submit a request, then watch its progress + final report live.
export function CustomerView() {
  const [id, setId] = useState<string | null>(null);
  const [req, setReq] = useState('');
  const [email, setEmail] = useState('');

  async function submit() {
    const inq = await api.createInquiry({ customerEmail: email, rawRequest: req });
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
  return <InquiryProgress id={id} />;
}

function InquiryProgress({ id }: { id: string }) {
  const events = useEvents({ inquiryId: id });
  const report = events.find(e => e.type === 'report.ready');
  return (
    <section>
      <h2>Your inquiry</h2>
      <p style={{ color: '#666' }}>id: {id}</p>
      {report && <div style={{ padding: 12, background: '#eef9ee', borderRadius: 8, marginBottom: 16 }}>
        Report ready — {report.data.options} options. <a href={`#/`}>Open report</a> (token {report.data.reportToken})
      </div>}
      <ol>
        {events.map(e => <li key={e.id}><b>{e.type}</b> {e.data?.message || e.data?.to || ''}</li>)}
      </ol>
    </section>
  );
}
