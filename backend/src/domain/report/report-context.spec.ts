import { InquiryStatus, MessageDirection, SourceType } from '@inqi/shared';
import { ContextInquiry, estTokens, packAgentContext } from './report-context';

const at = (offsetMin: number) => new Date(Date.UTC(2026, 0, 1, 0, offsetMin));

function inquiry(over: Partial<ContextInquiry> & { id: string; name: string }): ContextInquiry {
  return {
    status: InquiryStatus.Pending, qualityScore: null, result: undefined, createdAt: at(0),
    sources: [], messages: [],
    ...over,
  };
}

const REPORT = { rawRequest: 'Bangkok best bars', geoLabel: 'Bangkok', budgetMin: null, budgetMax: null, deadline: null };

describe('packAgentContext (100k agent context)', () => {
  it('always leads with the request header + subject + confirmed scope', () => {
    const ctx = packAgentContext({
      report: REPORT,
      subject: { title: 'Cocktail bars', description: 'top-rated bars in Bangkok' },
      questionnaire: { answers: { vibe: 'speakeasy' }, confirmed: true },
      inquiries: [],
    });
    expect(ctx.text).toContain('Bangkok best bars');
    expect(ctx.text).toContain('Cocktail bars');
    expect(ctx.text).toContain('speakeasy');
    expect(ctx.truncated).toBe(false);
  });

  it('orders inquiries: focus first, then qualified > replied > pending, then quality', () => {
    const ctx = packAgentContext({
      report: REPORT,
      inquiries: [
        inquiry({ id: 'a', name: 'Alpha', status: InquiryStatus.Pending }),
        inquiry({ id: 'b', name: 'Bravo', status: InquiryStatus.Qualified, qualityScore: 0.7 }),
        inquiry({ id: 'c', name: 'Charlie', status: InquiryStatus.Qualified, qualityScore: 0.9 }),
        inquiry({ id: 'd', name: 'Delta', status: InquiryStatus.Replied }),
      ],
      focusInquiryId: 'a',
    });
    const pos = (n: string) => ctx.text.indexOf(`## ${n}`);
    expect(pos('Alpha')).toBeLessThan(pos('Charlie')); // focus wins over status
    expect(pos('Charlie')).toBeLessThan(pos('Bravo')); // quality desc within qualified
    expect(pos('Bravo')).toBeLessThan(pos('Delta'));   // qualified before replied
  });

  it('round-robins details so one long thread cannot starve other inquiries', () => {
    const chatty = inquiry({
      id: 'a', name: 'Chatty', status: InquiryStatus.Qualified,
      messages: Array.from({ length: 30 }, (_, i) => ({ direction: MessageDirection.Inbound, body: `msg-${i} ${'x'.repeat(400)}`, createdAt: at(i) })),
    });
    const quiet = inquiry({
      id: 'b', name: 'Quiet', status: InquiryStatus.Replied,
      sources: [{ type: SourceType.RatingFeedback, title: 'TrustReviews', snippet: '4.5★ across 12 reviews', url: 'r1', createdAt: at(0) }],
    });
    // Budget fits the header + lines + a couple of rounds, not all 30 messages.
    const ctx = packAgentContext({ report: REPORT, inquiries: [chatty, quiet], budgetTokens: 1200 });
    expect(ctx.text).toContain('4.5★ across 12 reviews'); // quiet's round-1/2 detail made it in
    expect(ctx.truncated).toBe(true);                      // chatty's tail did not
  });

  it('never exceeds the token budget and reports truncation', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      inquiry({ id: `i${i}`, name: `Provider ${i}`, status: InquiryStatus.Qualified, result: { price: 100 + i, currency: 'THB' } }));
    const ctx = packAgentContext({ report: REPORT, inquiries: many, budgetTokens: 500 });
    expect(ctx.estTokens).toBeLessThanOrEqual(500);
    expect(ctx.truncated).toBe(true);
    expect(estTokens(ctx.text)).toBeLessThanOrEqual(500 + many.length); // sanity: accounting ≈ text size
  });

  it('truncates long message bodies with a marker', () => {
    const long = inquiry({
      id: 'a', name: 'Longwind', status: InquiryStatus.Replied,
      messages: [{ direction: MessageDirection.Inbound, body: 'y'.repeat(5000), createdAt: at(1) }],
    });
    const ctx = packAgentContext({ report: REPORT, inquiries: [long] });
    expect(ctx.text).toContain('…[truncated]');
    expect(ctx.text).not.toContain('y'.repeat(2000));
  });
});
