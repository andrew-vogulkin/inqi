import { Injectable, Logger } from '@nestjs/common';
import { EventType, QueueJob, ReportState, InquiryStatus, WorkflowEvent, WorkflowStatus, deriveStage } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { ConflictError, DomainError, ErrorCode } from '../../common/errors';
import { CreditsService } from '../credits/credits.service';
import { settlementActionForState } from '../credits/credits.balance';
import { lifecycleEventForState, notificationForLifecycle } from '../report/report-lifecycle';
import { shouldPropose } from '../phases/subject-build/subject-build.trigger';
import { Actions, Guards } from './workflow-registry';

/**
 * Data-driven, versioned state machine. Transitions live in the DB and are
 * pinned per report (`report.workflowVersionId`), so workflow upgrades never
 * break in-flight work.
 */
@Injectable()
export class WorkflowEngine {
  private readonly logger = new Logger(WorkflowEngine.name);

  constructor(
    private readonly db: PrismaService,
    private readonly boss: BossService,
    private readonly outbox: OutboxService,
    private readonly credits: CreditsService,
  ) {}

  /** The active version new reports start on. */
  async activeVersionId({ key = 'report' }: { key?: string } = {}): Promise<string> {
    const def = await this.db.workflowDefinition.findFirst({
      where: { key, status: WorkflowStatus.Active },
      orderBy: { version: 'desc' },
    });
    if (!def) {
      throw new DomainError({ code: ErrorCode.NoActiveWorkflow, message: `no active workflow for "${key}" — run db:seed`, retryable: false });
    }
    return def.id;
  }

  /** Advance a report by firing a workflow event; runs the transition's guard + action. */
  async advance({ reportId, event, payload }: { reportId: string; event: WorkflowEvent; payload?: unknown }): Promise<ReportState> {
    const inq = await this.db.report.findUniqueOrThrow({ where: { id: reportId } });
    // findFirst: the unique key now includes toState (subject_build networks fan out);
    // report graphs keep (from, event) unique by construction, so this stays deterministic.
    const trans = await this.db.workflowTransition.findFirst({
      where: { definitionId: inq.workflowVersionId, fromState: inq.state, event },
    });
    if (!trans) {
      throw new ConflictError({
        code: ErrorCode.InvalidWorkflowTransition,
        message: `no transition from ${inq.state} on ${event}`,
        details: { from: inq.state, event },
      });
    }

    const ctx = { reportId, boss: this.boss, payload };
    if (trans.guard && Guards[trans.guard] && !(await Guards[trans.guard](ctx))) {
      throw new ConflictError({
        code: ErrorCode.WorkflowGuardBlocked,
        message: `guard ${trans.guard} blocked transition`,
        details: { guard: trans.guard },
      });
    }

    await this.db.report.update({
      where: { id: reportId },
      // Delivery is stamped in the DB (load-test / SLA measurement: deliveredAt − createdAt).
      data: { state: trans.toState, ...(trans.toState === ReportState.REPORT_DELIVERED ? { deliveredAt: new Date() } : {}) },
    });
    if (trans.action && Actions[trans.action]) await Actions[trans.action](ctx);

    // HP-23: carry the derived stage on the transition so the FE renders it from the
    // event without re-deriving (qualified count via the Inquiry→Epic relation).
    const qualifiedCount = await this.db.inquiry.count({ where: { status: InquiryStatus.Qualified, epic: { reportId } } });
    await this.outbox.emit({
      type: EventType.ReportTransitioned,
      reportId,
      data: { from: inq.state, to: trans.toState, event, stage: deriveStage({ state: trans.toState, qualifiedCount }), qualifiedCount },
    });

    // Credit settlement (HP-19): charge on delivery, refund on a non-delivered
    // terminal. Idempotent + a no-op for non-settling states / never-reserved runs.
    // Best-effort: a settlement hiccup must not undo a committed transition.
    const action = settlementActionForState(trans.toState);
    if (action) {
      try {
        await this.credits.settle({ reportId, action });
      } catch (err) {
        this.logger.error(`credit ${action} failed for report ${reportId} (idempotent; safe to re-settle): ${(err as Error).message}`);
      }
    }

    // Lifecycle handlers (HP-13): the customer-visible lifecycle events dispatch here,
    // centrally — delivered → report-ready email, denied → denial email. Best-effort,
    // like the settle above: a notify hiccup must not undo a committed transition.
    const lifecycle = lifecycleEventForState(trans.toState);
    const kind = lifecycle ? notificationForLifecycle(lifecycle) : null;
    if (kind) {
      try {
        await this.boss.enqueue({ job: QueueJob.SendNotification, data: { reportId, kind } });
      } catch (err) {
        this.logger.error(`lifecycle notification ${kind} failed to enqueue for report ${reportId}: ${(err as Error).message}`);
      }
    }

    // subject_build self-improvement: a small chance, per delivery, to enqueue a
    // candidate proposal (compose → rehearse → draft for operator review). Best-effort.
    if (trans.toState === ReportState.REPORT_DELIVERED && shouldPropose({ roll: Math.random() })) {
      try {
        await this.boss.enqueue({ job: QueueJob.ProposeSubjectBuild, data: {} });
      } catch (err) {
        this.logger.warn(`subject_build proposal enqueue failed for report ${reportId}: ${(err as Error).message}`);
      }
    }

    return trans.toState as ReportState;
  }
}
