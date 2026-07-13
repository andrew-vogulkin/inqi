import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { ComplianceKind, QuestionnaireAnswersDto, ReportOrigin, ReviewStatus, UsageKind, WorkflowEvent } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { WorkflowEngine } from '../orchestrator/workflow-engine.service';
import { ComplianceBlockedError, DomainError, ErrorCode, NotFoundError } from '../../common/errors';
import { ownsResource, OwnershipViewer } from '../../common/ownership';
import { COMPLIANCE_SCORER, ComplianceScorer } from '../compliance/compliance.tokens';
import { MAIL_PROVIDER, MailProvider } from '../source/mail.provider';
import { UsageService } from '../../infra/usage/usage.service';
import { QuestionnaireRepository } from './questionnaire.repository';
import { QuestionnaireGenerator } from './questionnaire-generator';
import { QuestionnaireQuestion, QuestionType } from './questionnaire.types';

/** Tokened questionnaire link + the mandatory customer-confirm gate. */
@Injectable()
export class QuestionnaireService {
  private readonly logger = new Logger(QuestionnaireService.name);

  constructor(
    private readonly questionnaires: QuestionnaireRepository,
    private readonly wf: WorkflowEngine,
    private readonly config: ConfigService,
    private readonly generator: QuestionnaireGenerator,
    private readonly usage: UsageService,
    @Inject(COMPLIANCE_SCORER) private readonly compliance: ComplianceScorer,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
  ) {}

  /**
   * Create the tokened questionnaire after compliance-scoring the questions
   * (every questionnaire is gated before it's shared with the customer). Throws
   * {@link ComplianceBlockedError} when blocked — the caller (pre-research) maps
   * that to a denial through the existing PRE_RESEARCH→DENIED gate.
   */
  async createForReport({ reportId, questions }: { reportId: string; questions: QuestionnaireQuestion[] }): Promise<string> {
    const review = await this.compliance.score({ kind: ComplianceKind.Questionnaire, text: questions.map((q) => q.prompt).join('\n') });
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + this.config.questionnaireTtlHours * 3600_000);
    // Persist the questionnaire (incl. its review outcome) so passes AND blocks are auditable (HP-14).
    await this.questionnaires.create({
      data: { reportId, token, questions: questions as unknown as Prisma.InputJsonValue, reviewStatus: review.status, riskScore: review.score, expiresAt },
    });
    if (review.status === ReviewStatus.Blocked) {
      // Recorded for audit; the link is never shared — the caller denies the report.
      throw new ComplianceBlockedError({ message: 'questionnaire blocked by the compliance gate', details: { categories: review.categories, reason: review.reason } });
    }
    return `${this.config.publicBaseUrl}/q/${token}`; // temp link shared with the customer
  }

  /** The customer link for an already-created questionnaire (used by the send step). */
  async linkForReport({ reportId }: { reportId: string }): Promise<string | null> {
    const q = await this.questionnaires.findByReport({ reportId });
    return q ? `${this.config.publicBaseUrl}/q/${q.token}` : null;
  }

  /** HP-24: the token resolves only within the owner's scope (non-owner → same 404). */
  private async ownedByToken({ token, viewer }: { token: string; viewer: OwnershipViewer }) {
    const q = await this.questionnaires.findByToken({ token });
    if (!q) throw new NotFoundError({ code: ErrorCode.QuestionnaireNotFound, message: 'questionnaire not found' });
    const owner = await this.questionnaires.reportOwner({ reportId: q.reportId });
    if (!owner || !ownsResource({ resource: owner, viewer })) throw new NotFoundError({ code: ErrorCode.QuestionnaireNotFound, message: 'questionnaire not found' });
    return q;
  }

  async getByToken({ token, viewer }: { token: string; viewer: OwnershipViewer }) {
    return this.ownedByToken({ token, viewer });
  }

  async submit({ token, answers, viewer }: { token: string; answers: QuestionnaireAnswersDto; viewer: OwnershipViewer }): Promise<{ ok: true }> {
    const q = await this.ownedByToken({ token, viewer });
    if (q.expiresAt < new Date()) throw new DomainError({ code: ErrorCode.QuestionnaireExpired, message: 'link expired' });
    if (!answers.confirmedSubject) {
      throw new DomainError({ code: ErrorCode.QuestionnaireNotConfirmed, message: 'customer must confirm the subject' });
    }

    // Compliance gate on the CUSTOMER'S ANSWERS (every value is customer-controlled
    // text at the API level, not just the free-text questions). A block records the
    // answers + verdict for audit, DENIES the report and never advances the pipeline.
    const text = Object.values(answers.answers ?? {}).filter((v) => String(v ?? '').trim()).join('\n');
    const review = text
      ? await this.compliance.score({ kind: ComplianceKind.QuestionnaireAnswers, text })
      : null;
    await this.questionnaires.update({
      token,
      data: { answers: answers.answers, confirmed: true, filledAt: new Date(), ...(review ? { reviewStatus: review.status, riskScore: review.score } : {}) },
    });
    if (review?.status === ReviewStatus.Blocked) {
      await this.questionnaires.denyReport({ reportId: q.reportId, reason: `answers_compliance: ${review.reason || review.categories.join(', ') || 'policy'}` });
      await this.wf.advance({ reportId: q.reportId, event: WorkflowEvent.QUESTIONNAIRE_DENIED }); // -> DENIED (lifecycle emails the denial)
      throw new ComplianceBlockedError({ message: 'the submitted answers were blocked by the compliance gate', details: { categories: review.categories, reason: review.reason } });
    }

    await this.wf.advance({ reportId: q.reportId, event: WorkflowEvent.QUESTIONNAIRE_FILLED }); // -> ENRICHMENT
    return { ok: true };
  }

  /**
   * Autopilot (HP-26): persist agent-inferred answers and mark the questionnaire
   * confirmed, so the pipeline can proceed without the customer. Runs the SAME
   * compliance gate as {@link submit} — blocked answers are recorded but NOT
   * confirmed, so the report falls back to the human questionnaire path. Does NOT
   * advance the workflow (the report is still in pre-research); the report leaves
   * QUESTIONNAIRE_SENT via the send step once it sees `confirmed`. Returns whether
   * the questionnaire was auto-confirmed.
   */
  async autofill({ reportId, answers }: { reportId: string; answers: Record<string, string> }): Promise<boolean> {
    const q = await this.questionnaires.findByReport({ reportId });
    if (!q) return false;
    const text = Object.values(answers).filter((v) => String(v ?? '').trim()).join('\n');
    const review = text ? await this.compliance.score({ kind: ComplianceKind.QuestionnaireAnswers, text }) : null;
    if (review?.status === ReviewStatus.Blocked) {
      // Record the verdict for audit, leave unconfirmed → the customer is asked instead.
      await this.questionnaires.update({ token: q.token, data: { reviewStatus: review.status, riskScore: review.score } });
      return false;
    }
    await this.questionnaires.update({
      token: q.token,
      data: { answers: answers as unknown as Prisma.InputJsonValue, confirmed: true, filledAt: new Date(), ...(review ? { reviewStatus: review.status, riskScore: review.score } : {}) },
    });
    return true;
  }

  /** Whether the report's questionnaire is confirmed (auto-filled or human-submitted). */
  async isConfirmed({ reportId }: { reportId: string }): Promise<boolean> {
    const q = await this.questionnaires.findByReport({ reportId });
    return !!q?.confirmed;
  }

  /**
   * HP-27: reach the customer with the questionnaire on the right channel. An
   * email-originated report gets the questions BY EMAIL (reply-to a per-questionnaire
   * address); a web report relies on the `needs-you` link email that already fired.
   * Called from the send step only when the questionnaire isn't already confirmed.
   */
  async dispatch({ reportId }: { reportId: string }): Promise<void> {
    const r = await this.questionnaires.reportDispatch({ reportId });
    if (r?.origin === ReportOrigin.Email && r.customerEmail) {
      await this.sendByEmail({ reportId, customerEmail: r.customerEmail });
    }
  }

  /** Email the questions with a minted per-questionnaire reply address, so the customer can just reply. */
  private async sendByEmail({ reportId, customerEmail }: { reportId: string; customerEmail: string }): Promise<void> {
    const q = await this.questionnaires.findByReport({ reportId });
    if (!q) return;
    const questions = ((q.questions as unknown as QuestionnaireQuestion[]) ?? []).filter((x) => x.type !== QuestionType.Confirm);
    const replyAddress = q.replyAddress ?? `${randomBytes(16).toString('hex')}@${this.config.inboundDomain}`;
    if (!q.replyAddress) await this.questionnaires.update({ token: q.token, data: { replyAddress } });
    const body = [
      'Thanks for your request — a few quick questions will make the research sharp.',
      'Just reply to this email in plain words; answer what you can, and say "you decide" for anything you\'re unsure about.',
      '',
      ...questions.map((x, i) => `${i + 1}. ${x.prompt}${(x.options ?? []).length ? `\n   (${(x.options ?? []).join(' / ')})` : ''}`),
      '',
      'Reply and we\'ll get started.',
      '— inqi',
    ].join('\n');
    // from = the reply address → the provider sets ReplyTo to it, so the customer's reply routes back here.
    await this.mail.send({ from: replyAddress, to: customerEmail, subject: 'A few quick questions about your request', body });
    void this.usage.recordAction({ reportId, kind: UsageKind.EmailSent }); // cost accounting (HP-15)
    this.logger.log(`questionnaire emailed to ${customerEmail} (reply → ${replyAddress})`);
  }

  /**
   * HP-27: an inbound email arrived at a questionnaire reply address. Parse the free
   * text into answers and settle the questionnaire. Idempotent (already-confirmed →
   * no-op). Returns whether this inbound was a questionnaire reply (so the caller
   * doesn't also run the vendor reply loop).
   */
  async handleEmailReply({ toAddr, body }: { toAddr: string; body: string }): Promise<{ handled: boolean; reportId?: string }> {
    const q = await this.questionnaires.findByReplyAddress({ replyAddress: (toAddr ?? '').trim().toLowerCase() });
    if (!q) return { handled: false };
    if (q.confirmed) return { handled: true, reportId: q.reportId }; // already filled — idempotent
    const questions = (q.questions as unknown as QuestionnaireQuestion[]) ?? [];
    const { answers, confirmedSubject } = await this.generator.parseReply({ questions, replyBody: body });
    await this.submitFromEmail({ reportId: q.reportId, answers, confirmedSubject });
    return { handled: true, reportId: q.reportId };
  }

  /** System submit (no ownership check — the secret reply address IS the authorization). */
  private async submitFromEmail({ reportId, answers, confirmedSubject }: { reportId: string; answers: Record<string, string>; confirmedSubject: boolean }): Promise<void> {
    const q = await this.questionnaires.findByReport({ reportId });
    if (!q || q.confirmed) return;
    if (!confirmedSubject) {
      this.logger.log(`questionnaire email reply for ${reportId} did not confirm the scope — leaving it open for a follow-up`);
      return;
    }
    const text = Object.values(answers).filter((v) => String(v ?? '').trim()).join('\n');
    const review = text ? await this.compliance.score({ kind: ComplianceKind.QuestionnaireAnswers, text }) : null;
    await this.questionnaires.update({
      token: q.token,
      data: { answers: answers as unknown as Prisma.InputJsonValue, confirmed: true, filledAt: new Date(), ...(review ? { reviewStatus: review.status, riskScore: review.score } : {}) },
    });
    if (review?.status === ReviewStatus.Blocked) {
      await this.questionnaires.denyReport({ reportId, reason: `answers_compliance: ${review.reason || review.categories.join(', ') || 'policy'}` });
      await this.wf.advance({ reportId, event: WorkflowEvent.QUESTIONNAIRE_DENIED });
      return;
    }
    await this.wf.advance({ reportId, event: WorkflowEvent.QUESTIONNAIRE_FILLED }); // -> ENRICHMENT
  }
}
