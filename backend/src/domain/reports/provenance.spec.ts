import { FindingKind, ProvenanceDepth, OutreachOutcome } from '@inqi/shared';
import { ReportsService } from './reports.service';

function svcWith({ subtaskStatus, sources = true }: { subtaskStatus: string; sources?: boolean }) {
  const repo = {
    findFindings: jest.fn().mockResolvedValue([
      { kind: FindingKind.SubjectProviderBackground, subtaskId: 's1', data: { qualityScore: 0.8, rating: 4.6, sentiment: 0.7, themes: ['fast shipping'], quotes: ['great service'], sources: sources ? [{ source: 'TrustSite', url: 'http://x/y', snippet: 'highly rated' }] : [] } },
      { kind: FindingKind.Option, subtaskId: 's1', data: { subjectProvider: 'Acme', price: 100 } },
      { kind: FindingKind.Option, subtaskId: 's2', data: { subjectProvider: 'Other', price: 200 } },
    ]),
    findSubtaskById: jest.fn().mockResolvedValue({ id: 's1', status: subtaskStatus, personaId: 'persona_ams', replyAddress: 'secret@reply.inqi.io', background: {}, qualityScore: 0.8 }),
  };
  return new ReportsService({} as never, repo as never, {} as never, {} as never, {} as never, {} as never);
}

describe('ReportsService.provenance (HP-20)', () => {
  it('returns a redacted provenance DTO with NO email chain / addresses', async () => {
    const dto = await svcWith({ subtaskStatus: 'replied' }).provenance({ inquiryId: 'i1', ref: 'Acme' });
    expect(dto.web[0]).toMatchObject({ source: 'TrustSite', url: 'http://x/y' });
    expect(dto.feedback).toMatchObject({ rating: 4.6, themes: ['fast shipping'], quotes: ['great service'] });
    expect(dto.scoring).toMatchObject({ rank: 1, feedbackScore: 0.8 });
    expect(dto.outreach).toMatchObject({ persona: 'persona_ams', route: 'via inqi', outcome: OutreachOutcome.Replied });
    expect(dto.depth).toBe(ProvenanceDepth.WebOutreachFeedback);
    // Redaction guarantee: the raw reply address / chain never appears in the payload.
    const blob = JSON.stringify(dto);
    expect(blob).not.toContain('secret@reply.inqi.io');
    expect(blob).not.toContain('@reply.inqi.io');
  });

  it('derives outcome + depth from outreach state (not_contacted → WebFeedback)', async () => {
    const dto = await svcWith({ subtaskStatus: 'pending' }).provenance({ inquiryId: 'i1', ref: 'Acme' });
    expect(dto.outreach.outcome).toBe(OutreachOutcome.NotContacted);
    expect(dto.depth).toBe(ProvenanceDepth.WebFeedback); // has feedback, no outreach
  });

  it('404s for an unknown option ref', async () => {
    await expect(svcWith({ subtaskStatus: 'replied' }).provenance({ inquiryId: 'i1', ref: 'Nope' })).rejects.toThrow();
  });
});
