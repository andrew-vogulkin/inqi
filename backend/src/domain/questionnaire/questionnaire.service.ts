import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { ComplianceKind, QuestionnaireAnswersDto, ReviewStatus, WorkflowEvent } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { WorkflowEngine } from '../orchestrator/workflow-engine.service';
import { ComplianceBlockedError, DomainError, ErrorCode, NotFoundError } from '../../common/errors';
import { ownsResource, OwnershipViewer } from '../../common/ownership';
import { COMPLIANCE_SCORER, ComplianceScorer } from '../compliance/compliance.tokens';
import { QuestionnaireRepository } from './questionnaire.repository';
import { QuestionnaireQuestion } from './questionnaire.types';

/** Tokened questionnaire link + the mandatory customer-confirm gate. */
@Injectable()
export class QuestionnaireService {
  constructor(
    private readonly questionnaires: QuestionnaireRepository,
    private readonly wf: WorkflowEngine,
    private readonly config: ConfigService,
    @Inject(COMPLIANCE_SCORER) private readonly compliance: ComplianceScorer,
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
    await this.questionnaires.update({ token, data: { answers: answers.answers, confirmed: true, filledAt: new Date() } });
    await this.wf.advance({ reportId: q.reportId, event: WorkflowEvent.QUESTIONNAIRE_FILLED }); // -> ENRICHMENT
    return { ok: true };
  }
}
