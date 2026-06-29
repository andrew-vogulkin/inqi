import { describe, it, expect } from 'vitest';
import { AuditEntryType } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { AuditFilter } from '../conventions/audit';
import { ActionType } from './actions';
import { auditReducer, initialAuditState } from './audit.reducer';
import { AuditEntryDto } from '../api/types';

describe('auditReducer', () => {
  it('selecting a chip updates the filter + enters Loading', () => {
    const s = auditReducer(initialAuditState, { type: ActionType.AuditFilterSelected, filter: AuditFilter.Operator });
    expect(s.filter).toBe(AuditFilter.Operator);
    expect(s.status).toBe(AsyncStatus.Loading);
  });

  it('loaded sorts entries newest-first and goes Ready', () => {
    const entries: AuditEntryDto[] = [
      { type: AuditEntryType.Denial, actor: 'a', at: '2026-06-29T08:00:00Z' },
      { type: AuditEntryType.Denial, actor: 'b', at: '2026-06-29T10:00:00Z' },
    ];
    const s = auditReducer(initialAuditState, { type: ActionType.AuditLoaded, entries });
    expect(s.status).toBe(AsyncStatus.Ready);
    expect(s.entries.map((e) => e.actor)).toEqual(['b', 'a']);
  });

  it('load failure records the error', () => {
    const s = auditReducer(initialAuditState, { type: ActionType.AuditLoadFailed, message: 'boom' });
    expect(s.status).toBe(AsyncStatus.Error);
    expect(s.error).toBe('boom');
  });
});
