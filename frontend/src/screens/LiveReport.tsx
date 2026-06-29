import { useEffect, useState } from 'react';
import { EventType } from '@inqi/shared';
import { AsyncStatus, ReportLayout, ButtonVariant, StatusTone } from '../conventions/enums';
import { statusBadge } from '../conventions/stages';
import { Route, hrefFor } from '../conventions/routes';
import { RankedOption, optionId } from '../conventions/ranking';
import { color, space, fontSize, fontWeight } from '../theme/tokens';
import { inquiriesApi, reportsApi, ApiError } from '../api';
import { Card, Button, Badge, StatusBadge, StatusDot, EmptyState, ErrorState, Skeleton, FilterBar } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';
import { ReportState } from '../state/report.reducer';

/** FE-06 — the centerpiece. Drives /i/:id (owner) and /r/:token (public deep link). */
export function LiveReport({ inquiryId, token }: { inquiryId?: string; token?: string }) {
  const dispatch = useAppDispatch();
  const report = useSelector((s) => s.report);
  const [resolvedId, setResolvedId] = useState<string | null>(inquiryId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<ReportLayout>(ReportLayout.List); // view-only toggle

  // Resolve a report-token deep link → inquiry id (snapshot still comes from reportLive).
  useEffect(() => {
    let cancelled = false;
    dispatch({ type: ActionType.ReportCleared });
    (async () => {
      try {
        if (inquiryId) { if (!cancelled) setResolvedId(inquiryId); return; }
        if (token) {
          const rep = await reportsApi.getByToken({ token });
          if (!cancelled) setResolvedId(rep.inquiryId);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'This report link is invalid or has expired.');
      }
    })();
    return () => { cancelled = true; };
  }, [inquiryId, token, dispatch]);

  // Stream events into the report reducer (replay-by-cursor reconnect → "no events missed" toast).
  useRealtime(resolvedId ? { kind: 'inquiry', inquiryId: resolvedId } : null);

  // Snapshot-then-stream: (re)fetch the server-assembled snapshot on each new event.
  useEffect(() => {
    if (!resolvedId) return;
    inquiriesApi.reportLive({ id: resolvedId })
      .then((live) => dispatch({ type: ActionType.ReportSnapshotReceived, live }))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the report.'));
  }, [resolvedId, report.cursor, dispatch]);

  if (error) return <ErrorState title="Can't open this report" message={error} />;
  if (report.status !== AsyncStatus.Ready) return <Card><div style={{ display: 'grid', gap: space[2] }}><Skeleton width="40%" /><Skeleton /><Skeleton width="70%" /></div></Card>;

  const badge = statusBadge(report.inquiryState);
  const options = report.order.map((id) => report.optionsById[id]);
  const streaming = !report.delivered;

  return (
    <div style={{ display: 'grid', gap: space[4] }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
        <h1 style={{ fontSize: fontSize.h2, flex: 1 }}>Your report</h1>
        {streaming && <StatusDot tone={StatusTone.Info} pulse />}
        <StatusBadge label={badge.label} tone={badge.tone} />
        {(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && (
          <Button variant={ButtonVariant.Ghost} onClick={() => dispatch({ type: ActionType.SocketReconnected })}>↻ reconnect</Button>
        )}
      </header>
      <p style={{ color: color.muted, marginTop: -space[2] }}>{report.rawRequest}</p>

      {report.reusedFrom && (
        <Card sunken><span style={{ color: color.brandStrong }}>♻️ Reused from a similar recent report</span> — instant results from prior research.</Card>
      )}
      {report.delivered && report.summary && (
        <Card><b>{report.summary}</b></Card>
      )}
      {streaming && (
        <Card sunken><span style={{ color: color.info }}>🔎 Research in progress</span> — {options.length} option(s) found so far. Ranked live as more come in.</Card>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
        <h2 style={{ fontSize: fontSize.h3, flex: 1 }}>Options {options.length > 0 && <span style={{ color: color.muted, fontWeight: fontWeight.regular, fontSize: fontSize.sm }}>({options.length})</span>}</h2>
        <FilterBar
          value={layout}
          onChange={setLayout}
          options={[{ value: ReportLayout.List, label: 'List' }, { value: ReportLayout.Split, label: 'Split' }, { value: ReportLayout.Table, label: 'Table' }]}
        />
      </div>

      {options.length === 0
        ? <EmptyState title="No options yet" hint="inqi is still reaching out — results appear here live." />
        : <OptionsView layout={layout} options={options} inquiryId={report.inquiryId ?? ''} />}

      <section>
        <h3 style={{ fontSize: fontSize.h3, marginBottom: space[2] }}>Activity</h3>
        <Timeline report={report} />
      </section>
    </div>
  );
}

function OptionsView({ layout, options, inquiryId }: { layout: ReportLayout; options: RankedOption[]; inquiryId: string }) {
  if (layout === ReportLayout.Table) return <OptionsTable options={options} />;
  const cols = layout === ReportLayout.Split ? '1fr 1fr' : '1fr';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: space[3] }}>
      {options.map((o, i) => (
        <OptionCard key={o.subjectProvider || o.id} option={o} rank={i} best={i === 0}
          dossierHref={inquiryId ? hrefFor({ route: Route.Dossier, params: { id: inquiryId, ref: optionId(o) } }) : undefined} />
      ))}
    </div>
  );
}

export function OptionCard({ option, rank, best, dossierHref }: { option: RankedOption; rank: number; best: boolean; dossierHref?: string }) {
  return (
    <Card style={best ? { borderColor: color.brand } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[1] }}>
        <span style={{ color: color.subtle, fontWeight: fontWeight.semibold }}>#{rank + 1}</span>
        <b style={{ flex: 1 }}>{option.subjectProvider}</b>
        {best && <Badge tone={StatusTone.Brand}>BEST MATCH</Badge>}
      </div>
      <div style={{ fontSize: fontSize.sm, color: color.muted }}>
        quality {Math.round((option.qualityScore ?? 0) * 100)}% · score {Math.round((option.score ?? 0) * 100)}%
        {option.availability ? ` · ${option.availability}` : ''}{option.leadTime ? ` · ${option.leadTime}` : ''}
      </div>
      <div style={{ marginTop: space[2], display: 'flex', alignItems: 'baseline', gap: space[3] }}>
        <span style={{ fontWeight: fontWeight.semibold }}>{option.price != null ? `${option.price} ${option.currency ?? ''}` : '—'}</span>
        {dossierHref && <a href={dossierHref} style={{ fontSize: fontSize.sm }}>How we researched this →</a>}
      </div>
    </Card>
  );
}

function OptionsTable({ options }: { options: RankedOption[] }) {
  return (
    <Card>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSize.sm }}>
        <thead><tr style={{ textAlign: 'left', color: color.muted }}>
          <th style={{ padding: space[1] }}>#</th><th>Provider</th><th>Quality</th><th>Score</th><th style={{ textAlign: 'right' }}>Price</th>
        </tr></thead>
        <tbody>
          {options.map((o, i) => (
            <tr key={o.subjectProvider} style={{ borderTop: `1px solid ${color.line}` }}>
              <td style={{ padding: space[1] }}>{i + 1}</td>
              <td>{o.subjectProvider} {i === 0 && <Badge tone={StatusTone.Brand}>BEST</Badge>}</td>
              <td>{Math.round((o.qualityScore ?? 0) * 100)}%</td>
              <td>{Math.round((o.score ?? 0) * 100)}%</td>
              <td style={{ textAlign: 'right', fontWeight: fontWeight.semibold }}>{o.price != null ? `${o.price} ${o.currency ?? ''}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const LABEL: Record<string, (d: Record<string, unknown>) => string> = {
  [EventType.InquiryTransitioned]: (d) => `→ ${d.to}`,
  [EventType.AgentProgress]: (d) => `${d.stage}: ${d.message}`,
  [EventType.WaveReleased]: (d) => `released wave ${d.wave} (${d.count} providers)`,
  [EventType.FunnelWidened]: (d) => `widened the search (+${d.added})`,
  [EventType.MessageSent]: () => 'emailed a provider',
  [EventType.MessageReceived]: () => 'reply received',
  [EventType.SubtaskUpdated]: (d) => `provider ${d.status}`,
  [EventType.ReportReady]: (d) => `report ready — ${d.options ?? ''} options`,
};

function Timeline({ report }: { report: ReportState }) {
  const rows = report.timeline.filter((t) => t.type !== EventType.AgentHeartbeat).slice(-40).reverse();
  if (rows.length === 0) return <div style={{ color: color.subtle, fontSize: fontSize.sm }}>No activity yet…</div>;
  return (
    <ol style={{ maxHeight: 280, overflow: 'auto', fontSize: fontSize.sm, paddingLeft: space[4], margin: 0 }}>
      {rows.map((t) => (
        <li key={t.id} style={{ marginBottom: 2 }}>
          <span style={{ color: color.subtle, fontVariantNumeric: 'tabular-nums' }}>{t.at && t.at !== 'now' ? new Date(t.at).toLocaleTimeString() : ''}</span>{' '}
          {(LABEL[t.type] ?? (() => t.type))(t.data)}
        </li>
      ))}
    </ol>
  );
}
