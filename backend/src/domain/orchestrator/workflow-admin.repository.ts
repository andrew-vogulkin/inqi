import { Injectable } from '@nestjs/common';
import { WorkflowStatus } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for workflow-version management (read + transactional publish). */
@Injectable()
export class WorkflowAdminRepository {
  constructor(private readonly db: PrismaService) {}

  listDefinitions() {
    return this.db.workflowDefinition.findMany({ orderBy: [{ key: 'asc' }, { version: 'asc' }] });
  }

  findWithGraph({ id }: { id: string }) {
    return this.db.workflowDefinition.findUnique({ where: { id }, include: { states: true, transitions: true } });
  }

  findActive({ key }: { key: string }) {
    return this.db.workflowDefinition.findFirst({ where: { key, status: WorkflowStatus.Active }, include: { states: true, transitions: true } });
  }

  /** Inquiries pinned per workflow version (defId → count). */
  async pinnedCounts(): Promise<Map<string, number>> {
    const rows = await this.db.inquiry.groupBy({ by: ['workflowVersionId'], _count: { _all: true } });
    return new Map(rows.map((r) => [r.workflowVersionId, r._count._all]));
  }

  /** Transactionally activate `id` and archive the currently-active version(s) of the same key. */
  publish({ id, key }: { id: string; key: string }) {
    return this.db.$transaction([
      this.db.workflowDefinition.updateMany({
        where: { key, status: WorkflowStatus.Active, id: { not: id } },
        data: { status: WorkflowStatus.Archived },
      }),
      this.db.workflowDefinition.update({ where: { id }, data: { status: WorkflowStatus.Active } }),
    ]);
  }
}
