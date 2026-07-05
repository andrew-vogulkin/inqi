import { FindingKind, ProvenanceDepth, OutreachOutcome } from '@inqi/shared';
import { SnapshotsService } from './snapshots.service';

interface MockMessage { direction: string; subject?: string | null; body: string; createdAt: Date }

const THREAD: MockMessage[] = [
  { direction: 'outbound', subject: 'Inquiry: widgets', body: 'Hello, price and availability?', createdAt: new Date('2026-07-02T16:00:00Z') },
  { direction: 'inbound', subject: 'Re: Inquiry: widgets', body: 'Sure — 100 EUR, in stock.', createdAt: new Date('2026-07-02T16:05:00Z') },
];

function svcWith({ inquiryStatus, sources = true, messages = THREAD }: { inquiryStatus: string; sources?: boolean; messages?: MockMessage[] }) {
  const repo = {
    findFindings: jest.fn().mockResolvedValue([
      { kind: FindingKind.SubjectProviderBackground, inquiryId: 's1', data: { qualityScore: 0.8, rating: 4.6, sentiment: 0.7, themes: ['fast shipping'], quotes: ['great service'], sources: sources ? [{ source: 'TrustSite', url: 'http://x/y', snippet: 'highly rated' }] : [] } },
      { kind: FindingKind.Option, inquiryId: 's1', data: { subjectProvider: 'Acme', price: 100 } },
      { kind: FindingKind.Option, inquiryId: 's2', data: { subjectProvider: 'Other', price: 200 } },
    ]),
    findInquiryById: jest.fn().mockResolvedValue({ id: 's1', status: inquiryStatus, background: {}, qualityScore: 0.8 }),
    // persona lives on the report now (one voice per report); provenance reads it from here
    findReport: jest.fn().mockResolvedValue({ id: 'i1', personaId: 'persona_ams', rawRequest: 'anything' }),
    findMessages: jest.fn().mockResolvedValue(messages),
  };
  return new SnapshotsService({} as never, repo as never, {} as never, {} as never, {} as never, {} as never, {} as never);
}

describe('SnapshotsService.provenance (HP-20)', () => {
  it('returns the provenance DTO with the full email chain (no addresses/message ids)', async () => {
    const dto = await svcWith({ inquiryStatus: 'replied' }).provenance({ reportId: 'i1', ref: 'Acme' });
    expect(dto.web[0]).toMatchObject({ source: 'TrustSite', url: 'http://x/y' });
    expect(dto.feedback).toMatchObject({ rating: 4.6, themes: ['fast shipping'], quotes: ['great service'] });
    expect(dto.scoring).toMatchObject({ rank: 1, feedbackScore: 0.8 });
    expect(dto.outreach).toMatchObject({ persona: 'persona_ams', route: 'via inqi', outcome: OutreachOutcome.Replied });
    // The conversation as it happened — direction + subject + body + timestamp (+channel when multi-thread).
    expect(dto.outreach.chain).toEqual([
      { direction: 'outbound', subject: 'Inquiry: widgets', body: 'Hello, price and availability?', at: '2026-07-02T16:00:00.000Z', channel: null },
      { direction: 'inbound', subject: 'Re: Inquiry: widgets', body: 'Sure — 100 EUR, in stock.', at: '2026-07-02T16:05:00.000Z', channel: null },
    ]);
    expect(dto.depth).toBe(ProvenanceDepth.WebOutreachFeedback);
    // Relay addresses / message ids stay internal (findMessages never selects them).
    const blob = JSON.stringify(dto);
    expect(blob).not.toContain('@reply.inqi');
  });

  it('grounds outcome in the message trail: no emails → not_contacted, even when the inquiry qualified from research', async () => {
    const dto = await svcWith({ inquiryStatus: 'qualified', messages: [] }).provenance({ reportId: 'i1', ref: 'Acme' });
    expect(dto.outreach.outcome).toBe(OutreachOutcome.NotContacted);
    expect(dto.outreach.chain).toEqual([]);
    expect(dto.depth).toBe(ProvenanceDepth.WebFeedback); // has feedback, no outreach
  });

  it('outbound with no inbound → pending (we wrote, they have not)', async () => {
    const dto = await svcWith({ inquiryStatus: 'contacted', messages: [THREAD[0]] }).provenance({ reportId: 'i1', ref: 'Acme' });
    expect(dto.outreach.outcome).toBe(OutreachOutcome.Pending);
    expect(dto.depth).toBe(ProvenanceDepth.WebOutreachFeedback); // outreach happened — the thread is open
  });

  it('404s for an unknown option ref', async () => {
    await expect(svcWith({ inquiryStatus: 'replied' }).provenance({ reportId: 'i1', ref: 'Nope' })).rejects.toThrow();
  });
});

describe('summarizeProvenance cache — one DEPTH call per input fingerprint, not per view', () => {
  const SUMMARIES = { web: 'w', outreach: 'o', feedback: 'f', ranking: 'r' };

  function svcWithAi({ cached }: { cached?: { fingerprint: string; summaries?: typeof SUMMARIES } | null } = {}) {
    const ai = { isConfigured: () => true, structured: jest.fn().mockResolvedValue(SUMMARIES) };
    const repo = {
      findFindings: jest.fn().mockResolvedValue([
        { kind: FindingKind.SubjectProviderBackground, inquiryId: 's1', data: { qualityScore: 0.8 } },
        { kind: FindingKind.Option, inquiryId: 's1', epicId: 'e1', data: { subjectProvider: 'Acme', price: 100 } },
      ]),
      findInquiryById: jest.fn().mockResolvedValue({ id: 's1', status: 'replied', background: {}, qualityScore: 0.8 }),
      findReport: jest.fn().mockResolvedValue({ id: 'i1', personaId: 'p', rawRequest: 'anything' }),
      findMessages: jest.fn().mockResolvedValue(THREAD),
      findProvenanceSummary: jest.fn().mockResolvedValue(cached ? { id: 'f-cache', data: { ref: 'Acme', ...cached } } : null),
      saveProvenanceSummary: jest.fn().mockResolvedValue({}),
    };
    const svc = new SnapshotsService({} as never, repo as never, {} as never, ai as never, {} as never, {} as never, {} as never);
    return { svc, ai, repo };
  }

  it('cache miss: generates once and writes the summary + fingerprint through', async () => {
    const { svc, ai, repo } = svcWithAi();
    const dto = await svc.provenance({ reportId: 'i1', ref: 'Acme' });
    expect(dto.summaries).toEqual(SUMMARIES);
    expect(ai.structured).toHaveBeenCalledTimes(1);
    expect(repo.saveProvenanceSummary).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 'i1', epicId: 'e1', inquiryId: 's1',
      data: expect.objectContaining({ ref: 'Acme', summaries: SUMMARIES, fingerprint: expect.any(String) }),
    }));
  });

  it('cache hit (same fingerprint): serves the stored summaries with NO model call', async () => {
    // Capture the real fingerprint from a first run, then replay it as the stored one.
    const first = svcWithAi();
    await first.svc.provenance({ reportId: 'i1', ref: 'Acme' });
    const { fingerprint } = first.repo.saveProvenanceSummary.mock.calls[0][0].data as { fingerprint: string };

    const { svc, ai, repo } = svcWithAi({ cached: { fingerprint, summaries: SUMMARIES } });
    const dto = await svc.provenance({ reportId: 'i1', ref: 'Acme' });
    expect(dto.summaries).toEqual(SUMMARIES);
    expect(ai.structured).not.toHaveBeenCalled();
    expect(repo.saveProvenanceSummary).not.toHaveBeenCalled();
  });

  it('stale fingerprint (inputs changed): regenerates and updates the same finding row', async () => {
    const { svc, ai, repo } = svcWithAi({ cached: { fingerprint: 'outdated', summaries: { ...SUMMARIES, web: 'old' } } });
    const dto = await svc.provenance({ reportId: 'i1', ref: 'Acme' });
    expect(dto.summaries).toEqual(SUMMARIES);
    expect(ai.structured).toHaveBeenCalledTimes(1);
    expect(repo.saveProvenanceSummary).toHaveBeenCalledWith(expect.objectContaining({ id: 'f-cache' }));
  });
});
