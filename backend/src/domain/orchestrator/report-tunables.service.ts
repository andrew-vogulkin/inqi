import { Injectable } from '@nestjs/common';
import { NotFoundError, ErrorCode } from '../../common/errors';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { REPORT_WORKFLOW_KEY, configuredTunables } from '../phases/phase-tunables';

/**
 * Carrier B for the report machine's genes: the report lifecycle is event-driven
 * and long-lived, so there is no startRun moment to pin values into (the phase
 * engines' run.data). Instead every consumer resolves the genes at action time
 * through the report's PINNED workflow version — which gives the same mid-flight
 * consistency the pin was invented for. Published versions are immutable, so the
 * per-version resolution is cached for the process lifetime.
 */
@Injectable()
export class ReportTunablesService {
  private readonly byVersion = new Map<string, Record<string, number>>();

  constructor(private readonly db: PrismaService) {}

  /** The clamped gene values a pinned version's state configs set (unset genes are absent — callers `?? fallback`). */
  async forVersion({ workflowVersionId }: { workflowVersionId: string }): Promise<Record<string, number>> {
    const hit = this.byVersion.get(workflowVersionId);
    if (hit) return hit;
    const states = await this.db.workflowState.findMany({
      where: { definitionId: workflowVersionId },
      select: { name: true, config: true },
    });
    const genes = configuredTunables({ key: REPORT_WORKFLOW_KEY, states: states.map((s) => ({ name: s.name, config: s.config ?? undefined })) });
    this.byVersion.set(workflowVersionId, genes);
    return genes;
  }

  async forReport({ reportId }: { reportId: string }): Promise<Record<string, number>> {
    const report = await this.db.report.findUnique({ where: { id: reportId }, select: { workflowVersionId: true } });
    if (!report) throw new NotFoundError({ code: ErrorCode.NotFound, message: `report ${reportId} not found` });
    return this.forVersion({ workflowVersionId: report.workflowVersionId });
  }
}
