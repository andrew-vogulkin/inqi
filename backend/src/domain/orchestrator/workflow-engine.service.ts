import { Injectable } from '@nestjs/common';
import { EventType, InquiryState, WorkflowEvent, WorkflowStatus } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { ConflictError, DomainError, ErrorCode } from '../../common/errors';
import { Actions, Guards } from './workflow-registry';

/**
 * Data-driven, versioned state machine. Transitions live in the DB and are
 * pinned per inquiry (`inquiry.workflowVersionId`), so workflow upgrades never
 * break in-flight work.
 */
@Injectable()
export class WorkflowEngine {
  constructor(
    private readonly db: PrismaService,
    private readonly boss: BossService,
    private readonly outbox: OutboxService,
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

    await this.outbox.emit({
      type: EventType.InquiryTransitioned,
      inquiryId,
      data: { from: inq.state, to: trans.toState, event },
    });
    return trans.toState as InquiryState;
  }
}
