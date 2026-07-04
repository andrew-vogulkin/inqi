import { Logger } from '@nestjs/common';
import { SearchFocus } from '@inqi/shared';
import { AiProvider } from '../../infra/ai/ai.tokens';
import { WebSearchProvider } from '../../infra/websearch/websearch.tokens';
import { DepthResearchResult } from './background.prompt';
import { DEPTH_MAX_LEADS, evaluateDepthVerdict, formDepthQueries, searchDepthLeads } from './depth-lifecycle';

const logger = new Logger('depth-lifecycle.spec');
jest.spyOn(logger, 'log').mockImplementation(() => undefined);
jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

const subject = { title: 'rooftop yoga class', description: 'rooftop yoga in Bangkok' };
const VERDICT: DepthResearchResult = {
  rating: 4.7, reviewsCount: 120, sentiment: 0.8, themes: [], quotes: [],
  eligibility: 'eligible', redFlags: [], price: 450, currency: 'THB', qualityScore: 0.8, sources: [],
};

describe('formDepthQueries (step B)', () => {
  it('returns the model-formed queries', async () => {
    const ai = { structured: jest.fn(async () => ({ queries: ['Makara Yoga reviews', 'Makara Yoga price per class'] })) } as unknown as AiProvider;
    const q = await formDepthQueries({ ai, name: 'Makara Yoga', regionHint: 'TH', subject, matchNote: null, logger });
    expect(q).toEqual(['Makara Yoga reviews', 'Makara Yoga price per class']);
  });

  it('falls back to the naive "name + region" query when the model fails', async () => {
    const ai = { structured: jest.fn(async () => { throw new Error('model down'); }) } as unknown as AiProvider;
    const q = await formDepthQueries({ ai, name: 'Makara Yoga', regionHint: 'TH', subject, matchNote: null, logger });
    expect(q).toEqual(['Makara Yoga TH']);
  });

  it('passes the unconfirmed constraint through to the prompt (fallback-discovery finds)', async () => {
    const ai = { structured: jest.fn(async () => ({ queries: ['q'] })) } as unknown as AiProvider;
    await formDepthQueries({ ai, name: 'Makara Yoga', regionHint: null, subject, matchNote: 'found without "rooftop"', logger });
    const { user } = (ai.structured as jest.Mock).mock.calls[0][0];
    expect(user).toContain('unconfirmedConstraint');
    expect(user).toContain('rooftop');
  });

  it('the customer focus biases the query-formation prompt (price ↔ quality)', async () => {
    const ai = { structured: jest.fn(async () => ({ queries: ['q'] })) } as unknown as AiProvider;
    await formDepthQueries({ ai, name: 'X', regionHint: null, subject, matchNote: null, focus: SearchFocus.Price, logger });
    expect((ai.structured as jest.Mock).mock.calls[0][0].system).toContain('CUSTOMER FOCUS: PRICE');
    await formDepthQueries({ ai, name: 'X', regionHint: null, subject, matchNote: null, focus: SearchFocus.Quality, logger });
    expect((ai.structured as jest.Mock).mock.calls[1][0].system).toContain('CUSTOMER FOCUS: QUALITY');
    await formDepthQueries({ ai, name: 'X', regionHint: null, subject, matchNote: null, logger });
    expect((ai.structured as jest.Mock).mock.calls[2][0].system).not.toContain('CUSTOMER FOCUS');
  });
});

describe('searchDepthLeads (step C)', () => {
  it('runs EVERY query, merges + dedupes hits by url', async () => {
    const web = {
      webSearch: jest.fn(async ({ query }: { query: string }) =>
        query === 'a'
          ? [{ title: 'Site', url: 'https://x.example/1', content: 'official' }]
          : [{ title: 'Site again', url: 'https://x.example/1', content: 'dupe' }, { title: 'Reviews', url: 'https://x.example/2', content: 'stars' }]),
    } as unknown as WebSearchProvider;
    const leads = await searchDepthLeads({ web, name: 'X', queries: ['a', 'b'], logger });
    expect((web.webSearch as jest.Mock).mock.calls.map((c) => c[0].query)).toEqual(['a', 'b']);
    expect(leads.map((l) => l.url)).toEqual(['https://x.example/1', 'https://x.example/2']);
  });

  it('caps the pool and tolerates a failing query (best-effort)', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, url: `https://x.example/${i}`, content: 'c' }));
    const web = {
      webSearch: jest.fn(async ({ query }: { query: string }) => {
        if (query === 'boom') throw new Error('searx down');
        return many;
      }),
    } as unknown as WebSearchProvider;
    const leads = await searchDepthLeads({ web, name: 'X', queries: ['boom', 'ok'], logger });
    expect(leads).toHaveLength(DEPTH_MAX_LEADS);
  });
});

describe('evaluateDepthVerdict (step E, the evaluation gate)', () => {
  it('returns the gate verdict with its named gaps', async () => {
    const ai = { structured: jest.fn(async () => ({ sufficient: false, gaps: ['price not evidenced — open the booking page'] })) } as unknown as AiProvider;
    const gate = await evaluateDepthVerdict({ ai, name: 'X', subject, matchNote: null, verdict: VERDICT, logger });
    expect(gate).toEqual({ sufficient: false, gaps: ['price not evidenced — open the booking page'] });
  });

  it('a broken auditor fails SUFFICIENT — never burns refine cycles', async () => {
    const ai = { structured: jest.fn(async () => { throw new Error('gate down'); }) } as unknown as AiProvider;
    const gate = await evaluateDepthVerdict({ ai, name: 'X', subject, matchNote: null, verdict: VERDICT, logger });
    expect(gate).toEqual({ sufficient: true, gaps: [] });
  });

  it('a price-focused audit is stricter on the price criterion (prompt carries the focus)', async () => {
    const ai = { structured: jest.fn(async () => ({ sufficient: true, gaps: [] })) } as unknown as AiProvider;
    await evaluateDepthVerdict({ ai, name: 'X', subject, matchNote: null, verdict: VERDICT, focus: SearchFocus.Price, logger });
    expect((ai.structured as jest.Mock).mock.calls[0][0].system).toContain('CUSTOMER FOCUS: PRICE');
  });
});
