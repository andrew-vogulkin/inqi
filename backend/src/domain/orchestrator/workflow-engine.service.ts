import { Injectable, Logger } from '@nestjs/common';
import { EventType, InquiryState, WorkflowEvent, WorkflowStatus, deriveStage } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { ConflictError, DomainError, ErrorCode } from '../../common/errors';
import { CreditsService } from '../credits/credits.service';
import { settlementActionForState } from '../credits/credits.balance';
import { Actions, Guards } from './workflow-registry';

/**
 * Data-driven, versioned state machine. Transitions live in the DB and are
 * pinned per inquiry (`inquiry.workflowVersionId`), so workflow upgrades never
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

  /** The active version new inquiries start on. */
  async activeVersionId({ key = 'inquiry' }: { key?: string } = {}): Promise<string> {
    const def = await this.db.workflowDefinition.findFirst({
      where: { key, status: WorkflowStatus.Active },
      orderBy: { version: 'desc' },
    });
    if (!def) {
      throw new DomainError({ code: ErrorCode.NoActiveWorkflow, message: `no active workflow for "${key}" — run db:seed`, retryable: false });
    }
    return def.id;
  }

  /** Advance an inquiry by firing a workflow event; runs the transition's guard + action. */
  async advance({ inquiryId, event, payload }: { inquiryId: string; event: WorkflowEvent; payload?: unknown }): Promise<InquiryState> {
    const inq = await this.db.inquiry.findUniqueOrThrow({ where: { id: inquiryId } });
    const trans = await this.db.workflowTransition.findUnique({
      where: { definitionId_fromState_event: { definitionId: inq.workflowVersionId, fromState: inq.state, event } },
    });
    if (!trans) {
      throw new ConflictError({
        code: ErrorCode.InvalidWorkflowTransition,
        message: `no transition from ${inq.state} on ${event}`,
        details: { from: inq.state, event },
      });
    }

    const ctx = { inquiryId, boss: this.boss, payload };
    if (trans.guard && Guards[trans.guard] && !(await Guards[trans.guard](ctx))) {
      throw new ConflictError({
        code: ErrorCode.WorkflowGuardBlocked,
        message: `guard ${trans.guard} blocked transition`,
        details: { guard: trans.guard },
      });
    }

    await this.db.inquiry.update({ where: { id: inquiryId }, data: { state: trans.toState } });
    if (trans.action && Actions[trans.action]) await Actions[trans.action](ctx);

    // HP-23: carry the derived stage on the transition so the FE renders it from the
    // event without re-deriving (qualified count via the Subtask→Epic relation).
    const qualifiedCount = await this.db.subtask.count({ where: { status: 'qualified', epic: { inquiryId } } });
    await this.outbox.emit({
      type: EventType.InquiryTransitioned,
      inquiryId,
      data: { from: inq.state, to: trans.toState, event, stage: deriveStage({ state: trans.toState, qualifiedCount }), qualifiedCount },
    });

    // Credit settlement (HP-19): charge on delivery, refund on a non-delivered
    // terminal. Idempotent + a no-op for non-settling states / never-reserved runs.
    // Best-effort: a settlement hiccup must not undo a committed transition.
    const action = settlementActionForState(trans.toState);
    if (action) {
      try {
        await this.credits.settle({ inquiryId, action });
      } catch (err) {
        this.logger.error(`credit ${action} failed for inquiry ${inquiryId} (idempotent; safe to re-settle): ${(err as Error).message}`);
      }
    }

    return trans.toState as InquiryState;
  }
}
