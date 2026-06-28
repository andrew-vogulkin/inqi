import { Injectable } from '@nestjs/common';
import { AuditEntryType, AuditTargetType, EventType, ReviewStatus } from '@inqi/shared';
import { PrismaService } from '../persistence/prisma.service';
import { AuditEntry, filterEntries, project, sortByAtDesc } from './audit-projection';

export interface AuditQuery {
  inquiryId?: string;
  types?: AuditEntryType[];
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Per-source fetch cap (keeps an unscoped query bounded; per-inquiry queries are small). */
const SOURCE_CAP = 500;

/**
 * Read-only audit projection (HP-14): unifies denials, compliance blocks, agent
 * actions, workflow transitions and operator actions from existing tables +
 * the AuditLog into one attributed, filterable, paginated timeline. No mutations.
 */
@Injectable()
export class AuditQueryService {
  constructor(private readonly db: PrismaService) {}

  async query(q: AuditQuery): Promise<{ total: number; entries: AuditEntry[] }> {
    const { inquiryId } = q;
    const take = SOURCE_CAP;

    const [denials, qBlocks, mBlocks, runs, transitions, operator] = await Promise.all([
      this.db.inquiry.findMany({ where: { ...(inquiryId ? { id: inquiryId } : {}), denyReason: { not: null } }, select: { id: true, denyReason: true, updatedAt: true }, take }),
      this.db.questionnaire.findMany({ where: { reviewStatus: ReviewStatus.Blocked, ...(inquiryId ? { inquiryId } : {}) }, select: { inquiryId: true, reviewStatus: true, riskScore: true, createdAt: true }, take }),
      this.db.inquiryMessage.findMany({
        where: { reviewStatus: ReviewStatus.Blocked, ...(inquiryId ? { subtask: { epic: { inquiryId } } } : {}) },
        select: { reviewStatus: true, riskScore: true, riskTags: true, createdAt: true, subtask: { select: { epic: { select: { inquiryId: true } } } } }, take,
      }),
      this.db.agentRun.findMany({ where: { ...(inquiryId ? { inquiryId } : {}) }, select: { inquiryId: true, stage: true, status: true, error: true, startedAt: true }, orderBy: { startedAt: 'desc' }, take }),
      this.db.eventOutbox.findMany({ where: { type: EventType.InquiryTransitioned, ...(inquiryId ? { inquiryId } : {}) }, select: { inquiryId: true, createdAt: true, data: true }, orderBy: { id: 'desc' }, take }),
      this.db.auditLog.findMany({ where: inquiryId ? { targetType: AuditTargetType.Inquiry, targetId: inquiryId } : {}, select: { actor: true, action: true, targetType: true, targetId: true, reason: true, createdAt: true, data: true }, orderBy: { createdAt: 'desc' }, take }),
    ]);

    const all: AuditEntry[] = [
      ...denials.map((d) => project.denial(d)),
      ...qBlocks.map((q2) => project.complianceQuestionnaire(q2)),
      ...mBlocks.map((m) => project.complianceMessage({ reviewStatus: m.reviewStatus, riskScore: m.riskScore, riskTags: m.riskTags, createdAt: m.createdAt, inquiryId: m.subtask.epic.inquiryId })),
      ...runs.map((r) => project.agentRun(r)),
      ...transitions.map((t) => project.transition(t)),
      ...operator.map((a) => project.operator(a)),
    ];

    const filtered = sortByAtDesc(filterEntries({ entries: all, types: q.types, from: q.from, to: q.to }));
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 100;
    return { total: filtered.length, entries: filtered.slice(offset, offset + limit) };
  }
}
