import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditActor, CreditKind } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';
import { ErrorCode, NotFoundError, PaymentRequiredError } from '../../common/errors';
import { SettlementAction } from './credits.balance';

export interface SettleResult {
  settled: boolean;
  kind?: CreditKind;
  amount?: number;
  customerId?: string;
  /** The customer's balance AFTER this settlement — rides on the realtime event so
   *  the FE can set it absolutely (replayed events must not compound as deltas). */
  balance?: number;
}

/**
 * Transactional credit ledger access (HP-19). Every balance mutation appends a
 * ledger row **and** updates the maintained `Customer.credits` in the same DB
 * transaction. The balance can never go negative (conditional decrement) and
 * settlement is idempotent per report (guarded read + the (reportId,kind) unique).
 */
@Injectable()
export class CreditsRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  /**
   * Run `fn` inside the caller's transaction when one is threaded in, otherwise open
   * a fresh one. Prisma forbids nesting `$transaction`, so multi-statement methods
   * must reuse a passed-in `tx` rather than starting their own.
   */
  private inTx<T>(tx: DbTx | undefined, fn: (db: DbTx) => Promise<T>): Promise<T> {
    return tx ? fn(tx) : this.db.$transaction(fn);
  }

  async balance({ customerId, tx }: { customerId: string; tx?: DbTx }): Promise<number> {
    const c = await this.exec(tx).customer.findUnique({ where: { id: customerId }, select: { credits: true } });
    if (!c) throw new NotFoundError({ code: ErrorCode.CustomerNotFound, message: 'customer not found' });
    return c.credits;
  }

  history({ customerId, take = 100, tx }: { customerId: string; take?: number; tx?: DbTx }) {
    return this.exec(tx).creditLedger.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take });
  }

  /**
   * Admin customer directory/search (HP-22): match by name / email (case-insensitive
   * contains) or exact id. Empty query → []. Limited; no PII in logs.
   */
  async searchCustomers({ q, take = 20, tx }: { q: string; take?: number; tx?: DbTx }): Promise<{ id: string; name: string; email: string }[]> {
    const query = q.trim();
    if (!query) return [];
    const rows = await this.exec(tx).customer.findMany({
      where: {
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { id: query },
        ],
      },
      select: { id: true, name: true, email: true },
      take,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name ?? '', email: r.email }));
  }

  /**
   * HP-21: atomically claim the customer's one free report. Returns true iff this call
   * flipped `freeReportUsed` false→true (so concurrent submits can't both go free).
   */
  async claimFreeReport({ customerId, tx }: { customerId: string; tx?: DbTx }): Promise<boolean> {
    const res = await this.exec(tx).customer.updateMany({ where: { id: customerId, freeReportUsed: false }, data: { freeReportUsed: true } });
    return res.count === 1;
  }

  /**
   * HP-21: charge 1 credit to unlock a freemium report. Idempotent per report via the
   * (reportId, kind=unlock) unique — a second unlock is a no-op (no double-charge).
   * Conditional decrement keeps the balance non-negative; a short balance throws 402.
   */
  async chargeUnlock({ customerId, reportId, actor, amount = 1, tx: outer }: { customerId: string; reportId: string; actor: string; amount?: number; tx?: DbTx }): Promise<{ charged: boolean; balance: number }> {
    try {
      return await this.inTx(outer, async (tx) => {
        const prior = await tx.creditLedger.findUnique({ where: { reportId_kind: { reportId, kind: CreditKind.Unlock } } });
        if (prior) {
          const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { credits: true } });
          return { charged: false, balance: c.credits }; // already unlocked — idempotent
        }
        const dec = await tx.customer.updateMany({ where: { id: customerId, credits: { gte: amount } }, data: { credits: { decrement: amount } } });
        if (dec.count === 0) {
          const c = await tx.customer.findUnique({ where: { id: customerId }, select: { credits: true } });
          if (!c) throw new NotFoundError({ code: ErrorCode.CustomerNotFound, message: 'customer not found' });
          throw new PaymentRequiredError({ message: `insufficient credits: need ${amount}, have ${c.credits}`, details: { required: amount, balance: c.credits } });
        }
        await tx.creditLedger.create({ data: { customerId, kind: CreditKind.Unlock, amount, reportId, actor } });
        const after = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { credits: true } });
        return { charged: true, balance: after.credits };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const c = await this.db.customer.findUniqueOrThrow({ where: { id: customerId }, select: { credits: true } });
        return { charged: false, balance: c.credits }; // concurrent unlock won the unique
      }
      throw err;
    }
  }

  /** Admin top-up: grant credits + append a `topup`, transactionally. */
  async topUp({ customerId, amount, note, actor, tx: outer }: { customerId: string; amount: number; note?: string; actor: string; tx?: DbTx }): Promise<{ balance: number }> {
    return this.inTx(outer, async (tx) => {
      const c = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!c) throw new NotFoundError({ code: ErrorCode.CustomerNotFound, message: 'customer not found' });
      const updated = await tx.customer.update({ where: { id: customerId }, data: { credits: { increment: amount } }, select: { credits: true } });
      await tx.creditLedger.create({ data: { customerId, kind: CreditKind.Topup, amount, reason: note, actor } });
      return { balance: updated.credits };
    });
  }

  /**
   * Settle a report once on a reached terminal state (pay-on-delivery).
   *
   * `charge` on REPORT_DELIVERED debits the report cost now — no upfront hold
   * exists anymore. Free reports and unowned reports are skipped. If a legacy
   * reserve row is present (pre-pay-on-delivery run), the charge just finalizes
   * it with no balance change, exactly as before.
   *
   * `refund` only ever returns a legacy hold — with nothing reserved there is
   * nothing to give back, so non-delivered terminals cost nothing by construction.
   *
   * Idempotent: an existing charge/refund → no-op; a concurrent double-settle
   * hits the (reportId, kind) unique (P2002) and is treated as already-settled.
   */
  async settle({ reportId, action, cost, reason, tx: outer }: { reportId: string; action: SettlementAction; cost: number; reason?: string; tx?: DbTx }): Promise<SettleResult> {
    const kind = action === 'charge' ? CreditKind.Charge : CreditKind.Refund;
    try {
      return await this.inTx(outer, async (tx) => {
        const prior = await tx.creditLedger.findFirst({ where: { reportId, kind: { in: [CreditKind.Charge, CreditKind.Refund] } } });
        if (prior) return { settled: false };
        const reserve = await tx.creditLedger.findUnique({ where: { reportId_kind: { reportId, kind: CreditKind.Reserve } } });

        if (action === 'refund') {
          if (!reserve) return { settled: false }; // nothing was held — a non-delivered run costs nothing
          const c = await tx.customer.update({ where: { id: reserve.customerId }, data: { credits: { increment: reserve.amount } }, select: { credits: true } });
          await tx.creditLedger.create({ data: { customerId: reserve.customerId, kind, amount: reserve.amount, reportId, actor: AuditActor.System, reason } });
          return { settled: true, kind, amount: reserve.amount, customerId: reserve.customerId, balance: c.credits };
        }

        // A delivered report with ZERO options delivered no value — it is never charged.
        // (The summary still explains why; unresponsive providers replying later refresh
        // it, and the eventual charge... stays waived: this run already burned its shot.)
        const snapshot = await tx.reportSnapshot.findUnique({ where: { reportId }, select: { options: true } });
        const optionCount = Array.isArray(snapshot?.options) ? (snapshot.options as unknown[]).length : 0;
        if (optionCount === 0) {
          // Legacy hold on an empty report: give the credits back instead of finalizing.
          if (reserve) {
            const c = await tx.customer.update({ where: { id: reserve.customerId }, data: { credits: { increment: reserve.amount } }, select: { credits: true } });
            await tx.creditLedger.create({ data: { customerId: reserve.customerId, kind: CreditKind.Refund, amount: reserve.amount, reportId, actor: AuditActor.System, reason: 'empty report — not charged' } });
            return { settled: true, kind: CreditKind.Refund, amount: reserve.amount, customerId: reserve.customerId, balance: c.credits };
          }
          return { settled: false };
        }

        // charge — legacy hold: finalize it (credits already deducted at reserve time).
        if (reserve) {
          await tx.creditLedger.create({ data: { customerId: reserve.customerId, kind, amount: reserve.amount, reportId, actor: AuditActor.System, reason } });
          const c = await tx.customer.findUnique({ where: { id: reserve.customerId }, select: { credits: true } });
          return { settled: true, kind, amount: reserve.amount, customerId: reserve.customerId, balance: c?.credits };
        }

        // charge — pay-on-delivery: debit the cost now. Free/unowned reports cost nothing.
        if (cost <= 0) return { settled: false };
        const report = await tx.report.findUnique({ where: { id: reportId }, select: { customerId: true, freeReport: true } });
        if (!report?.customerId || report.freeReport) return { settled: false };
        // Unconditional decrement: the balance was verified at submit; if it was spent
        // in the meantime the delivered report is still owed for (may dip negative).
        const c = await tx.customer.update({ where: { id: report.customerId }, data: { credits: { decrement: cost } }, select: { credits: true } });
        await tx.creditLedger.create({ data: { customerId: report.customerId, kind, amount: cost, reportId, actor: AuditActor.System, reason } });
        return { settled: true, kind, amount: cost, customerId: report.customerId, balance: c.credits };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { settled: false };
      throw err;
    }
  }
}
