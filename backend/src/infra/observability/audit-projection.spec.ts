import { AuditEntryType } from '@inqi/shared';
import { AuditEntry, filterEntries, project, sortByAtDesc } from './audit-projection';

describe('audit projection mappers', () => {
  it('maps a denial', () => {
    const e = project.denial({ id: 'i1', denyReason: 'weapons', updatedAt: new Date('2026-06-01T00:00:00Z') });
    expect(e.type).toBe(AuditEntryType.Denial);
    expect(e.reason).toBe('weapons');
    expect(e.inquiryId).toBe('i1');
  });
  it('maps a compliance-blocked message with risk data', () => {
    const e = project.complianceMessage({ reviewStatus: 'blocked', riskScore: 0.9, riskTags: ['weapons'], createdAt: new Date('2026-06-01T00:00:00Z'), inquiryId: 'i1' });
    expect(e.type).toBe(AuditEntryType.ComplianceBlock);
    expect(e.data).toMatchObject({ riskScore: 0.9, riskTags: ['weapons'] });
  });
  it('maps an agent run with attribution', () => {
    const e = project.agentRun({ inquiryId: 'i1', stage: 'outreach_subtask', status: 'done', error: null, startedAt: new Date('2026-06-01T00:00:00Z') });
    expect(e.type).toBe(AuditEntryType.AgentAction);
    expect(e.actor).toBe('outreach_subtask');
  });
  it('maps a transition', () => {
    const e = project.transition({ inquiryId: 'i1', createdAt: new Date('2026-06-01T00:00:00Z'), data: { from: 'A', to: 'B', event: 'go' } });
    expect(e.type).toBe(AuditEntryType.Transition);
    expect(e.data).toMatchObject({ from: 'A', to: 'B' });
  });
  it('maps an operator action; inquiry-scoped target sets inquiryId', () => {
    const e = project.operator({ actor: 'ops@x.com', action: 'cancel', targetType: 'inquiry', targetId: 'i1', reason: 'withdrew', createdAt: new Date('2026-06-01T00:00:00Z'), data: {} });
    expect(e.type).toBe(AuditEntryType.OperatorAction);
    expect(e.inquiryId).toBe('i1');
    expect(e.actor).toBe('ops@x.com');
  });
});

describe('filterEntries + sortByAtDesc', () => {
  const E = (type: AuditEntryType, at: string): AuditEntry => ({ type, at, actor: 'x' });
  const entries = [
    E(AuditEntryType.Denial, '2026-06-01T00:00:00Z'),
    E(AuditEntryType.AgentAction, '2026-06-03T00:00:00Z'),
    E(AuditEntryType.OperatorAction, '2026-06-02T00:00:00Z'),
  ];
  it('filters by type', () => {
    expect(filterEntries({ entries, types: [AuditEntryType.Denial] })).toHaveLength(1);
  });
  it('filters by time range', () => {
    expect(filterEntries({ entries, from: '2026-06-02T00:00:00Z' })).toHaveLength(2);
    expect(filterEntries({ entries, to: '2026-06-01T23:59:59Z' })).toHaveLength(1);
  });
  it('sorts newest first', () => {
    expect(sortByAtDesc(entries).map((e) => e.at)[0]).toBe('2026-06-03T00:00:00Z');
  });
});
