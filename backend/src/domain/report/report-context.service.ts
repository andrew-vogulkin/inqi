import { Injectable } from '@nestjs/common';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';
import { AgentContext, packAgentContext } from './report-context';

const MESSAGES_PER_THREAD = 20;

/**
 * Loads a report's full picture (inquiries + their sources + latest messages) and
 * packs it into a budgeted model context via {@link packAgentContext}. This is the
 * one place agents pull "everything we know so far" from — synthesis (100k),
 * the reply loop (focused, ~50k) and outreach drafting (~30k).
 */
@Injectable()
export class ReportContextService {
  constructor(private readonly db: PrismaService) {}

  async buildAgentContext({ reportId, budgetTokens, focusInquiryId, tx }: {
    reportId: string; budgetTokens?: number; focusInquiryId?: string | null; tx?: DbTx;
  }): Promise<AgentContext> {
    const exec = tx ?? this.db;
    const report = await exec.report.findUniqueOrThrow({
      where: { id: reportId },
      select: {
        rawRequest: true, geoLabel: true, budgetMin: true, budgetMax: true, deadline: true,
        subject: { select: { title: true, description: true } },
        questionnaire: { select: { answers: true, confirmed: true } },
        inquiries: {
          select: {
            id: true, name: true, status: true, qualityScore: true, result: true, createdAt: true,
            sources: { select: { type: true, url: true, title: true, snippet: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
            messages: { select: { direction: true, body: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: MESSAGES_PER_THREAD },
          },
        },
      },
    });
    return packAgentContext({
      report,
      subject: report.subject,
      questionnaire: report.questionnaire,
      inquiries: report.inquiries,
      budgetTokens,
      focusInquiryId,
    });
  }
}
