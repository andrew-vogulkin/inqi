import { describe, it, expect } from 'vitest';
import { AuditEntryType, AuditAction, AgentStage, AgentRunStatus, ComplianceKind } from '@inqi/shared';
import { StatusTone } from './enums';
import { AuditFilter, typesParam, auditRowVM, sortEntries, auditDescription, humanToken } from './audit';
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
    const entry: AuditEntryDto = { type: AuditEntryType.OperatorAction, actor: 'ops@x.io', at: '2026-06-29T10:00:00Z', refs: { targetId: 'i1', targetType: 'report' }, data: { action: AuditAction.Topup } };
    const vm = auditRowVM({ entry });
    expect(vm.badge).toBe('Top-up');
    expect(vm.target).toBe('i1');
    expect(vm.tone).toBe(StatusTone.Brand);
    expect(vm.actor).toBe('ops@x.io');
  });
  it('a denial shows the bucket label + target from reportId', () => {
    const entry: AuditEntryDto = { type: AuditEntryType.Denial, actor: 'system', at: '2026-06-29T09:00:00Z', reportId: 'i9' };
    const vm = auditRowVM({ entry });
    expect(vm.badge).toBe('Denial');
    expect(vm.target).toBe('i9');
    expect(vm.tone).toBe(StatusTone.Danger);
  });
  it('machine actors are humanized; agent rows show the stage name', () => {
    const engine: AuditEntryDto = { type: AuditEntryType.Transition, actor: 'engine', at: '2026-06-29T09:00:00Z', reportId: 'i9' };
    expect(auditRowVM({ entry: engine }).actor).toBe('Workflow engine');
    const agent: AuditEntryDto = { type: AuditEntryType.AgentAction, actor: AgentStage.BuildFunnel, at: '2026-06-29T09:00:00Z', reportId: 'i9', data: { stage: AgentStage.BuildFunnel, status: AgentRunStatus.Done } };
    expect(auditRowVM({ entry: agent }).actor).toBe('Funnel build (breadth search)');
  });
});

describe('auditDescription — one human sentence per entry', () => {
  const at = '2026-06-29T09:00:00Z';
  it('denial carries the reason (or a stock line without one)', () => {
    expect(auditDescription({ entry: { type: AuditEntryType.Denial, actor: 'system', at, reason: 'weapons request' } })).toBe('Request denied — weapons request');
    expect(auditDescription({ entry: { type: AuditEntryType.Denial, actor: 'system', at } })).toBe('Request denied during pre-research vetting.');
  });
  it('compliance block names the surface, risk score and tags', () => {
    const entry: AuditEntryDto = { type: AuditEntryType.ComplianceBlock, actor: 'compliance', at, data: { surface: ComplianceKind.Email, riskScore: 0.82, riskTags: ['fraud', 'privacy'] } };
    expect(auditDescription({ entry })).toBe('Outbound email blocked before sending — risk 0.82 (fraud, privacy)');
  });
  it('agent action reads as "<stage> <outcome>" with the error appended on failure', () => {
    const ok: AuditEntryDto = { type: AuditEntryType.AgentAction, actor: AgentStage.GenerateReport, at, data: { stage: AgentStage.GenerateReport, status: AgentRunStatus.Done } };
    expect(auditDescription({ entry: ok })).toBe('Report synthesis completed');
    const bad: AuditEntryDto = { type: AuditEntryType.AgentAction, actor: AgentStage.BroadResearch, at, reason: 'search backend down', data: { stage: AgentStage.BroadResearch, status: AgentRunStatus.Failed } };
    expect(auditDescription({ entry: bad })).toBe('Broad research failed — search backend down');
  });
  it('transition reads as "From → To · on event"', () => {
    const entry: AuditEntryDto = { type: AuditEntryType.Transition, actor: 'engine', at, data: { from: 'BROAD_RESEARCH', to: 'FUNNEL', event: 'BROAD_RESEARCH_DONE' } };
    expect(auditDescription({ entry })).toBe('Broad research → Funnel · on broad research done');
  });
  it('operator sub-actions each get their own sentence', () => {
    expect(auditDescription({ entry: { type: AuditEntryType.OperatorAction, actor: 'ops@x.io', at, reason: 'duplicate', data: { action: AuditAction.Cancel, from: 'OUTREACH', to: 'CANCELLED' } } }))
      .toBe('Report cancelled (was outreach) — duplicate');
    expect(auditDescription({ entry: { type: AuditEntryType.OperatorAction, actor: 'ops@x.io', at, data: { action: AuditAction.Topup, amount: 5, balance: 7 } } }))
      .toBe('+5 credit(s) granted, balance now 7');
    expect(auditDescription({ entry: { type: AuditEntryType.OperatorAction, actor: 'ops@x.io', at, data: { action: AuditAction.PublishWorkflow, key: 'report', version: 3 } } }))
      .toBe('Workflow "report" v3 published — new reports pin to it');
    expect(auditDescription({ entry: { type: AuditEntryType.OperatorAction, actor: 'a@x.io', at, data: { action: AuditAction.UnlockReport } } }))
      .toBe('Freemium report unlocked for 1 credit — full options revealed');
  });
});

describe('humanToken', () => {
  it('turns SNAKE_STATES into words', () => {
    expect(humanToken('REPORT_GENERATION')).toBe('Report generation');
    expect(humanToken('QUESTIONNAIRE_FILLED', { cap: false })).toBe('questionnaire filled');
    expect(humanToken(undefined)).toBe('');
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
