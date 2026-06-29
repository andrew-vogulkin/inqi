import { CreditKind } from '@inqi/shared';
import { StatusTone } from './enums';
import { CreditEntry } from '../api/types';

/**
 * Ledger presentation (FE-09). The canonical kinds are the shared `CreditKind`
 * (topup / reserve / charge / refund) — re-imported, never re-stringified.
 */
export const LEDGER_LABEL: Record<string, string> = {
  [CreditKind.Topup]: 'Top-up',
  [CreditKind.Reserve]: 'Reserved',
  [CreditKind.Charge]: 'Charged',
  [CreditKind.Refund]: 'Refunded',
};

/** Credit (in) = brand; debit/hold (out) = muted ink; charge (settled) = subtle. */
export function ledgerTone(kind: string): StatusTone {
  if (kind === CreditKind.Topup || kind === CreditKind.Refund) return StatusTone.Brand;
  if (kind === CreditKind.Reserve) return StatusTone.Muted;
  return StatusTone.Subtle; // charge — no balance effect
}

/** Signed prefix for the amount: +in, −out, · (charge has no balance effect). */
export function ledgerSign(kind: string): string {
  if (kind === CreditKind.Topup || kind === CreditKind.Refund) return '+';
  if (kind === CreditKind.Reserve) return '−';
  return '·';
}

/** Newest-first by createdAt (defensive — the API already returns desc). */
export function sortedLedger(entries: CreditEntry[]): CreditEntry[] {
  return [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Compact relative time (pure: `now` is passed in). */
export function relativeTime({ iso, now }: { iso: string; now: number }): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
