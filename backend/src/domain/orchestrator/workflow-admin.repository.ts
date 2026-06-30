import { Injectable } from '@nestjs/common';
import { WorkflowStatus } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for workflow-version management (read + transactional publish). */
@Injectable()
export class WorkflowAdminRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  listDefinitions({ tx }: { tx?: DbTx } = {}) {
    return this.exec(tx).workflowDefinition.findMany({ orderBy: [{ key: 'asc' }, { version: 'asc' }] });
  }

  findWithGraph({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).workflowDefinition.findUnique({ where: { id }, include: { states: true, transitions: true } });
  }

  findActive({ key, tx }: { key: string; tx?: DbTx }) {
    return this.exec(tx).workflowDefinition.findFirst({ where: { key, status: WorkflowStatus.Active }, include: { states: true, transitions: true } });
  }

  /** Inquiries pinned per workflow version (defId → count). */
  async pinnedCounts({ tx }: { tx?: DbTx } = {}): Promise<Map<string, number>> {
    const rows = await this.exec(tx).inquiry.groupBy({ by: ['workflowVersionId'], _count: { _all: true } });
    return new Map(rows.map((r) => [r.workflowVersionId, r._count._all]));
  }

  /**
   * Transactionally activate `id` and archive the currently-active version(s) of the
   * same key. Reuses a threaded `tx` when the caller already opened one, else opens
   * its own — the two writes always commit or roll back together.
   */
  publish({ id, key, tx }: { id: string; key: string; tx?: DbTx }): Promise<void> {
    const run = async (db: DbTx) => {
      await db.workflowDefinition.updateMany({
        where: { key, status: WorkflowStatus.Active, id: { not: id } },
        data: { status: WorkflowStatus.Archived },
      });
      await db.workflowDefinition.update({ where: { id }, data: { status: WorkflowStatus.Active } });
    };
    return tx ? run(tx) : this.db.$transaction(run);
  }
}
