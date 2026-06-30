import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthRole } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for the Customer aggregate (authenticated identities). */
@Injectable()
export class CustomerRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  /**
   * Create or update a customer keyed by verified email (idempotent sign-in).
   * A new account is created as a plain `customer`; **`role` is deliberately never
   * part of the update** — it's owned by the DB so a hand-set admin survives every
   * subsequent sign-in. To promote someone, set their role directly in the database.
   */
  upsertByEmail({ email, googleSub, name, tx }: { email: string; googleSub?: string; name?: string; tx?: DbTx }) {
    const update: Prisma.CustomerUncheckedUpdateInput = {};
    if (googleSub) update.googleSub = googleSub;
    if (name) update.name = name;
    return this.exec(tx).customer.upsert({
      where: { email },
      create: { email, googleSub, name, role: AuthRole.Customer },
      update,
    });
  }

  findById({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).customer.findUnique({ where: { id } });
  }
}
