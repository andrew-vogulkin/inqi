import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Prisma client. The single datastore (Postgres only — no Redis). */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}

/**
 * A database executor: either the root {@link PrismaService} or an interactive
 * transaction client (`Prisma.TransactionClient`). Every repository method accepts
 * an optional executor so the **service layer can open a transaction once and
 * thread it down** — multiple repo writes then commit/rollback atomically. When no
 * executor is passed the method runs standalone on the root client (auto-committed).
 *
 * Repo convention: `private exec(tx?: DbTx): DbTx { return tx ?? this.db; }`, then
 * use `this.exec(tx).model…` instead of `this.db.model…`.
 */
export type DbTx = Prisma.TransactionClient;
