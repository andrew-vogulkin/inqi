import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditTargetType, EventType } from '@inqi/shared';
import { OutboxService } from '../../infra/events/outbox.service';
import { AuditService } from '../../infra/observability/audit.service';
import { ConfigService } from '../../infra/config/config.service';
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

  balance({ customerId }: { customerId: string }) { return this.repo.balance({ customerId }); }
  history({ customerId }: { customerId: string }) { return this.repo.history({ customerId }); }

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

  /** Reserve the report cost for a new inquiry; throws 402 if the balance is short. */
  async reserve({ customerId, inquiryId, actor }: { customerId: string; inquiryId: string; actor: string }) {
    const cost = this.reportCost();
    if (cost === 0) return { balance: await this.repo.balance({ customerId }), reserved: 0 };
    const { balance } = await this.repo.reserve({ customerId, inquiryId, cost, actor });
    await this.outbox.emit({ type: EventType.CreditsReserved, inquiryId, data: { amount: cost, balance } });
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
