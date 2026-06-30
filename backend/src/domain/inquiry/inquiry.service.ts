import { Injectable } from '@nestjs/common';
import { AuthRole, CreateInquiryDto, EventType, WorkflowEvent, deriveStage } from '@inqi/shared';
import { OutboxService } from '../../infra/events/outbox.service';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';
import { ErrorCode, NotFoundError, PaymentRequiredError } from '../../common/errors';
import { WorkflowEngine } from '../orchestrator/workflow-engine.service';
import { CreditsService } from '../credits/credits.service';
import { InquiryRepository } from './inquiry.repository';

/** The authenticated caller (mirrors edge/auth AuthUser; kept local to avoid an edge→domain import). */
export interface InquiryViewer { sub: string; email: string; role: AuthRole }

/** The inquiry aggregate + lifecycle entry point. */
@Injectable()
export class InquiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inquiries: InquiryRepository,
    private readonly wf: WorkflowEngine,
    private readonly outbox: OutboxService,
    private readonly credits: CreditsService,
  ) {}

  /**
   * Submit a new inquiry (HP-19: authenticated + credit-gated). The owner is the
   * signed-in customer; running reserves the report cost (402 if short).
   *
   * The free-slot claim (HP-21), inquiry row, credit reservation and the
   * `InquiryCreated` event all run in **one transaction** opened here and threaded
   * down: if a concurrent submit wins the last credit, the reserve throws 402 and
   * the whole unit (claim + inquiry) rolls back automatically — no orphan to delete.
   * The queue kickoff is a side-effect, so it runs only after the commit.
   */
  async create({ dto, viewer }: { dto: CreateInquiryDto; viewer: InquiryViewer }) {
    const cost = this.credits.reportCost();
    const workflowVersionId = await this.wf.activeVersionId({ key: 'inquiry' });

    const inq = await this.prisma.$transaction(async (tx) => {
      // HP-21: the customer's first report is free (freemium — locked; unlock charges
      // 1 credit). Claim the free slot atomically; only if it's not free do we credit-gate.
      let freeReport = false;
      if (cost > 0) {
        freeReport = await this.credits.claimFreeReport({ customerId: viewer.sub, tx });
        if (!freeReport) {
          const balance = await this.credits.balance({ customerId: viewer.sub, tx });
          if (balance < cost) {
            throw new PaymentRequiredError({ message: `insufficient credits: need ${cost}, have ${balance}`, details: { required: cost, balance } });
          }
        }
      }

      const created = await this.inquiries.create({
        data: {
          customerEmail: viewer.email, customerId: viewer.sub, rawRequest: dto.rawRequest, workflowVersionId,
          geoLat: dto.geo?.lat, geoLng: dto.geo?.lng, geoLabel: dto.geo?.label,
          budgetMin: dto.budgetMin, budgetMax: dto.budgetMax,
          deadline: dto.deadline ? new Date(dto.deadline) : null,
          freeReport,
        },
        tx,
      });

      // Reserve authoritatively in the same tx; a lost credit race throws 402 → rollback.
      if (cost > 0 && !freeReport) {
        await this.credits.reserve({ customerId: viewer.sub, inquiryId: created.id, actor: viewer.email, tx });
      }
      await this.outbox.emit({ type: EventType.InquiryCreated, inquiryId: created.id, data: { rawRequest: created.rawRequest }, tx });
      return created;
    });

    await this.wf.advance({ inquiryId: inq.id, event: WorkflowEvent.START_PRE_RESEARCH }); // kicks off pre-research (post-commit)
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

  /** List read, ownership-scoped: admins see all; customers see only their own.
   *  HP-23: each row is enriched with its qualified count + derived stage. */
  async list({ viewer }: { viewer: InquiryViewer }) {
    const rows = viewer.role === AuthRole.Admin
      ? await this.inquiries.listRecent()
      : await this.inquiries.listForOwner({ customerId: viewer.sub, email: viewer.email });
    const counts = await this.inquiries.qualifiedCountsByInquiry({ inquiryIds: rows.map((r) => r.id) });
    return rows.map((r) => {
      const qualifiedCount = counts[r.id] ?? 0;
      return { ...r, qualifiedCount, stage: deriveStage({ state: r.state, qualifiedCount }) };
    });
  }

  /** Backfill ownership when a customer signs in (claims inquiries submitted with their email). */
  linkOwnerByEmail({ email, customerId, tx }: { email: string; customerId: string; tx?: DbTx }) {
    return this.inquiries.linkOwnerByEmail({ email, customerId, tx });
  }
}
