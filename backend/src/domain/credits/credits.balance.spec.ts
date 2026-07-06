import { CreditKind, ReportState } from '@inqi/shared';
import { deriveBalance, settlementActionForState } from './credits.balance';

const e = (kind: string, amount: number, reportId?: string) => ({ kind, amount, reportId });

describe('deriveBalance (pay-on-delivery)', () => {
  it('topup adds, a delivery charge subtracts, unlock subtracts', () => {
    expect(deriveBalance([e(CreditKind.Topup, 5)])).toBe(5);
    // pay-on-delivery: the charge itself is the debit (no reserve ever existed)
    expect(deriveBalance([e(CreditKind.Topup, 5), e(CreditKind.Charge, 1, 'r1')])).toBe(4);
    expect(deriveBalance([e(CreditKind.Topup, 5), e(CreditKind.Unlock, 1, 'r1')])).toBe(4);
  });

  it('legacy reserve lifecycle still derives correctly', () => {
    // reserve holds; refund returns it
    expect(deriveBalance([e(CreditKind.Topup, 5), e(CreditKind.Reserve, 1, 'r1'), e(CreditKind.Refund, 1, 'r1')])).toBe(5);
    // reserve holds; the charge just finalizes it (no double-debit)
    expect(deriveBalance([e(CreditKind.Topup, 5), e(CreditKind.Reserve, 1, 'r1'), e(CreditKind.Charge, 1, 'r1')])).toBe(4);
  });

  it('a full lifecycle: topup 3, deliver A (charged), fail B (costs nothing), legacy C', () => {
    const ledger = [
      e(CreditKind.Topup, 3),
      e(CreditKind.Charge, 1, 'a'),                                // report A delivered → -1
      /* report B failed → no ledger rows at all */
      e(CreditKind.Reserve, 1, 'c'), e(CreditKind.Charge, 1, 'c'), // legacy report C → -1 (held at reserve)
    ];
    expect(deriveBalance(ledger)).toBe(1);
  });

  it('empty ledger is zero', () => {
    expect(deriveBalance([])).toBe(0);
  });
});

describe('settlementActionForState', () => {
  it('charges on delivery', () => {
    expect(settlementActionForState(ReportState.REPORT_DELIVERED)).toBe('charge');
  });
  it('refunds on every non-delivered terminal', () => {
    for (const s of [ReportState.DENIED, ReportState.DROPPED, ReportState.FAILED, ReportState.CANCELLED]) {
      expect(settlementActionForState(s)).toBe('refund');
    }
  });
  it('does nothing for processing / non-terminal states', () => {
    for (const s of [ReportState.RECEIVED, ReportState.OUTREACH, ReportState.ON_HOLD, ReportState.REPORT_GENERATION]) {
      expect(settlementActionForState(s)).toBeNull();
    }
  });
});
