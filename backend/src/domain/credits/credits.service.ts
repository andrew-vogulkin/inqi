import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditTargetType, EventType } from '@inqi/shared';
import { OutboxService } from '../../infra/events/outbox.service';
import { AuditService } from '../../infra/observability/audit.service';
import { ConfigService } from '../../infra/config/config.service';
import { DbTx } from '../../infra/persistence/prisma.service';
import { DomainError, ErrorCode } from '../../common/errors';
import { CreditsRepository } from './credits.repository';
import { SettlementAction } from './credits.balance';

/**
 * Credits (HP-19): a customer's balance gates report runs. Submit **reserves** the
 * flat report cost; `REPORT_DELIVERED` **charges** it; a non-delivered terminal
 * **refunds** it. Admins top up manually. The repository owns transactional safety
 * (never negative, idempotent settlement); this service adds events + audit.
 */
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    private readonly repo: CreditsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** Flat credits one report run costs. */
  reportCost(): number { return this.config.reportCostCredits; }

  balance({ customerId, tx }: { customerId: string; tx?: DbTx }) { return this.repo.balance({ customerId, tx }); }
  history({ customerId }: { customerId: string }) { return this.repo.history({ customerId }); }

  /** Admin customer directory/search (HP-22). */
  searchCustomers({ q }: { q: string }) { return this.repo.searchCustomers({ q }); }

  /** HP-21: atomically claim the customer's one free report (true iff granted now). */
  claimFreeReport({ customerId, tx }: { customerId: string; tx?: DbTx }) { return this.repo.claimFreeReport({ customerId, tx }); }

  /** HP-21: charge 1 credit to unlock a freemium report (402 if short; idempotent). */
  chargeUnlock({ customerId, inquiryId, actor, tx }: { customerId: string; inquiryId: string; actor: string; tx?: DbTx }) {
    return this.repo.chargeUnlock({ customerId, inquiryId, actor, tx });
  }

  /** Admin manual top-up (admin-gated at the edge); audited. */
  async topUp({ customerId, amount, note, actor }: { customerId: string; amount: number; note?: string; actor: string }) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new DomainError({ code: ErrorCode.ValidationFailed, message: 'top-up amount must be a positive integer', details: { amount } });
    }
    const { balance } = await this.repo.topUp({ customerId, amount, note, actor });
    // Customer-scoped, so it isn't on the inquiry event stream (the outbox is
    // inquiry-keyed) — recorded in the audit log instead.
    await this.audit.record({ actor, action: AuditAction.Topup, targetType: AuditTargetType.Customer, targetId: customerId, reason: note, data: { amount, balance } });
    this.logger.log(`top-up ${amount} → customer ${customerId} (balance ${balance}) by ${actor}`);
    return { customerId, balance };
  }

  /**
   * Reserve the report cost for a new inquiry; throws 402 if the balance is short.
   * When the caller (inquiry submit) threads a `tx`, the decrement, ledger row and
   * the CreditsReserved event all join that transaction — so a later failure rolls
   * the whole submit back as one unit.
   */
  async reserve({ customerId, inquiryId, actor, tx }: { customerId: string; inquiryId: string; actor: string; tx?: DbTx }) {
    const cost = this.reportCost();
    if (cost === 0) return { balance: await this.repo.balance({ customerId, tx }), reserved: 0 };
    const { balance } = await this.repo.reserve({ customerId, inquiryId, cost, actor, tx });
    await this.outbox.emit({ type: EventType.CreditsReserved, inquiryId, data: { amount: cost, balance }, tx });
    return { balance, reserved: cost };
  }

  /**
   * Settle on a reached terminal state (idempotent, once per inquiry). Called from
   * the workflow engine after every transition; a no-op for non-settling states
   * and for inquiries that were never reserved (e.g. pre-HP-19 runs).
   */
  async settle({ inquiryId, action }: { inquiryId: string; action: SettlementAction }) {
    const res = await this.repo.settle({ inquiryId, action, reason: action });
    if (!res.settled) return res;
    await this.outbox.emit({
      type: action === 'charge' ? EventType.CreditsCharged : EventType.CreditsRefunded,
      inquiryId,
      data: { amount: res.amount },
    });
    this.logger.log(`${action} ${res.amount} credit(s) for inquiry ${inquiryId}`);
    return res;
  }
}
