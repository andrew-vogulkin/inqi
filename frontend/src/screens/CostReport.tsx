import { ReactNode, useEffect, useState } from 'react';
import { AsyncStatus, AccessScreen, StatusTone } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import {
  CostMetric, COST_METRIC_LABEL, OUTREACH_ACTION_LABEL,
  deriveCostView, formatUsd, formatInt,
} from '../conventions/cost';
import { color, space, fontSize, fontWeight } from '../theme/tokens';
import { adminApi, ApiError, CostSummaryDto } from '../api';
import { Card, MonoRef, Skeleton, ErrorState, Badge } from '../ui';
import { AccessScreenView } from './AccessScreens';

/**
 * FE-13 — admin-only per-report cost rollup. Reads `GET /reports/:id/cost`; a
 * non-admin gets a typed 403 → the Forbidden screen with **zero** cost figures in
 * the DOM. Derivation (tiles, totals, reconciliation) is the pure {@link deriveCostView}
 * selector; this is a flat view with Geist Mono numbers.
 */
export function CostReport({ reportId }: { reportId: string }) {
  const [status, setStatus] = useState<AsyncStatus>(AsyncStatus.Loading);
  const [forbidden, setForbidden] = useState(false);
  const [cost, setCost] = useState<CostSummaryDto | null>(null);

  useEffect(() => {
    let live = true;
    setStatus(AsyncStatus.Loading);
    setForbidden(false);
    adminApi.cost({ reportId })
      .then((c) => { if (live) { setCost(c); setStatus(AsyncStatus.Ready); } })
      .catch((err) => {
        if (!live) return;
        if (err instanceof ApiError && err.httpStatus === 403) { setForbidden(true); setStatus(AsyncStatus.Error); }
        else setStatus(AsyncStatus.Error);
      });
    return () => { live = false; };
  }, [reportId]);

  // Admin-only: never render any cost figure on the forbidden path.
  if (forbidden) return <AccessScreenView screen={AccessScreen.Forbidden} />;

  const backHref = hrefFor({ route: Route.AdminReport, params: { id: reportId } });

  if (status === AsyncStatus.Loading) return <Card><Skeleton width="40%" /></Card>;
  if (status === AsyncStatus.Error || !cost) {
    return <ErrorState title="Couldn't load cost" message="The cost summary is unavailable right now." action={<a href={backHref}>‹ Back to board</a>} />;
  }

  const view = deriveCostView({ cost });

  return (
    <div style={{ display: 'grid', gap: space[4] }} data-testid="cost-report">
      <a href={backHref} style={{ fontSize: fontSize.sm }}>‹ Back to board</a>
      <h1 style={{ fontSize: fontSize.h2 }}>Cost per report</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: space[3] }}>
        <Tile metric={CostMetric.Total} value={formatUsd({ amount: view.totalUsd, currency: view.currency })} testid="cost-total" />
        <Tile metric={CostMetric.Tokens} value={formatInt({ value: view.tokenTotal })} testid="cost-tokens" />
        <Tile metric={CostMetric.Outreach} value={formatInt({ value: view.outreachActions })} testid="cost-outreach" />
      </div>

      <Card>
        <table data-testid="cost-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSize.sm }}>
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
            {view.outreach.map((r) => (
              <tr key={r.action} style={{ borderTop: `1px solid ${color.line}` }}>
                <Td>{OUTREACH_ACTION_LABEL[r.action]}</Td>
                <Td right><MonoRef muted>—</MonoRef></Td>
                <Td right><MonoRef>{formatInt({ value: r.count })}</MonoRef></Td>
                <Td right><MonoRef muted>{r.action === view.outreach[0].action ? formatUsd({ amount: view.outreachUsd, currency: view.currency }) : ''}</MonoRef></Td>
              </tr>
            ))}
            <tr style={{ borderTop: `2px solid ${color.lineStrong}` }}>
              <Td><b>Grand total</b></Td><Td /><Td />
              <Td right><MonoRef><b data-testid="cost-grandtotal">{formatUsd({ amount: view.totalUsd, currency: view.currency })}</b></MonoRef></Td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: space[3] }}>
          {view.reconciles
            ? <Badge tone={StatusTone.Brand}><span data-testid="cost-reconciled">Reconciled · Σ line items = grand total</span></Badge>
            : <Badge tone={StatusTone.Danger}><span data-testid="cost-mismatch">Mismatch · Σ {formatUsd({ amount: view.sumUsd, currency: view.currency })} ≠ {formatUsd({ amount: view.totalUsd, currency: view.currency })}</span></Badge>}
        </div>
      </Card>
    </div>
  );
}

function Tile({ metric, value, testid }: { metric: CostMetric; value: string; testid: string }) {
  return (
    <Card>
      <div style={{ color: color.muted, fontSize: fontSize.sm }}>{COST_METRIC_LABEL[metric]}</div>
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
