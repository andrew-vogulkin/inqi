import { ComplianceCategory, ComplianceFailMode, ComplianceKind, ModelTier, ReviewStatus } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { AiProvider } from '../../infra/ai/ai.tokens';
import { ComplianceService } from './compliance.service';

function make(ai: Partial<AiProvider>, failMode: ComplianceFailMode): ComplianceService {
  const config = { complianceFailMode: failMode, complianceBorderline: { low: 0.4, high: 0.7 } } as unknown as ConfigService;
  return new ComplianceService(ai as AiProvider, config);
}

const email = (text: string) => ({ kind: ComplianceKind.Email, text });

describe('ComplianceService', () => {
  it('passes when the model allows (clearly safe → no escalation)', async () => {
    const ai = { isConfigured: () => true, structured: jest.fn().mockResolvedValue({ allowed: true, riskScore: 0.1, categories: [], reason: 'ok' }) };
    const r = await make(ai, ComplianceFailMode.Open).score(email('a used road bike'));
    expect(r.status).toBe(ReviewStatus.Passed);
    expect(r.score).toBe(0.1);
    expect(ai.structured).toHaveBeenCalledTimes(1);
  });

  it('blocks when the model disallows, carrying categories', async () => {
    const ai = { isConfigured: () => true, structured: jest.fn().mockResolvedValue({ allowed: false, riskScore: 0.95, categories: ['weapons'], reason: 'illegal' }) };
    const r = await make(ai, ComplianceFailMode.Open).score(email('an unregistered firearm'));
    expect(r.status).toBe(ReviewStatus.Blocked);
    expect(r.categories).toContain(ComplianceCategory.Weapons);
  });

  it('escalates a borderline BALANCED verdict to DEPTH and returns the DEPTH verdict', async () => {
    const structured = jest.fn()
      .mockResolvedValueOnce({ allowed: true, riskScore: 0.5, categories: [], reason: 'unsure' })   // BALANCED, borderline
      .mockResolvedValueOnce({ allowed: false, riskScore: 0.82, categories: ['fraud'], reason: 'scam' }); // DEPTH
    const ai = { isConfigured: () => true, structured };
    const r = await make(ai, ComplianceFailMode.Open).score(email('too-good-to-be-true offer'));
    expect(structured).toHaveBeenCalledTimes(2);
    expect(structured.mock.calls[1][0].tier).toBe(ModelTier.Depth);
    expect(r.status).toBe(ReviewStatus.Blocked);
    expect(r.categories).toContain(ComplianceCategory.Fraud);
  });

  it('fail-open: records unscored (without calling the model) when AI is unconfigured', async () => {
    const ai = { isConfigured: () => false, structured: jest.fn() };
    const r = await make(ai, ComplianceFailMode.Open).score(email('x'));
    expect(r.status).toBe(ReviewStatus.Unscored);
    expect(ai.structured).not.toHaveBeenCalled();
  });

  it('fail-closed: blocks when AI is unconfigured', async () => {
    const ai = { isConfigured: () => false, structured: jest.fn() };
    const r = await make(ai, ComplianceFailMode.Closed).score(email('x'));
    expect(r.status).toBe(ReviewStatus.Blocked);
  });

  it('fail-open: records unscored on scorer error', async () => {
    const ai = { isConfigured: () => true, structured: jest.fn().mockRejectedValue(new Error('boom')) };
    const r = await make(ai, ComplianceFailMode.Open).score(email('x'));
    expect(r.status).toBe(ReviewStatus.Unscored);
  });

  it('fail-closed: blocks on scorer error', async () => {
    const ai = { isConfigured: () => true, structured: jest.fn().mockRejectedValue(new Error('boom')) };
    const r = await make(ai, ComplianceFailMode.Closed).score(email('x'));
    expect(r.status).toBe(ReviewStatus.Blocked);
  });
});
