import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for the Customer aggregate (authenticated identities). */
@Injectable()
export class CustomerRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  /** Create or update a customer keyed by verified email (idempotent sign-in). */
  upsertByEmail({ email, googleSub, name, role, tx }: { email: string; googleSub?: string; name?: string; role: string; tx?: DbTx }) {
    const update: Prisma.CustomerUncheckedUpdateInput = { role };
    if (googleSub) update.googleSub = googleSub;
    if (name) update.name = name;
    return this.exec(tx).customer.upsert({
      where: { email },
      create: { email, googleSub, name, role },
      update,
    });
  }

  findById({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).customer.findUnique({ where: { id } });
  }
}
