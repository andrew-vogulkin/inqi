import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowEngine } from '../workflow/engine.service';

@Injectable()
export class QuestionnaireService {
  constructor(private db: PrismaService, private wf: WorkflowEngine) {}

  /** Called by the send_questionnaire job after pre-research passes. */
  async createForInquiry(inquiryId: string, questions: any[]) {
    const ttl = Number(process.env.QUESTIONNAIRE_TTL_HOURS ?? 72);
    const token = randomBytes(24).toString('hex');
    // Ethical+legal scoring gate before the questionnaire is shared with the customer.
    // TODO: score `questions` via Qwen rubric; block + re-deny if it surfaces anything illegal.
    await this.db.questionnaire.create({
      data: { inquiryId, token, questions, reviewStatus: 'passed', expiresAt: new Date(Date.now() + ttl * 3600_000) },
    });
    return `${process.env.PUBLIC_BASE_URL}/q/${token}`; // temp link shared with customer
  }

  getByToken(token: string) {
    return this.db.questionnaire.findUniqueOrThrow({ where: { token } });
  }

  async submit(token: string, dto: { confirmedSubject: boolean; answers: Record<string, string> }) {
    const q = await this.db.questionnaire.findUnique({ where: { token } });
    if (!q) throw new NotFoundException();
    if (q.expiresAt < new Date()) throw new BadRequestException('link expired');
    if (!dto.confirmedSubject) throw new BadRequestException('customer must confirm the subject');
    await this.db.questionnaire.update({
      where: { token }, data: { answers: dto.answers, confirmed: true, filledAt: new Date() },
    });
    await this.wf.advance(q.inquiryId, 'QUESTIONNAIRE_FILLED'); // -> ENRICHMENT
    return { ok: true };
  }
}
