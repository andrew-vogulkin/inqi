import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BossService } from '../queue/boss.service';
import { OutboxService } from '../events/outbox.service';
import { Actions, Guards } from './registry';

/** Data-driven, versioned state machine. Transitions live in the DB and are
 *  pinned per inquiry (inquiry.workflowVersionId). See DESIGN.md §3. */
@Injectable()
export class WorkflowEngine {
  constructor(private db: PrismaService, private boss: BossService, private outbox: OutboxService) {}

  /** The active version new inquiries start on. */
  async activeVersionId(key = 'inquiry'): Promise<string> {
    const def = await this.db.workflowDefinition.findFirst({ where: { key, status: 'active' }, orderBy: { version: 'desc' } });
    if (!def) throw new Error('no active workflow — run db:seed');
    return def.id;
  }

  async advance(inquiryId: string, event: string, payload?: any) {
    const inq = await this.db.inquiry.findUniqueOrThrow({ where: { id: inquiryId } });
    const trans = await this.db.workflowTransition.findUnique({
      where: { definitionId_fromState_event: { definitionId: inq.workflowVersionId, fromState: inq.state, event } },
    });
    if (!trans) throw new BadRequestException(`no transition from ${inq.state} on ${event}`);

    const ctx = { inquiryId, boss: this.boss, payload };
    if (trans.guard && Guards[trans.guard] && !(await Guards[trans.guard](ctx))) {
      throw new BadRequestException(`guard ${trans.guard} blocked transition`);
    }

    await this.db.inquiry.update({ where: { id: inquiryId }, data: { state: trans.toState } });
    if (trans.action && Actions[trans.action]) await Actions[trans.action](ctx);

    await this.outbox.emit('inquiry.transitioned', {
      inquiryId, data: { from: inq.state, to: trans.toState, event },
    });
    return trans.toState;
  }
}
