import { useEffect } from 'react';
import { AsyncStatus } from '../conventions/enums';
import {
  AuditFilter, AUDIT_FILTERS, AUDIT_FILTER_LABEL, typesParam, auditRowVM,
} from '../conventions/audit';
import { relativeTime } from '../conventions/credits';
import { color, space, fontSize, fontWeight } from '../theme/tokens';
import { adminApi } from '../api';
import { Card, FilterBar, StatusBadge, MonoRef, EmptyState, ErrorState, Skeleton } from '../ui';
import { toneColors } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

/** FE-14 — filterable audit trail: privileged actions + denials, newest first. */
export function AuditTrail() {
  const dispatch = useAppDispatch();
  const audit = useSelector((s) => s.audit);
  const now = Date.now();

  // The selected chip is reducer state; refetch whenever it changes.
  useEffect(() => {
    let live = true;
    dispatch({ type: ActionType.AuditLoading });
    adminApi.audit({ types: typesParam({ filter: audit.filter }) })
      .then((res) => { if (live) dispatch({ type: ActionType.AuditLoaded, entries: res.entries }); })
      .catch(() => { if (live) dispatch({ type: ActionType.AuditLoadFailed, message: 'Could not load the audit trail.' }); });
    return () => { live = false; };
  }, [audit.filter, dispatch]);

  const options = AUDIT_FILTERS.map((value) => ({ value, label: AUDIT_FILTER_LABEL[value] }));

  return (
    <div style={{ display: 'grid', gap: space[4] }} data-testid="audit-trail">
      <h1 style={{ fontSize: fontSize.h2 }}>Audit trail</h1>
      <FilterBar<AuditFilter> options={options} value={audit.filter} onChange={(filter) => dispatch({ type: ActionType.AuditFilterSelected, filter })} />

      {audit.status === AsyncStatus.Loading && <Card><Skeleton width="60%" /></Card>}
      {audit.status === AsyncStatus.Error && <ErrorState title="Couldn't load" message={audit.error ?? 'Try again.'} />}
      {audit.status === AsyncStatus.Ready && audit.entries.length === 0 && (
        <EmptyState title="No matching activity" hint="No audit entries for this filter." />
      )}

      {audit.status === AsyncStatus.Ready && audit.entries.length > 0 && (
        <Card>
          <div data-testid="audit-rows" style={{ display: 'grid', gap: space[1] }}>
            {audit.entries.map((entry, i) => {
              const vm = auditRowVM({ entry });
              return (
                <div key={i} data-testid="audit-row" style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: space[3], alignItems: 'center', padding: `${space[2]}px 0`, borderTop: i ? `1px solid ${color.line}` : undefined }}>
                  <StatusBadge label={vm.badge} tone={vm.tone} />
                  <div style={{ fontSize: fontSize.sm }}>
                    <span style={{ color: toneColors[vm.tone].fg, fontWeight: fontWeight.medium }}>{vm.actor}</span>
                    <span style={{ color: color.muted }}> · </span>
                    <MonoRef muted>{vm.target}</MonoRef>
                  </div>
                  <span style={{ fontSize: fontSize.xs, color: color.subtle, whiteSpace: 'nowrap' }}>{relativeTime({ iso: vm.at, now })}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
