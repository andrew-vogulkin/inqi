import { AuditEntryType, AuditAction } from '@inqi/shared';
import { StatusTone } from './enums';
import { AuditEntryDto } from '../api/types';

/**
 * FE-14 — audit trail. The `AuditFilter` enum drives BOTH the filter chips AND the
 * `types=` query param (convention #1). The real `/audit` endpoint filters by the
 * five {@link AuditEntryType} buckets only — the operator sub-actions (cancel /
 * pause / resume / publish / top-up) are all `operator_action`, distinguished by
 * `data.action` and shown on the row badge (not separately queryable server-side).
 */
export const AuditFilter = {
  All: 'all',
  Denial: AuditEntryType.Denial,
  Compliance: AuditEntryType.ComplianceBlock,
  Agent: AuditEntryType.AgentAction,
  Transition: AuditEntryType.Transition,
  Operator: AuditEntryType.OperatorAction,
} as const;
export type AuditFilter = (typeof AuditFilter)[keyof typeof AuditFilter];

export const AUDIT_FILTERS: AuditFilter[] = [
  AuditFilter.All, AuditFilter.Operator, AuditFilter.Denial, AuditFilter.Compliance, AuditFilter.Agent, AuditFilter.Transition,
];

export const AUDIT_FILTER_LABEL: Record<AuditFilter, string> = {
  [AuditFilter.All]: 'All',
  [AuditFilter.Operator]: 'Operator',
  [AuditFilter.Denial]: 'Denials',
  [AuditFilter.Compliance]: 'Compliance',
  [AuditFilter.Agent]: 'Agent',
  [AuditFilter.Transition]: 'Transitions',
};

/** Chip → `types=` value. "All" clears the filter (no param). */
export function typesParam({ filter }: { filter: AuditFilter }): string | undefined {
  return filter === AuditFilter.All ? undefined : filter;
}

/** Friendly labels for the operator sub-actions (shown on the row badge). */
export const OPERATOR_ACTION_LABEL: Record<string, string> = {
  [AuditAction.Cancel]: 'Cancel',
  [AuditAction.Pause]: 'Pause',
  [AuditAction.Resume]: 'Resume',
  [AuditAction.PublishWorkflow]: 'Publish workflow',
  [AuditAction.Topup]: 'Top-up',
};

const TYPE_LABEL: Record<string, string> = {
  [AuditEntryType.Denial]: 'Denial',
  [AuditEntryType.ComplianceBlock]: 'Compliance block',
  [AuditEntryType.AgentAction]: 'Agent action',
  [AuditEntryType.Transition]: 'Transition',
  [AuditEntryType.OperatorAction]: 'Operator',
};

const TYPE_TONE: Record<string, StatusTone> = {
  [AuditEntryType.Denial]: StatusTone.Danger,
  [AuditEntryType.ComplianceBlock]: StatusTone.Warn,
  [AuditEntryType.AgentAction]: StatusTone.Info,
  [AuditEntryType.Transition]: StatusTone.Subtle,
  [AuditEntryType.OperatorAction]: StatusTone.Brand,
};

export function auditBadgeTone(type: string): StatusTone {
  return TYPE_TONE[type] ?? StatusTone.Muted;
}

export interface AuditRowVM {
  type: string;
  badge: string;     // operator sub-action label, else the bucket label
  tone: StatusTone;
  actor: string;
  target: string;
  at: string;        // ISO (component formats relative time)
}

/** Normalize one entry to a row view-model (convention #2: derivation out of the component). */
export function auditRowVM({ entry }: { entry: AuditEntryDto }): AuditRowVM {
  const action = entry.type === AuditEntryType.OperatorAction ? String((entry.data as { action?: string } | undefined)?.action ?? '') : '';
  const badge = action ? (OPERATOR_ACTION_LABEL[action] ?? action) : (TYPE_LABEL[entry.type] ?? entry.type);
  const target = String((entry.refs as { targetId?: string } | undefined)?.targetId ?? entry.inquiryId ?? '—');
  return { type: entry.type, badge, tone: auditBadgeTone(entry.type), actor: entry.actor, target, at: entry.at };
}

/** Newest first (the API already sorts; kept deterministic for the reducer). */
export function sortEntries({ entries }: { entries: AuditEntryDto[] }): AuditEntryDto[] {
  return [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
