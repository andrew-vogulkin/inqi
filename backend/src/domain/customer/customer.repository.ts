import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for the Customer aggregate (authenticated identities). */
@Injectable()
export class CustomerRepository {
  constructor(private readonly db: PrismaService) {}

  /** Create or update a customer keyed by verified email (idempotent sign-in). */
  upsertByEmail({ email, googleSub, name, role }: { email: string; googleSub?: string; name?: string; role: string }) {
    const update: Prisma.CustomerUncheckedUpdateInput = { role };
    if (googleSub) update.googleSub = googleSub;
    if (name) update.name = name;
    return this.db.customer.upsert({
      where: { email },
      create: { email, googleSub, name, role },
      update,
    });
  }

  findById({ id }: { id: string }) {
    return this.db.customer.findUnique({ where: { id } });
  }
}
