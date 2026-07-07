import { evaluateCase, scoreRun, RunOutcome } from './scorer';
import { RehearsalCase } from './rehearsal-case';

const mk = (id: string, expectations: RehearsalCase['expectations']): RehearsalCase => ({ id, rawRequest: 'q', note: 'n', expectations });
const delivered = (names: string[], extra: Partial<RunOutcome> = {}): RunOutcome => ({ state: 'REPORT_DELIVERED', options: names.map((name) => ({ name })), ...extra });

describe('evaluateCase', () => {
  it('mustQualify: substring, case-insensitive match passes; a miss is a false negative', () => {
    const pass = evaluateCase({ rehearsalCase: mk('hc', { mustQualify: ['Hillcreek Gardens'] }), outcome: delivered(['Hillcreek Gardens Tagaytay', 'Cliffhouse']) });
    expect(pass.passed).toBe(true);
    expect(pass.metrics.falseNegatives).toBe(0);

    const fail = evaluateCase({ rehearsalCase: mk('hc', { mustQualify: ['Hillcreek Gardens'] }), outcome: delivered(['Cliffhouse', 'Trabiesa']) });
    expect(fail.passed).toBe(false);
    expect(fail.metrics.falseNegatives).toBe(1);
    expect(fail.checks.find((c) => c.label.includes('Hillcreek'))?.ok).toBe(false);
  });

  it('mustDrop: a forbidden provider present fails as a false positive', () => {
    const r = evaluateCase({ rehearsalCase: mk('nf', { mustDrop: ['Ghost Venue'] }), outcome: delivered(['Ghost Venue LLC']) });
    expect(r.passed).toBe(false);
    expect(r.metrics.falsePositives).toBe(1);
  });

  it('mustFailGracefully: passes only on FAILED with zero options', () => {
    expect(evaluateCase({ rehearsalCase: mk('p', { mustFailGracefully: true }), outcome: { state: 'FAILED', options: [] } }).passed).toBe(true);
    expect(evaluateCase({ rehearsalCase: mk('p', { mustFailGracefully: true }), outcome: delivered(['Invented Dealer']) }).passed).toBe(false); // fabricated
    expect(evaluateCase({ rehearsalCase: mk('p', { mustFailGracefully: true }), outcome: { state: 'REPORT_DELIVERED', options: [] } }).passed).toBe(false);
  });

  it('mustDeny: passes only on DENIED with zero options', () => {
    expect(evaluateCase({ rehearsalCase: mk('c', { mustDeny: true }), outcome: { state: 'DENIED', options: [] } }).passed).toBe(true);
    expect(evaluateCase({ rehearsalCase: mk('c', { mustDeny: true }), outcome: { state: 'FAILED', options: [] } }).passed).toBe(false); // wrong terminal
    expect(evaluateCase({ rehearsalCase: mk('c', { mustDeny: true }), outcome: delivered(['Some Vendor']) }).passed).toBe(false);
  });

  it('min/maxOptions bounds', () => {
    expect(evaluateCase({ rehearsalCase: mk('m', { minOptions: 1 }), outcome: delivered(['A']) }).passed).toBe(true);
    expect(evaluateCase({ rehearsalCase: mk('m', { minOptions: 1 }), outcome: delivered([]) }).passed).toBe(false);
    expect(evaluateCase({ rehearsalCase: mk('m', { maxOptions: 2 }), outcome: delivered(['A', 'B', 'C']) }).passed).toBe(false);
  });
});

describe('scoreRun', () => {
  it('aggregates pass/fail counts and sums metrics', () => {
    const results = [
      evaluateCase({ rehearsalCase: mk('a', { minOptions: 1 }), outcome: delivered(['A'], { tokens: 100, wallMs: 500, costUsd: 0.1 }) }),
      evaluateCase({ rehearsalCase: mk('b', { mustQualify: ['X'] }), outcome: delivered(['Y'], { tokens: 50, wallMs: 200 }) }),
    ];
    const card = scoreRun(results);
    expect(card).toMatchObject({ passed: 1, failed: 1, total: 2 });
    expect(card.totals.falseNegatives).toBe(1);
    expect(card.totals.tokens).toBe(150);
    expect(card.totals.wallMs).toBe(700);
    expect(card.totals.costUsd).toBeCloseTo(0.1);
  });
});
