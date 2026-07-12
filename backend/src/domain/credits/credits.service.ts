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
 * Credits (HP-19, pay-on-delivery): a customer's balance gates report runs. Submit
 * only **checks** the balance covers the cost; the charge lands when the report
 * reaches `REPORT_DELIVERED` — any other outcome costs nothing. Admins top up
 * manually. The repository owns transactional safety (idempotent settlement);
 * this service adds events + audit.
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
  chargeUnlock({ customerId, reportId, actor, tx }: { customerId: string; reportId: string; actor: string; tx?: DbTx }) {
    return this.repo.chargeUnlock({ customerId, reportId, actor, tx });
  }

  /** Admin manual top-up (admin-gated at the edge); audited. */
  async topUp({ customerId, amount, note, actor }: { customerId: string; amount: number; note?: string; actor: string }) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new DomainError({ code: ErrorCode.ValidationFailed, message: 'top-up amount must be a positive integer', details: { amount } });
    }
    const { balance } = await this.repo.topUp({ customerId, amount, note, actor });
    // Customer-scoped, so it isn't on the report event stream (the outbox is
    // report-keyed) — recorded in the audit log instead.
    await this.audit.record({ actor, action: AuditAction.Topup, targetType: AuditTargetType.Customer, targetId: customerId, reason: note, data: { amount, balance } });
    this.logger.log(`top-up ${amount} → customer ${customerId} (balance ${balance}) by ${actor}`);
    return { customerId, balance };
  }

  /**
   * Settle on a reached terminal state (idempotent, once per report). Called from
   * the workflow engine after every transition. Pay-on-delivery: `charge` debits
   * the report cost when REPORT_DELIVERED is reached; `refund` only returns a
   * legacy (pre-pay-on-delivery) hold — everything else is a no-op.
   */
  async settle({ reportId, action }: { reportId: string; action: SettlementAction }) {
    const res = await this.repo.settle({ reportId, action, cost: this.reportCost(), reason: action });
    if (!res.settled) return res;
    await this.outbox.emit({
      type: action === 'charge' ? EventType.CreditsCharged : EventType.CreditsRefunded,
      reportId,
      // balance = the post-settlement truth. The FE sets it ABSOLUTELY — replayed
      // event histories must never compound `amount` as deltas on a snapshot that
      // already includes them (the dashboard's negative-balance drift).
      data: { amount: res.amount, balance: res.balance },
    });
    this.logger.log(`${action} ${res.amount} credit(s) for report ${reportId}`);
    return res;
  }
}
