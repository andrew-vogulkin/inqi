import { describe, it, expect } from 'vitest';
import { CreditKind } from '@inqi/shared';
import { StatusTone } from './enums';
import { ledgerTone, ledgerSign, ledgerIcon, sortedLedger, relativeTime } from './credits';
import { CreditEntry } from '../api/types';

describe('ledger presentation', () => {
  it('tones credit/refund as brand, reserve muted, charge subtle', () => {
    expect(ledgerTone(CreditKind.Topup)).toBe(StatusTone.Brand);
    expect(ledgerTone(CreditKind.Refund)).toBe(StatusTone.Brand);
    expect(ledgerTone(CreditKind.Reserve)).toBe(StatusTone.Muted);
    expect(ledgerTone(CreditKind.Charge)).toBe(StatusTone.Subtle);
  });
  it('signs +in, −out, · for charge', () => {
    expect(ledgerSign(CreditKind.Topup)).toBe('+');
    expect(ledgerSign(CreditKind.Refund)).toBe('+');
    expect(ledgerSign(CreditKind.Reserve)).toBe('−');
    expect(ledgerSign(CreditKind.Charge)).toBe('·');
  });
  it('gives each kind a distinct glyph', () => {
    const icons = [CreditKind.Topup, CreditKind.Refund, CreditKind.Reserve, CreditKind.Charge].map(ledgerIcon);
    expect(new Set(icons).size).toBe(4);
  });
});

describe('sortedLedger', () => {
  it('orders newest-first by createdAt', () => {
    const e = (id: string, createdAt: string): CreditEntry => ({ id, kind: CreditKind.Topup, amount: 1, createdAt });
    const out = sortedLedger([e('a', '2026-01-01T00:00:00Z'), e('c', '2026-03-01T00:00:00Z'), e('b', '2026-02-01T00:00:00Z')]);
    expect(out.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-06-29T12:00:00Z').getTime();
  it('renders compact units', () => {
    expect(relativeTime({ iso: '2026-06-29T11:59:40Z', now })).toBe('just now');
    expect(relativeTime({ iso: '2026-06-29T11:30:00Z', now })).toBe('30m ago');
    expect(relativeTime({ iso: '2026-06-29T09:00:00Z', now })).toBe('3h ago');
    expect(relativeTime({ iso: '2026-06-27T12:00:00Z', now })).toBe('2d ago');
  });
});
