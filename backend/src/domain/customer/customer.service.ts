import { Injectable } from '@nestjs/common';
import { AccountStatus, AuditAction, AuditTargetType, AuthRole } from '@inqi/shared';
import { DbTx } from '../../infra/persistence/prisma.service';
import { ErrorCode, ForbiddenError, NotFoundError } from '../../common/errors';
import { AuditService } from '../../infra/observability/audit.service';
import { CustomerRepository, UserRow } from './customer.repository';

/** One row of the admin user directory (HP-25) — dates serialized, status derived. */
export interface AdminUserView {
  id: string;
  email: string;
  name: string | null;
  role: AuthRole;
  registeredAt: string;
  status: AccountStatus;
  suspendedAt: string | null;
  credits: number;
  reportCount: number;
}

const DEFAULT_PAGE = 25;
const MAX_PAGE = 50;

/** The Customer aggregate: authenticated identities linked by verified email. */
@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository, private readonly audit: AuditService) {}

  upsertByEmail(args: { email: string; googleSub?: string; name?: string; tx?: DbTx }) {
    return this.customers.upsertByEmail(args);
  }

  /** Look up WITHOUT creating (email intake asks "do you exist?" before enrolling anyone). */
  findByEmail({ email, tx }: { email: string; tx?: DbTx }) {
    return this.customers.findByEmail({ email, tx });
  }

  findById({ id, tx }: { id: string; tx?: DbTx }) {
    return this.customers.findById({ id, tx });
  }

  /** HP-25: is this account currently suspended? (used by the auth path for immediate lockout). */
  isSuspended({ id, tx }: { id: string; tx?: DbTx }): Promise<boolean> {
    return this.customers.isSuspended({ id, tx });
  }

  /**
   * HP-25: admin user directory — one alphabetical (by email) page with report
   * counts, keyset-paginated. `nextCursor` is the last row's email; null = last page.
   */
  async listUsers({ q, status, limit, cursor }: { q?: string; status?: AccountStatus; limit?: number; cursor?: string }): Promise<{ rows: AdminUserView[]; nextCursor: string | null }> {
    const take = Math.min(Math.max(limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
    const fetched = await this.customers.searchUsers({ q, status, take, cursorEmail: cursor });
    const hasMore = fetched.length > take;
    const page = hasMore ? fetched.slice(0, take) : fetched;
    const counts = await this.customers.reportCountsFor({ users: page.map((u) => ({ id: u.id, email: u.email })) });
    return {
      rows: page.map((u) => this.toView(u, counts[u.id] ?? 0)),
      nextCursor: hasMore ? page[page.length - 1].email : null,
    };
  }

  /**
   * HP-25: suspend a customer account (admin action; audited). Guardrails —
   * an admin can neither suspend themselves nor another admin (no self-lockout,
   * no admin-vs-admin fights). Idempotent: re-suspending is a no-op that returns
   * the current row without re-stamping.
   */
  async suspend({ id, reason, actorId, actorEmail }: { id: string; reason?: string; actorId: string; actorEmail: string }): Promise<AdminUserView> {
    if (id === actorId) throw new ForbiddenError({ code: ErrorCode.AuthForbidden, message: 'you cannot suspend your own account' });
    const target = await this.customers.findById({ id });
    if (!target) throw new NotFoundError({ code: ErrorCode.CustomerNotFound, message: 'customer not found' });
    if (target.role === AuthRole.Admin) throw new ForbiddenError({ code: ErrorCode.AuthForbidden, message: 'admin accounts cannot be suspended' });
    if (target.suspendedAt) return this.toView(target, await this.countFor(target)); // already suspended — idempotent
    const row = await this.customers.setSuspension({ id, suspendedAt: new Date(), reason: reason ?? null, byId: actorId });
    await this.audit.record({ actor: actorEmail, action: AuditAction.SuspendUser, targetType: AuditTargetType.Customer, targetId: id, reason, data: { email: row.email } });
    return this.toView(row, await this.countFor(row));
  }

  /** HP-25: lift a suspension (admin action; audited). Idempotent for already-active accounts. */
  async reactivate({ id, actorEmail }: { id: string; actorEmail: string }): Promise<AdminUserView> {
    const target = await this.customers.findById({ id });
    if (!target) throw new NotFoundError({ code: ErrorCode.CustomerNotFound, message: 'customer not found' });
    if (!target.suspendedAt) return this.toView(target, await this.countFor(target)); // already active — idempotent
    const row = await this.customers.setSuspension({ id, suspendedAt: null, reason: null, byId: null });
    await this.audit.record({ actor: actorEmail, action: AuditAction.ReactivateUser, targetType: AuditTargetType.Customer, targetId: id, data: { email: row.email } });
    return this.toView(row, await this.countFor(row));
  }

  private countFor(u: { id: string; email: string }): Promise<number> {
    return this.customers.reportCountsFor({ users: [{ id: u.id, email: u.email }] }).then((m) => m[u.id] ?? 0);
  }

  private toView(u: UserRow, reportCount: number): AdminUserView {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role as AuthRole,
      registeredAt: u.createdAt.toISOString(),
      status: u.suspendedAt ? AccountStatus.Suspended : AccountStatus.Active,
      suspendedAt: u.suspendedAt ? u.suspendedAt.toISOString() : null,
      credits: u.credits,
      reportCount,
    };
  }
}
