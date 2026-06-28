import { CreditKind, InquiryState } from '@inqi/shared';

/** Minimal ledger row shape for balance derivation. */
export interface LedgerLike { kind: string; amount: number }

/**
 * Pure: derive a balance from append-only ledger entries.
 * Balance = Σ(topup) − Σ(reserve) + Σ(refund). A `charge` finalizes an existing
 * reservation and has **no** balance effect (the credits were already held at reserve).
 * The maintained `Customer.credits` column must always equal this.
 */
export function deriveBalance(entries: LedgerLike[]): number {
  return entries.reduce((sum, e) => {
    if (e.kind === CreditKind.Topup || e.kind === CreditKind.Refund) return sum + e.amount;
    if (e.kind === CreditKind.Reserve) return sum - e.amount;
    return sum; // charge → 0
  }, 0);
}

export type SettlementAction = 'charge' | 'refund';

/**
 * Pure: which settlement a reached state triggers, or null for non-settling states.
 * `REPORT_DELIVERED` → charge (finalize the hold); the non-delivered terminals
 * (`DENIED`/`DROPPED`/`FAILED`/`CANCELLED`) → refund (return the hold).
 */
export function settlementActionForState(state: string): SettlementAction | null {
  if (state === InquiryState.REPORT_DELIVERED) return 'charge';
  if (
    state === InquiryState.DENIED ||
    state === InquiryState.DROPPED ||
    state === InquiryState.FAILED ||
    state === InquiryState.CANCELLED
  ) return 'refund';
  return null;
}
