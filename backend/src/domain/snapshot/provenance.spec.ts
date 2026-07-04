import { FindingKind, ProvenanceDepth, OutreachOutcome } from '@inqi/shared';
import { SnapshotsService } from './snapshots.service';

function svcWith({ inquiryStatus, sources = true }: { inquiryStatus: string; sources?: boolean }) {
  const repo = {
    findFindings: jest.fn().mockResolvedValue([
      { kind: FindingKind.SubjectProviderBackground, inquiryId: 's1', data: { qualityScore: 0.8, rating: 4.6, sentiment: 0.7, themes: ['fast shipping'], quotes: ['great service'], sources: sources ? [{ source: 'TrustSite', url: 'http://x/y', snippet: 'highly rated' }] : [] } },
      { kind: FindingKind.Option, inquiryId: 's1', data: { subjectProvider: 'Acme', price: 100 } },
      { kind: FindingKind.Option, inquiryId: 's2', data: { subjectProvider: 'Other', price: 200 } },
    ]),
    findInquiryById: jest.fn().mockResolvedValue({ id: 's1', status: inquiryStatus, background: {}, qualityScore: 0.8 }),
    // persona lives on the report now (one voice per report); provenance reads it from here
    findReport: jest.fn().mockResolvedValue({ id: 'i1', personaId: 'persona_ams', rawRequest: 'anything' }),
    findMessages: jest.fn().mockResolvedValue([
      { direction: 'outbound', body: 'Hello, price and availability?', createdAt: new Date('2026-07-02T16:00:00Z') },
      { direction: 'inbound', body: 'Sure — 100 EUR, in stock.', createdAt: new Date('2026-07-02T16:05:00Z') },
    ]),
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
    // The conversation as it happened — direction + body + timestamp.
    expect(dto.outreach.chain).toEqual([
      { direction: 'outbound', body: 'Hello, price and availability?', at: '2026-07-02T16:00:00.000Z' },
      { direction: 'inbound', body: 'Sure — 100 EUR, in stock.', at: '2026-07-02T16:05:00.000Z' },
    ]);
    expect(dto.depth).toBe(ProvenanceDepth.WebOutreachFeedback);
    // Relay addresses / message ids stay internal (findMessages never selects them).
    const blob = JSON.stringify(dto);
    expect(blob).not.toContain('@reply.inqi');
  });

  it('derives outcome + depth from outreach state (not_contacted → WebFeedback)', async () => {
    const dto = await svcWith({ inquiryStatus: 'pending' }).provenance({ reportId: 'i1', ref: 'Acme' });
    expect(dto.outreach.outcome).toBe(OutreachOutcome.NotContacted);
    expect(dto.depth).toBe(ProvenanceDepth.WebFeedback); // has feedback, no outreach
  });

  it('404s for an unknown option ref', async () => {
    await expect(svcWith({ inquiryStatus: 'replied' }).provenance({ reportId: 'i1', ref: 'Nope' })).rejects.toThrow();
  });
});
