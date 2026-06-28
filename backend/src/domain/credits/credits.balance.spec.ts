import { CreditKind, InquiryState } from '@inqi/shared';
import { deriveBalance, settlementActionForState } from './credits.balance';

const e = (kind: string, amount: number) => ({ kind, amount });

describe('deriveBalance', () => {
  it('topup adds, reserve subtracts, refund adds, charge is neutral', () => {
    expect(deriveBalance([e(CreditKind.Topup, 5)])).toBe(5);
    expect(deriveBalance([e(CreditKind.Topup, 5), e(CreditKind.Reserve, 1)])).toBe(4);
    // reserve then refund (denied) → back to full
    expect(deriveBalance([e(CreditKind.Topup, 5), e(CreditKind.Reserve, 1), e(CreditKind.Refund, 1)])).toBe(5);
    // reserve then charge (delivered) → stays spent (charge has no effect)
    expect(deriveBalance([e(CreditKind.Topup, 5), e(CreditKind.Reserve, 1), e(CreditKind.Charge, 1)])).toBe(4);
  });

  it('a full lifecycle: topup 3, run+deliver, run+deny', () => {
    const ledger = [
      e(CreditKind.Topup, 3),
      e(CreditKind.Reserve, 1), e(CreditKind.Charge, 1),   // inquiry A delivered → -1
      e(CreditKind.Reserve, 1), e(CreditKind.Refund, 1),   // inquiry B denied → net 0
    ];
    expect(deriveBalance(ledger)).toBe(2);
  });

  it('empty ledger is zero', () => {
    expect(deriveBalance([])).toBe(0);
  });
});

describe('settlementActionForState', () => {
  it('charges on delivery', () => {
    expect(settlementActionForState(InquiryState.REPORT_DELIVERED)).toBe('charge');
  });
  it('refunds on every non-delivered terminal', () => {
    for (const s of [InquiryState.DENIED, InquiryState.DROPPED, InquiryState.FAILED, InquiryState.CANCELLED]) {
      expect(settlementActionForState(s)).toBe('refund');
    }
  });
  it('does nothing for processing / non-terminal states', () => {
    for (const s of [InquiryState.RECEIVED, InquiryState.OUTREACH, InquiryState.ON_HOLD, InquiryState.REPORT_GENERATION]) {
      expect(settlementActionForState(s)).toBeNull();
    }
  });
});
