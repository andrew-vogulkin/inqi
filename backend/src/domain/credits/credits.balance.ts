import { CreditKind, ReportState } from '@inqi/shared';

/** Minimal ledger row shape for balance derivation. */
export interface LedgerLike { kind: string; amount: number; reportId?: string | null }

/**
 * Pure: derive a balance from append-only ledger entries (pay-on-delivery).
 * Balance = Σ(topup) + Σ(refund) − Σ(reserve) − Σ(unlock) − Σ(delivery charge).
 * A charge backed by a reserve for the same report is a legacy finalization with
 * **no** balance effect (the credits were already held at reserve time); a charge
 * without one is the pay-on-delivery debit itself.
 * The maintained `Customer.credits` column must always equal this.
 */
export function deriveBalance(entries: LedgerLike[]): number {
  const reserved = new Set(entries.filter((e) => e.kind === CreditKind.Reserve && e.reportId).map((e) => e.reportId));
  return entries.reduce((sum, e) => {
    if (e.kind === CreditKind.Topup || e.kind === CreditKind.Refund) return sum + e.amount;
    if (e.kind === CreditKind.Reserve || e.kind === CreditKind.Unlock) return sum - e.amount;
    if (e.kind === CreditKind.Charge) return e.reportId && reserved.has(e.reportId) ? sum : sum - e.amount;
    return sum;
  }, 0);
}

export type SettlementAction = 'charge' | 'refund';

/**
 * Pure: which settlement a reached state triggers, or null for non-settling states.
 * `REPORT_DELIVERED` → charge (finalize the hold); the non-delivered terminals
 * (`DENIED`/`DROPPED`/`FAILED`/`CANCELLED`) → refund (return the hold).
 */
export function settlementActionForState(state: string): SettlementAction | null {
  if (state === ReportState.REPORT_DELIVERED) return 'charge';
  if (
    state === ReportState.DENIED ||
    state === ReportState.DROPPED ||
    state === ReportState.FAILED ||
    state === ReportState.CANCELLED
  ) return 'refund';
  return null;
}
