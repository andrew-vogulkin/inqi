import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowEngine } from '../workflow/engine.service';
import { OutboxService } from '../events/outbox.service';

@Injectable()
export class InquiriesService {
  constructor(private db: PrismaService, private wf: WorkflowEngine, private outbox: OutboxService) {}

  async create(dto: any) {
    const workflowVersionId = await this.wf.activeVersionId('inquiry');
    const inq = await this.db.inquiry.create({
      data: {
        customerEmail: dto.customerEmail, rawRequest: dto.rawRequest,
        workflowVersionId,
        geoLat: dto.geo?.lat, geoLng: dto.geo?.lng, geoLabel: dto.geo?.label,
        budgetMin: dto.budgetMin, budgetMax: dto.budgetMax,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
      },
    });
    await this.outbox.emit('inquiry.created', { inquiryId: inq.id, data: { rawRequest: inq.rawRequest } });
    await this.wf.advance(inq.id, 'START_PRE_RESEARCH'); // kicks off pre-research job
    return inq;
  }

  get(id: string) {
    return this.db.inquiry.findUniqueOrThrow({
      where: { id },
      include: { subject: true, questionnaire: true, epics: { include: { subtasks: true } }, report: true },
    });
  }

  list() { return this.db.inquiry.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }); }
}
