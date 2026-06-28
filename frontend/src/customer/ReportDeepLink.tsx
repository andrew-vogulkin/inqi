import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { LiveReport } from './LiveReport';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; inquiryId: string };

/**
 * Public, login-free report deep link (HP-16). Resolves the path token to an
 * inquiry id, then renders the live report. Prefers the report capability token
 * (`GET /reports/:token`); falls back to treating the token as an inquiry-id
 * capability (`GET /inquiries/:id/report-live`, the link older emails carry).
 * Invalid/expired → a friendly error, never a crash.
 */
export function ReportDeepLink({ token }: { token: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      try {
        const rep = await api.getReport(token);
        if (!cancelled && rep && !rep.error && rep.inquiryId) { setState({ status: 'ok', inquiryId: rep.inquiryId }); return; }
      } catch { /* fall through */ }
      try {
        const live = await api.reportLive(token);
        if (!cancelled && live && !live.error && live.inquiryId) { setState({ status: 'ok', inquiryId: live.inquiryId }); return; }
      } catch { /* fall through */ }
      if (!cancelled) setState({ status: 'error' });
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (state.status === 'loading') return <p style={{ color: '#aaa' }}>Loading your report…</p>;
  if (state.status === 'error') return (
    <div style={{ padding: 16, background: '#fff3f3', borderRadius: 8 }}>
      <b>Can't open this report</b>
      <p style={{ color: '#888', margin: '6px 0 12px' }}>This report link is invalid or has expired.</p>
      <a href="#/">Go to inqi →</a>
    </div>
  );
  return <LiveReport id={state.inquiryId} />;
}
