import { AuditEntryType, AuditAction, AuditActor, AgentStage, AgentRunStatus, ComplianceKind } from '@inqi/shared';
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
  [AuditAction.UnlockReport]: 'Report unlock',
};

/** Human names for the pipeline stages an agent-action row is about. */
export const AGENT_STAGE_LABEL: Record<string, string> = {
  [AgentStage.PreResearch]: 'Pre-research vetting',
  [AgentStage.SendQuestionnaire]: 'Questionnaire delivery',
  [AgentStage.EnrichSubject]: 'Subject enrichment',
  [AgentStage.BroadResearch]: 'Broad research',
  [AgentStage.BuildFunnel]: 'Funnel build (breadth search)',
  [AgentStage.StartOutreach]: 'Outreach kickoff',
  [AgentStage.OutreachInquiry]: 'Provider outreach',
  [AgentStage.GenerateReport]: 'Report synthesis',
};

/** How an agent run ended, as a verb phrase the description can hang on. */
const RUN_STATUS_PHRASE: Record<string, string> = {
  [AgentRunStatus.Running]: 'is running',
  [AgentRunStatus.Done]: 'completed',
  [AgentRunStatus.Failed]: 'failed',
  [AgentRunStatus.Stopped]: 'was stopped by the reaper',
  [AgentRunStatus.Cancelled]: 'was abandoned (report cancelled)',
};

/** Constant machine actors → human names (operator rows keep the operator's email). */
const ACTOR_LABEL: Record<string, string> = {
  [AuditActor.System]: 'System',
  [AuditActor.Engine]: 'Workflow engine',
  [AuditActor.Compliance]: 'Compliance gate',
};

/** `BROAD_RESEARCH` → `Broad research`; `QUESTIONNAIRE_FILLED` → `questionnaire filled` (cap=false). */
export function humanToken(raw: string | undefined, { cap = true }: { cap?: boolean } = {}): string {
  if (!raw) return '';
  const words = raw.toLowerCase().replace(/_/g, ' ');
  return cap ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

/**
 * One human sentence per audit entry — the row's story, built from `reason` +
 * `data` (which the table never showed before). Total: unknown shapes fall back
 * to the reason or an empty string, never throw.
 */
export function auditDescription({ entry }: { entry: AuditEntryDto }): string {
  const d = (entry.data ?? {}) as Record<string, unknown>;
  const reason = entry.reason ?? '';
  switch (entry.type) {
    case AuditEntryType.Denial:
      return reason ? `Request denied — ${reason}` : 'Request denied during pre-research vetting.';
    case AuditEntryType.ComplianceBlock: {
      const surface = d.surface === ComplianceKind.Questionnaire ? 'Questionnaire blocked before delivery' : 'Outbound email blocked before sending';
      const risk = typeof d.riskScore === 'number' ? ` — risk ${(d.riskScore as number).toFixed(2)}` : '';
      const tags = Array.isArray(d.riskTags) && d.riskTags.length ? ` (${(d.riskTags as string[]).join(', ')})` : '';
      return `${surface}${risk}${tags}`;
    }
    case AuditEntryType.AgentAction: {
      const stage = AGENT_STAGE_LABEL[String(d.stage ?? '')] ?? humanToken(String(d.stage ?? 'agent stage'));
      const phrase = RUN_STATUS_PHRASE[String(d.status ?? '')] ?? humanToken(String(d.status ?? ''), { cap: false });
      return `${stage} ${phrase}${reason ? ` — ${reason}` : ''}`;
    }
    case AuditEntryType.Transition: {
      const move = `${humanToken(String(d.from ?? ''))} → ${humanToken(String(d.to ?? ''))}`;
      return d.event ? `${move} · on ${humanToken(String(d.event), { cap: false })}` : move;
    }
    case AuditEntryType.OperatorAction: {
      const suffix = reason ? ` — ${reason}` : '';
      switch (d.action) {
        case AuditAction.Cancel:
          return `Report cancelled (was ${humanToken(String(d.from ?? ''), { cap: false })})${suffix}`;
        case AuditAction.Pause:
          return `Report paused (was ${humanToken(String(d.from ?? ''), { cap: false })})${suffix}`;
        case AuditAction.Resume:
          return `Report resumed (back to ${humanToken(String(d.to ?? ''), { cap: false })})`;
        case AuditAction.PublishWorkflow:
          return `Workflow "${String(d.key ?? '?')}" v${String(d.version ?? '?')} published — new reports pin to it`;
        case AuditAction.Topup:
          return `+${String(d.amount ?? '?')} credit(s) granted, balance now ${String(d.balance ?? '?')}${suffix}`;
        case AuditAction.UnlockReport:
          return 'Freemium report unlocked for 1 credit — full options revealed';
        default:
          return reason;
      }
    }
    default:
      return reason;
  }
}

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
  badge: string;       // operator sub-action label, else the bucket label
  tone: StatusTone;
  actor: string;       // humanized: System / Workflow engine / Compliance gate / stage name / operator email
  target: string;
  description: string; // the row's story, from reason + data
  at: string;          // ISO (component formats relative time)
}

/** Normalize one entry to a row view-model (convention #2: derivation out of the component). */
export function auditRowVM({ entry }: { entry: AuditEntryDto }): AuditRowVM {
  const action = entry.type === AuditEntryType.OperatorAction ? String((entry.data as { action?: string } | undefined)?.action ?? '') : '';
  const badge = action ? (OPERATOR_ACTION_LABEL[action] ?? action) : (TYPE_LABEL[entry.type] ?? entry.type);
  const target = String((entry.refs as { targetId?: string } | undefined)?.targetId ?? entry.reportId ?? '—');
  // Agent-action rows carry the raw stage as actor — show its human stage name.
  const actor = entry.type === AuditEntryType.AgentAction
    ? (AGENT_STAGE_LABEL[entry.actor] ?? humanToken(entry.actor))
    : (ACTOR_LABEL[entry.actor] ?? entry.actor);
  return { type: entry.type, badge, tone: auditBadgeTone(entry.type), actor, target, description: auditDescription({ entry }), at: entry.at };
}

/** Newest first (the API already sorts; kept deterministic for the reducer). */
export function sortEntries({ entries }: { entries: AuditEntryDto[] }): AuditEntryDto[] {
  return [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
