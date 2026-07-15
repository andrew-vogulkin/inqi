import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountStatus, AuditActor, AuthRole, CreditKind } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** The fields the admin user directory selects for one row (HP-25). */
const USER_ROW_SELECT = {
  id: true, email: true, name: true, role: true, createdAt: true, credits: true, suspendedAt: true,
} satisfies Prisma.CustomerSelect;

/** A raw customer row for the admin directory (report count is joined separately). */
export type UserRow = Prisma.CustomerGetPayload<{ select: typeof USER_ROW_SELECT }>;

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
  upsertByEmail({ email, googleSub, name, initialCredits = 0, tx }: { email: string; googleSub?: string; name?: string; initialCredits?: number; tx?: DbTx }) {
    const update: Prisma.CustomerUncheckedUpdateInput = {};
    if (googleSub) update.googleSub = googleSub;
    if (name) update.name = name;
    // Balance and its ledger are set together and ONLY on insert — the `create`
    // branch never runs for an existing account, so a returning user is never
    // re-granted. Skip the ledger row entirely when the grant is disabled (0).
    const grant = initialCredits > 0
      ? { credits: initialCredits, ledger: { create: { kind: CreditKind.Topup, amount: initialCredits, reason: 'Initial welcome credits', actor: AuditActor.System } } }
      : {};
    return this.exec(tx).customer.upsert({
      where: { email },
      create: { email, googleSub, name, role: AuthRole.Customer, ...grant },
      update,
    });
  }

  findById({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).customer.findUnique({ where: { id } });
  }

  /** Look up WITHOUT creating — email intake must be able to ask "do you exist?" without enrolling you. */
  findByEmail({ email, tx }: { email: string; tx?: DbTx }) {
    return this.exec(tx).customer.findUnique({ where: { email } });
  }

  // --- HP-25: admin user directory + suspension ---------------------------

  /**
   * Admin user directory: one page, **alphabetical by email** (the default order),
   * keyset-paginated on the unique email (cursor = the previous page's last email).
   * `q` matches email / name (case-insensitive contains); `status` narrows to
   * active (suspendedAt null) or suspended. Fetches take+1 — the extra row only
   * signals that a next page exists.
   */
  searchUsers({ q, status, take, cursorEmail, tx }: { q?: string; status?: AccountStatus; take: number; cursorEmail?: string; tx?: DbTx }): Promise<UserRow[]> {
    const and: Prisma.CustomerWhereInput[] = [];
    if (q && q.trim()) {
      const term = q.trim();
      and.push({ OR: [{ email: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }] });
    }
    if (status === AccountStatus.Active) and.push({ suspendedAt: null });
    else if (status === AccountStatus.Suspended) and.push({ suspendedAt: { not: null } });
    return this.exec(tx).customer.findMany({
      where: and.length ? { AND: and } : {},
      select: USER_ROW_SELECT,
      orderBy: { email: 'asc' },
      take: take + 1,
      ...(cursorEmail ? { cursor: { email: cursorEmail }, skip: 1 } : {}),
    });
  }

  /**
   * Report counts for a set of customers, keyed by customer id. A report belongs to
   * a customer by FK **or** (pre-auth) by matching email, so each count unions both —
   * mirroring {@link ReportRepository.listForOwner}. Dev-scale page (≤50 rows) → one
   * bounded count per row.
   */
  async reportCountsFor({ users, tx }: { users: { id: string; email: string }[]; tx?: DbTx }): Promise<Record<string, number>> {
    const db = this.exec(tx);
    const entries = await Promise.all(
      users.map(async (u) => [u.id, await db.report.count({ where: { OR: [{ customerId: u.id }, { customerEmail: u.email }] } })] as const),
    );
    return Object.fromEntries(entries);
  }

  /** True iff the account is currently suspended (cheap select for the auth path). */
  async isSuspended({ id, tx }: { id: string; tx?: DbTx }): Promise<boolean> {
    const c = await this.exec(tx).customer.findUnique({ where: { id }, select: { suspendedAt: true } });
    return !!c?.suspendedAt;
  }

  /** Set (suspend) or clear (reactivate) the suspension, returning the fresh directory row. */
  setSuspension({ id, suspendedAt, reason, byId, tx }: { id: string; suspendedAt: Date | null; reason: string | null; byId: string | null; tx?: DbTx }): Promise<UserRow> {
    return this.exec(tx).customer.update({
      where: { id },
      data: { suspendedAt, suspendedReason: reason, suspendedById: byId },
      select: USER_ROW_SELECT,
    });
  }
}
