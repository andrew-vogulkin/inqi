import { describe, it, expect } from 'vitest';
import { AuditEntryType, AuditAction } from '@inqi/shared';
import { StatusTone } from './enums';
import { AuditFilter, typesParam, auditRowVM, sortEntries } from './audit';
import { AuditEntryDto } from '../api/types';

describe('typesParam — chip → query', () => {
  it('All clears the filter (no param); each bucket maps to its AuditEntryType value', () => {
    expect(typesParam({ filter: AuditFilter.All })).toBeUndefined();
    expect(typesParam({ filter: AuditFilter.Operator })).toBe(AuditEntryType.OperatorAction);
    expect(typesParam({ filter: AuditFilter.Denial })).toBe(AuditEntryType.Denial);
    expect(typesParam({ filter: AuditFilter.Transition })).toBe(AuditEntryType.Transition);
  });
});

describe('auditRowVM — normalization', () => {
  it('an operator action shows its sub-action badge + target from refs', () => {
    const entry: AuditEntryDto = { type: AuditEntryType.OperatorAction, actor: 'ops@x.io', at: '2026-06-29T10:00:00Z', refs: { targetId: 'i1', targetType: 'inquiry' }, data: { action: AuditAction.Topup } };
    const vm = auditRowVM({ entry });
    expect(vm.badge).toBe('Top-up');
    expect(vm.target).toBe('i1');
    expect(vm.tone).toBe(StatusTone.Brand);
    expect(vm.actor).toBe('ops@x.io');
  });
  it('a denial shows the bucket label + target from inquiryId', () => {
    const entry: AuditEntryDto = { type: AuditEntryType.Denial, actor: 'system', at: '2026-06-29T09:00:00Z', inquiryId: 'i9' };
    const vm = auditRowVM({ entry });
    expect(vm.badge).toBe('Denial');
    expect(vm.target).toBe('i9');
    expect(vm.tone).toBe(StatusTone.Danger);
  });
});

describe('sortEntries — newest first', () => {
  it('orders by `at` descending', () => {
    const entries: AuditEntryDto[] = [
      { type: AuditEntryType.Denial, actor: 'a', at: '2026-06-29T08:00:00Z' },
      { type: AuditEntryType.Denial, actor: 'b', at: '2026-06-29T10:00:00Z' },
      { type: AuditEntryType.Denial, actor: 'c', at: '2026-06-29T09:00:00Z' },
    ];
    expect(sortEntries({ entries }).map((e) => e.actor)).toEqual(['b', 'c', 'a']);
  });
});
