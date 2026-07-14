import { ReactNode, useEffect, useState } from 'react';
import { AsyncStatus, AccessScreen } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import {
  CostMetric, COST_METRIC_LABEL, OUTREACH_ACTION_LABEL, WEB_SEARCH_SOURCE_LABEL,
  deriveCostView, formatUsd, formatInt,
} from '../conventions/cost';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { adminApi, ApiError } from '../api';
import { UsageReportDto } from '../api/types';
import { Card, MonoRef, Skeleton, ErrorState, Badge } from '../ui';
import { toneForReportState, toneColors } from '../ui/tone';
import { AccessScreenView } from './AccessScreens';

/**
 * FE-19 — admin aggregate usage report (HP-15). Combined cost across every report
 * in a from/to window (the same rollup as the per-report cost view), plus the list
 * of reports that contributed. `GET /admin/usage`; non-admin → Forbidden.
 */

/** `YYYY-MM-DD` for an offset-from-today date (local), for the default range. */
function isoDay(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

export function AdminUsage() {
  const [from, setFrom] = useState(isoDay(30));
  const [to, setTo] = useState(isoDay(0));
  const [status, setStatus] = useState<AsyncStatus>(AsyncStatus.Loading);
  const [forbidden, setForbidden] = useState(false);
  const [data, setData] = useState<UsageReportDto | null>(null);

  useEffect(() => {
    let live = true;
    setStatus(AsyncStatus.Loading);
    setForbidden(false);
    const t = setTimeout(() => {
      adminApi.usageReport({ from, to })
        .then((d) => { if (live) { setData(d); setStatus(AsyncStatus.Ready); } })
        .catch((err) => {
          if (!live) return;
          if (err instanceof ApiError && err.httpStatus === 403) { setForbidden(true); setStatus(AsyncStatus.Error); }
          else setStatus(AsyncStatus.Error);
        });
    }, 250); // debounce the date pickers
    return () => { live = false; clearTimeout(t); };
  }, [from, to]);

  if (forbidden) return <AccessScreenView screen={AccessScreen.Forbidden} />;

  const view = data ? deriveCostView({ cost: data.totals }) : null;

  return (
    <div style={{ display: 'grid', gap: space[4] }} data-testid="usage-report">
      <header style={{ display: 'flex', alignItems: 'flex-end', gap: space[3], flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: fontSize.h2, margin: 0 }}>Usage report</h1>
          <div style={{ fontSize: fontSize.sm, color: color.subtle, marginTop: 2 }}>Combined cost across all reports in the window.</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: space[3] }}>
          <DateField label="From" value={from} onChange={setFrom} testid="usage-from" />
          <DateField label="To" value={to} onChange={setTo} testid="usage-to" />
        </div>
      </header>

      {status === AsyncStatus.Loading && <Card><Skeleton width="40%" /></Card>}
      {status === AsyncStatus.Error && !forbidden && (
        <ErrorState title="Couldn't load usage" message="The usage report is unavailable right now." />
      )}

      {status === AsyncStatus.Ready && data && view && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: space[3] }}>
            <Tile label="Reports" value={formatInt({ value: data.reportCount })} testid="usage-report-count" />
            <Tile label={COST_METRIC_LABEL[CostMetric.Total]} value={formatUsd({ amount: view.totalUsd, currency: view.currency })} testid="usage-total" />
            <Tile label={COST_METRIC_LABEL[CostMetric.Tokens]} value={formatInt({ value: view.tokenTotal })} testid="usage-tokens" />
            <Tile label="Web searches" value={formatInt({ value: view.webSearch.calls })} testid="usage-websearch" />
          </div>

          {/* combined cost breakdown (same shape as the per-report cost view) */}
          <Card>
            <h2 style={{ fontSize: fontSize.h3, marginTop: 0 }}>Combined breakdown</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSize.sm }}>
              <thead>
                <tr style={{ textAlign: 'left', color: color.muted }}>
                  <Th>Line item</Th><Th right>Prompt</Th><Th right>Completion</Th><Th right>Est. cost</Th>
                </tr>
              </thead>
              <tbody>
                {view.perModel.map((m) => (
                  <tr key={m.model} style={{ borderTop: `1px solid ${color.line}` }}>
                    <Td>{m.model}</Td>
                    <Td right><MonoRef>{formatInt({ value: m.promptTokens })}</MonoRef></Td>
                    <Td right><MonoRef>{formatInt({ value: m.completionTokens })}</MonoRef></Td>
                    <Td right><MonoRef>{formatUsd({ amount: m.estUsd, currency: view.currency })}</MonoRef></Td>
                  </tr>
                ))}
                {view.outreach.map((r, i) => (
                  <tr key={r.action} style={{ borderTop: `1px solid ${color.line}` }}>
                    <Td>{OUTREACH_ACTION_LABEL[r.action]}</Td>
                    <Td right><MonoRef muted>—</MonoRef></Td>
                    <Td right><MonoRef>{formatInt({ value: r.count })}</MonoRef></Td>
                    <Td right><MonoRef muted>{i === 0 ? formatUsd({ amount: view.outreachUsd, currency: view.currency }) : ''}</MonoRef></Td>
                  </tr>
                ))}
                <tr style={{ borderTop: `1px solid ${color.line}` }}>
                  <Td>Web searches · {view.webSearch.provider}</Td>
                  <Td right><MonoRef muted>—</MonoRef></Td>
                  <Td right><MonoRef>{formatInt({ value: view.webSearch.calls })}</MonoRef></Td>
                  <Td right><MonoRef muted>{formatUsd({ amount: view.webSearch.estUsd, currency: view.currency })}</MonoRef></Td>
                </tr>
                {view.webSearch.bySource.map((s) => (
                  <tr key={s.source}>
                    <Td><span style={{ paddingLeft: space[3], color: color.muted, fontSize: fontSize.xs }}>↳ {WEB_SEARCH_SOURCE_LABEL[s.source] ?? s.source}</span></Td>
                    <Td right><MonoRef muted>—</MonoRef></Td>
                    <Td right><MonoRef muted>{formatInt({ value: s.calls })}</MonoRef></Td>
                    <Td right><MonoRef muted>—</MonoRef></Td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${color.lineStrong}` }}>
                  <Td><b>Grand total</b></Td><Td /><Td />
                  <Td right><MonoRef><b data-testid="usage-grandtotal">{formatUsd({ amount: view.totalUsd, currency: view.currency })}</b></MonoRef></Td>
                </tr>
              </tbody>
            </table>
          </Card>

          {/* the reports included in this window */}
          <Card>
            <h2 style={{ fontSize: fontSize.h3, marginTop: 0 }}>Included reports <span style={{ color: color.subtle, fontWeight: fontWeight.regular, fontSize: fontSize.sm }}>({data.reports.length})</span></h2>
            <div style={{ overflowX: 'auto' }}>
              <table data-testid="usage-report-list" style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSize.sm }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: color.muted }}>
                    <Th>Report</Th><Th>Created</Th><Th>State</Th><Th>Customer</Th><Th right>Tokens</Th><Th right>Searches</Th><Th right>Emails</Th><Th right>Cost</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.reports.map((r) => (
                    <tr key={r.id} data-testid="usage-report-row" style={{ borderTop: `1px solid ${color.line}` }}>
                      <Td><a href={hrefFor({ route: Route.AdminCost, params: { id: r.id } })} style={{ fontFamily: font.mono, fontSize: fontSize.xs, color: color.info }}>{r.ref ?? `#${r.id.slice(0, 8)}`}</a></Td>
                      <Td><span style={{ color: color.muted }}>{fmtDate(r.createdAt)}</span></Td>
                      <Td><span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.semibold, padding: '2px 8px', borderRadius: radius.pill, background: toneColors[toneForReportState(r.state)].bg, color: toneColors[toneForReportState(r.state)].fg }}>{r.state}</span></Td>
                      <Td><span style={{ color: color.muted }}>{r.customerEmail}</span></Td>
                      <Td right><MonoRef>{formatInt({ value: r.tokenTotal })}</MonoRef></Td>
                      <Td right><MonoRef>{formatInt({ value: r.webSearchCalls })}</MonoRef></Td>
                      <Td right><MonoRef>{formatInt({ value: r.emailCount })}</MonoRef></Td>
                      <Td right><MonoRef>{formatUsd({ amount: r.costUsd, currency: view.currency })}</MonoRef></Td>
                    </tr>
                  ))}
                  {data.reports.length === 0 && (
                    <tr><Td><span style={{ color: color.subtle }} data-testid="usage-empty">No reports in this window.</span></Td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function DateField({ label, value, onChange, testid }: { label: string; value: string; onChange: (v: string) => void; testid: string }) {
  return (
    <label style={{ display: 'grid', gap: 3 }}>
      <span style={{ fontSize: fontSize.xs, color: color.subtle }}>{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}
        style={{ height: 34, padding: '0 10px', border: `1.5px solid ${color.lineStrong}`, borderRadius: radius.md, fontSize: fontSize.sm, fontFamily: font.ui, color: color.ink, background: color.surface, outline: 'none' }} />
    </label>
  );
}

function Tile({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <Card>
      <div style={{ color: color.muted, fontSize: fontSize.sm }}>{label}</div>
      <div style={{ marginTop: space[1], fontFamily: 'var(--font-mono)', fontSize: fontSize.h2, fontWeight: fontWeight.semibold }} data-testid={testid}>{value}</div>
    </Card>
  );
}

function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th style={{ padding: `${space[1]}px ${space[2]}px`, textAlign: right ? 'right' : 'left', fontWeight: fontWeight.medium }}>{children}</th>;
}
function Td({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <td style={{ padding: `${space[1]}px ${space[2]}px`, textAlign: right ? 'right' : 'left' }}>{children}</td>;
}
