import { Injectable } from '@nestjs/common';
import { AuthRole, CreateReportDto, EventType, QueueJob, ReportOrigin, WorkflowEvent, deriveStage } from '@inqi/shared';
import { OutboxService } from '../../infra/events/outbox.service';
import { BossService } from '../../infra/queue/boss.service';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';
import { ErrorCode, NotFoundError, PaymentRequiredError } from '../../common/errors';
import { WorkflowEngine } from '../orchestrator/workflow-engine.service';
import { CreditsService } from '../credits/credits.service';
import { FORCED_PERSONA_ID, assignPersona } from '../agent/personas';
import { ReportLifecycleEvent, notificationForLifecycle } from './report-lifecycle';
import { formatReportRef, reportRefPrefix } from './report-ref';
import { ReportRepository } from './report.repository';

/** The authenticated caller (mirrors edge/auth AuthUser; kept local to avoid an edge→domain import). */
export interface ReportViewer { sub: string; email: string; role: AuthRole }

/** Concurrent submits racing the same day-counter: retry the create this many times. */
const REF_MINT_ATTEMPTS = 3;
/** Admin search page size when the caller names none — the picker's "last 10 reports". */
const SEARCH_PAGE_DEFAULT = 10;
/** Prisma unique-constraint violation code. */
const P2002 = 'P2002';

/** The report aggregate + lifecycle entry point. */
@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportRepository,
    private readonly wf: WorkflowEngine,
    private readonly outbox: OutboxService,
    private readonly credits: CreditsService,
    private readonly boss: BossService,
  ) {}

  /**
   * Submit a new report (HP-19: authenticated + credit-gated). The owner is the
   * signed-in customer. Pay-on-delivery: submit only *checks* the balance covers
   * the cost (402 if short and the free slot is spent) — the actual charge lands
   * when the report reaches REPORT_DELIVERED; any other outcome costs nothing.
   *
   * The free-slot claim (HP-21), report row and the `ReportCreated` event run in
   * **one transaction** opened here and threaded down. The queue kickoff is a
   * side-effect, so it runs only after the commit.
   */
  async create({ dto, viewer, origin = ReportOrigin.Web }: { dto: CreateReportDto; viewer: ReportViewer; origin?: ReportOrigin }) {
    const cost = this.credits.reportCost();
    const workflowVersionId = await this.wf.activeVersionId({ key: 'report' });

    // Human-facing ref (RPT-YYMMDD-NN): count today's refs → next seq. Two submits can
    // race the same seq — the unique constraint rejects the loser and the whole create
    // transaction retries with a fresh count (bounded; refs are per-day so a stale
    // count self-corrects immediately).
    const inq = await this.withRefRetry(() => this.createTx({ dto, viewer, cost, workflowVersionId, origin }));

    // `created` lifecycle: RECEIVED is the initial state — no transition lands on it,
    // so the engine can't dispatch this one. Intake acknowledges the customer itself.
    const kind = notificationForLifecycle(ReportLifecycleEvent.Created);
    if (kind) await this.boss.enqueue({ job: QueueJob.SendNotification, data: { reportId: inq.id, kind } });

    // Ops tracking (HP-21): a free (freemium) report was just run — alert the admins.
    if (inq.freeReport) await this.boss.enqueue({ job: QueueJob.NotifyAdminsFreemium, data: { reportId: inq.id } });

    await this.wf.advance({ reportId: inq.id, event: WorkflowEvent.START_PRE_RESEARCH }); // kicks off pre-research (post-commit)
    return inq;
  }

  /**
   * HP-27: start a report from an inbound email. The sender is the owner (account
   * auto-created upstream); the whole flow — questionnaire (if needed) + final
   * report — is handled over email. Uses the free-report slot like any zero-credit
   * on-ramp. `subject` is folded into the request for context.
   */
  createFromEmail({ rawRequest, customer }: { rawRequest: string; customer: { id: string; email: string } }) {
    const viewer: ReportViewer = { sub: customer.id, email: customer.email, role: AuthRole.Customer };
    return this.create({ dto: { rawRequest }, viewer, origin: ReportOrigin.Email });
  }

  /** The submit transaction: free-slot claim + report row (with its minted ref) + created event. */
  private createTx({ dto, viewer, cost, workflowVersionId, origin }: { dto: CreateReportDto; viewer: ReportViewer; cost: number; workflowVersionId: string; origin: ReportOrigin }) {
    return this.prisma.$transaction(async (tx) => {
      // HP-21, credits-first: a customer WITH enough credits always gets a full paid
      // report — the free (freemium-locked) slot is only the fallback when the balance
      // can't cover the cost. This keeps the teaser as the zero-credit on-ramp without
      // ever downgrading a paying customer to a locked report.
      let freeReport = false;
      if (cost > 0) {
        const balance = await this.credits.balance({ customerId: viewer.sub, tx });
        if (balance < cost) {
          freeReport = await this.credits.claimFreeReport({ customerId: viewer.sub, tx });
          if (!freeReport) {
            throw new PaymentRequiredError({ message: `insufficient credits: need ${cost}, have ${balance}`, details: { required: cost, balance } });
          }
        }
      }

      const now = new Date();
      const seq = (await this.reports.countByRefPrefix({ prefix: reportRefPrefix({ date: now }), tx })) + 1;
      const created = await this.reports.create({
        data: {
          ref: formatReportRef({ date: now, seq }),
          customerEmail: viewer.email, customerId: viewer.sub, rawRequest: dto.rawRequest, workflowVersionId,
          geoLat: dto.geo?.lat, geoLng: dto.geo?.lng, geoLabel: dto.geo?.label,
          budgetMin: dto.budgetMin, budgetMax: dto.budgetMax,
          deadline: dto.deadline ? new Date(dto.deadline) : null,
          focus: dto.focus ?? null, // ranking priority — steers depth research (price | quality)
          origin, // web | email (HP-27)
          freeReport,
          // Report 1:1 persona: one region-matched voice carries every thread of this
          // report — routed by the geo label, else by places named in the request text,
          // else randomly (the fleet must not read as one person). The hardcoded
          // FORCED_PERSONA_ID pin (email-approval mode) overrides all of that.
          personaId: assignPersona({ forcedId: FORCED_PERSONA_ID, regionHint: dto.geo?.label ?? null, requestText: dto.rawRequest }).id,
        },
        tx,
      });

      // Pay-on-delivery: nothing is held here — the cost is charged only when the
      // report reaches REPORT_DELIVERED (workflow settle). A run that fails, drops
      // or is cancelled never touches the balance.
      await this.outbox.emit({ type: EventType.ReportCreated, reportId: created.id, data: { rawRequest: created.rawRequest, ref: created.ref }, tx });
      return created;
    });
  }

  /** Retry the create when the minted ref lost a same-second race (unique violation). */
  private async withRefRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const conflict = (e as { code?: string; meta?: { target?: string[] } })?.code === P2002;
        if (!conflict || attempt >= REF_MINT_ATTEMPTS) throw e;
      }
    }
  }

  /** Detail read, ownership-scoped: admins see any; a customer only their own (else 404 — no existence leak). */
  async get({ id, viewer }: { id: string; viewer: ReportViewer }) {
    const inq = await this.reports.findWithRelations({ id });
    if (viewer.role !== AuthRole.Admin && inq.customerId !== viewer.sub && inq.customerEmail !== viewer.email) {
      throw new NotFoundError({ code: ErrorCode.ReportNotFound, message: 'report not found' });
    }
    return inq;
  }

  /** List read, ownership-scoped: admins see all; customers see only their own.
   *  HP-23: each row is enriched with its qualified count + derived stage. */
  async list({ viewer }: { viewer: ReportViewer }) {
    const rows = viewer.role === AuthRole.Admin
      ? await this.reports.listRecent()
      : await this.reports.listForOwner({ customerId: viewer.sub, email: viewer.email });
    const counts = await this.reports.qualifiedCountsByReport({ reportIds: rows.map((r) => r.id) });
    return rows.map((r) => {
      const qualifiedCount = counts[r.id] ?? 0;
      return { ...r, qualifiedCount, stage: deriveStage({ state: r.state, qualifiedCount }) };
    });
  }

  /**
   * Admin report search (the operator picker): newest-first, cursor-paginated so the
   * picker can scroll indefinitely. `q` matches the ref / customer email / request
   * text; no q = the most recent reports (the picker's default page).
   */
  async search({ q, limit = SEARCH_PAGE_DEFAULT, cursor }: { q?: string; limit?: number; cursor?: string }) {
    const rows = await this.reports.searchAdmin({ q, take: limit, cursorId: cursor });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { rows: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  /** Backfill ownership when a customer signs in (claims reports submitted with their email). */
  linkOwnerByEmail({ email, customerId, tx }: { email: string; customerId: string; tx?: DbTx }) {
    return this.reports.linkOwnerByEmail({ email, customerId, tx });
  }
}
