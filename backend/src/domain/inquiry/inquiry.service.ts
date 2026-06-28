import { Injectable } from '@nestjs/common';
import { AuthRole, CreateInquiryDto, EventType, WorkflowEvent } from '@inqi/shared';
import { OutboxService } from '../../infra/events/outbox.service';
import { ErrorCode, NotFoundError } from '../../common/errors';
import { WorkflowEngine } from '../orchestrator/workflow-engine.service';
import { InquiryRepository } from './inquiry.repository';

/** The authenticated caller (mirrors edge/auth AuthUser; kept local to avoid an edge→domain import). */
export interface InquiryViewer { sub: string; email: string; role: AuthRole }

/** The inquiry aggregate + lifecycle entry point. */
@Injectable()
export class InquiryService {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly wf: WorkflowEngine,
    private readonly outbox: OutboxService,
  ) {}

  async create({ dto }: { dto: CreateInquiryDto }) {
    const workflowVersionId = await this.wf.activeVersionId({ key: 'inquiry' });
    const inq = await this.inquiries.create({
      data: {
        customerEmail: dto.customerEmail, rawRequest: dto.rawRequest, workflowVersionId,
        geoLat: dto.geo?.lat, geoLng: dto.geo?.lng, geoLabel: dto.geo?.label,
        budgetMin: dto.budgetMin, budgetMax: dto.budgetMax,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
      },
    });
    await this.outbox.emit({ type: EventType.InquiryCreated, inquiryId: inq.id, data: { rawRequest: inq.rawRequest } });
    await this.wf.advance({ inquiryId: inq.id, event: WorkflowEvent.START_PRE_RESEARCH }); // kicks off pre-research
    return inq;
  }

  /** Detail read, ownership-scoped: admins see any; a customer only their own (else 404 — no existence leak). */
  async get({ id, viewer }: { id: string; viewer: InquiryViewer }) {
    const inq = await this.inquiries.findWithRelations({ id });
    if (viewer.role !== AuthRole.Admin && inq.customerId !== viewer.sub && inq.customerEmail !== viewer.email) {
      throw new NotFoundError({ code: ErrorCode.InquiryNotFound, message: 'inquiry not found' });
    }
    return inq;
  }

  /** List read, ownership-scoped: admins see all; customers see only their own. */
  list({ viewer }: { viewer: InquiryViewer }) {
    return viewer.role === AuthRole.Admin
      ? this.inquiries.listRecent()
      : this.inquiries.listForOwner({ customerId: viewer.sub, email: viewer.email });
  }

  /** Backfill ownership when a customer signs in (claims inquiries submitted with their email). */
  linkOwnerByEmail({ email, customerId }: { email: string; customerId: string }) {
    return this.inquiries.linkOwnerByEmail({ email, customerId });
  }
}
