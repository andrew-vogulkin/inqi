import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreditKind } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ErrorCode, NotFoundError, PaymentRequiredError } from '../../common/errors';
import { SettlementAction } from './credits.balance';

export interface SettleResult {
  settled: boolean;
  kind?: CreditKind;
  amount?: number;
  customerId?: string;
}

/**
 * Transactional credit ledger access (HP-19). Every balance mutation appends a
 * ledger row **and** updates the maintained `Customer.credits` in the same DB
 * transaction. The balance can never go negative (conditional decrement) and
 * settlement is idempotent per inquiry (guarded read + the (inquiryId,kind) unique).
 */
@Injectable()
export class CreditsRepository {
  constructor(private readonly db: PrismaService) {}

  async balance({ customerId }: { customerId: string }): Promise<number> {
    const c = await this.db.customer.findUnique({ where: { id: customerId }, select: { credits: true } });
    if (!c) throw new NotFoundError({ code: ErrorCode.CustomerNotFound, message: 'customer not found' });
    return c.credits;
  }

  history({ customerId, take = 100 }: { customerId: string; take?: number }) {
    return this.db.creditLedger.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take });
  }

  /**
   * Admin customer directory/search (HP-22): match by name / email (case-insensitive
   * contains) or exact id. Empty query → []. Limited; no PII in logs.
   */
  async searchCustomers({ q, take = 20 }: { q: string; take?: number }): Promise<{ id: string; name: string; email: string }[]> {
    const query = q.trim();
    if (!query) return [];
    const rows = await this.db.customer.findMany({
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
  async claimFreeReport({ customerId }: { customerId: string }): Promise<boolean> {
    const res = await this.db.customer.updateMany({ where: { id: customerId, freeReportUsed: false }, data: { freeReportUsed: true } });
    return res.count === 1;
  }

  /**
   * HP-21: charge 1 credit to unlock a freemium report. Idempotent per inquiry via the
   * (inquiryId, kind=unlock) unique — a second unlock is a no-op (no double-charge).
   * Conditional decrement keeps the balance non-negative; a short balance throws 402.
   */
  async chargeUnlock({ customerId, inquiryId, actor, amount = 1 }: { customerId: string; inquiryId: string; actor: string; amount?: number }): Promise<{ charged: boolean; balance: number }> {
    try {
      return await this.db.$transaction(async (tx) => {
        const prior = await tx.creditLedger.findUnique({ where: { inquiryId_kind: { inquiryId, kind: CreditKind.Unlock } } });
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
        await tx.creditLedger.create({ data: { customerId, kind: CreditKind.Unlock, amount, inquiryId, actor } });
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
  async topUp({ customerId, amount, note, actor }: { customerId: string; amount: number; note?: string; actor: string }): Promise<{ balance: number }> {
    return this.db.$transaction(async (tx) => {
      const c = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!c) throw new NotFoundError({ code: ErrorCode.CustomerNotFound, message: 'customer not found' });
      const updated = await tx.customer.update({ where: { id: customerId }, data: { credits: { increment: amount } }, select: { credits: true } });
      await tx.creditLedger.create({ data: { customerId, kind: CreditKind.Topup, amount, reason: note, actor } });
      return { balance: updated.credits };
    });
  }

  /**
   * Hold the report cost on submit. The conditional decrement (`credits >= cost`)
   * is atomic, so concurrent submits can never overspend or drive the balance
   * negative; a lost race throws 402 (the inquiry is then rolled back at the call site).
   */
  async reserve({ customerId, inquiryId, cost, actor }: { customerId: string; inquiryId: string; cost: number; actor: string }): Promise<{ balance: number }> {
    return this.db.$transaction(async (tx) => {
      const dec = await tx.customer.updateMany({ where: { id: customerId, credits: { gte: cost } }, data: { credits: { decrement: cost } } });
      if (dec.count === 0) {
        const c = await tx.customer.findUnique({ where: { id: customerId }, select: { credits: true } });
        if (!c) throw new NotFoundError({ code: ErrorCode.CustomerNotFound, message: 'customer not found' });
        throw new PaymentRequiredError({ message: `insufficient credits: need ${cost}, have ${c.credits}`, details: { required: cost, balance: c.credits } });
      }
      await tx.creditLedger.create({ data: { customerId, kind: CreditKind.Reserve, amount: cost, inquiryId, actor } });
      const after = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { credits: true } });
      return { balance: after.credits };
    });
  }

  /**
   * Settle an inquiry's reservation once. `charge` finalizes (no balance change);
   * `refund` returns the held credits. Idempotent: no reservation → no-op; an
   * existing charge/refund → no-op; a concurrent double-settle hits the unique
   * index (P2002) and is treated as already-settled.
   */
  async settle({ inquiryId, action, reason }: { inquiryId: string; action: SettlementAction; reason?: string }): Promise<SettleResult> {
    const kind = action === 'charge' ? CreditKind.Charge : CreditKind.Refund;
    try {
      return await this.db.$transaction(async (tx) => {
        const reserve = await tx.creditLedger.findUnique({ where: { inquiryId_kind: { inquiryId, kind: CreditKind.Reserve } } });
        if (!reserve) return { settled: false };
        const prior = await tx.creditLedger.findFirst({ where: { inquiryId, kind: { in: [CreditKind.Charge, CreditKind.Refund] } } });
        if (prior) return { settled: false };
        if (action === 'refund') {
          await tx.customer.update({ where: { id: reserve.customerId }, data: { credits: { increment: reserve.amount } } });
        }
        await tx.creditLedger.create({ data: { customerId: reserve.customerId, kind, amount: reserve.amount, inquiryId, actor: 'system', reason } });
        return { settled: true, kind, amount: reserve.amount, customerId: reserve.customerId };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { settled: false };
      throw err;
    }
  }
}
