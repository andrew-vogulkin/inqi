import { AuditActor, AuditEntryType, AuditTargetType, ComplianceKind } from '@inqi/shared';

/** A unified, read-only audit row projected from an existing source (no new mutations). */
export interface AuditEntry {
  type: AuditEntryType;
  at: string;            // ISO timestamp
  actor: string;         // persona/agent/operator/system
  reason?: string;
  reportId?: string;
  refs?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

const iso = (d: Date) => d.toISOString();

/** Pure mappers: source row → AuditEntry. Keep them total + side-effect free (unit-tested). */
export const project = {
  denial(inq: { id: string; denyReason: string | null; updatedAt: Date }): AuditEntry {
    return { type: AuditEntryType.Denial, at: iso(inq.updatedAt), actor: AuditActor.System, reason: inq.denyReason ?? undefined, reportId: inq.id };
  },
  complianceMessage(m: { reviewStatus: string; riskScore: number | null; riskTags: string[]; createdAt: Date; reportId: string }): AuditEntry {
    return { type: AuditEntryType.ComplianceBlock, at: iso(m.createdAt), actor: AuditActor.Compliance, reportId: m.reportId, data: { surface: ComplianceKind.Email, riskScore: m.riskScore, riskTags: m.riskTags } };
  },
  complianceQuestionnaire(q: { reviewStatus: string; riskScore: number | null; createdAt: Date; reportId: string }): AuditEntry {
    return { type: AuditEntryType.ComplianceBlock, at: iso(q.createdAt), actor: AuditActor.Compliance, reportId: q.reportId, data: { surface: ComplianceKind.Questionnaire, riskScore: q.riskScore } };
  },
  agentRun(r: { reportId: string; stage: string; status: string; error: string | null; startedAt: Date }): AuditEntry {
    return { type: AuditEntryType.AgentAction, at: iso(r.startedAt), actor: r.stage, reason: r.error ?? undefined, reportId: r.reportId, data: { stage: r.stage, status: r.status } };
  },
  transition(e: { reportId: string; createdAt: Date; data: unknown }): AuditEntry {
    const d = (e.data ?? {}) as { from?: string; to?: string; event?: string };
    return { type: AuditEntryType.Transition, at: iso(e.createdAt), actor: AuditActor.Engine, reportId: e.reportId, data: { from: d.from, to: d.to, event: d.event } };
  },
  operator(a: { actor: string; action: string; targetType: string; targetId: string; reason: string | null; createdAt: Date; data: unknown }): AuditEntry {
    return {
      type: AuditEntryType.OperatorAction, at: iso(a.createdAt), actor: a.actor, reason: a.reason ?? undefined,
      reportId: a.targetType === AuditTargetType.Report ? a.targetId : undefined,
      refs: { targetType: a.targetType, targetId: a.targetId }, data: { action: a.action, ...((a.data ?? {}) as Record<string, unknown>) },
    };
  },
};

/** Pure: filter by entry types + time range (ISO bounds inclusive). */
export function filterEntries({ entries, types, from, to }: { entries: AuditEntry[]; types?: AuditEntryType[]; from?: string; to?: string }): AuditEntry[] {
  return entries.filter((e) => {
    if (types && types.length && !types.includes(e.type)) return false;
    if (from && e.at < from) return false;
    if (to && e.at > to) return false;
    return true;
  });
}

/** Pure: newest first. */
export function sortByAtDesc(entries: AuditEntry[]): AuditEntry[] {
  return [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
