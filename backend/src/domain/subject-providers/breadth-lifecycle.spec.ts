import { Logger } from '@nestjs/common';
import { BreadthEvent, LeadSource } from '@inqi/shared';
import { decideBreadthCheckpoint, fallbackCandidates, mineCandidates, qualifyCandidates } from './breadth-lifecycle';

const logger = new Logger('test');
const SUBJECT = { title: 'rooftop yoga studio', description: 'in Bangkok' };
const POOL = [
  { title: 'Sky Yoga BKK', url: 'https://sky.example', content: 'rooftop yoga classes' },
  { title: 'Bangkok directory', url: 'https://dir.example', content: 'fitness listings' },
];

const aiReturning = (raw: unknown) => ({
  isConfigured: () => true,
  structured: jest.fn().mockImplementation(async ({ validate }: { validate: (r: unknown) => unknown }) => validate(raw)),
});

describe('mineCandidates — relevance-gated proposal over the search pool', () => {
  it('keeps evidence to urls that really came back and drops excluded names', async () => {
    const ai = aiReturning({
      candidates: [
        { name: 'Sky Yoga', country: 'TH', evidence: ['https://sky.example', 'https://invented.example'] },
        { name: 'Already Known', country: 'TH', evidence: ['https://sky.example'] },
      ],
    });
    const out = await mineCandidates({ ai: ai as never, subject: SUBJECT, count: 5, exclude: ['Already Known'], pool: POOL, matchNote: null, logger });
    expect(out.map((c) => c.name)).toEqual(['Sky Yoga']);
    expect(out[0].evidence).toEqual([{ url: 'https://sky.example', title: 'Sky Yoga BKK', snippet: 'rooftop yoga classes' }]);
    expect(out[0].source).toBe(LeadSource.Ai);
  });

  it('EVIDENCE FLOOR: with a non-empty pool, ungrounded candidates (no evidence, no website) are dropped', async () => {
    const ai = aiReturning({
      candidates: [
        { name: 'Grounded', country: 'TH', evidence: ['https://sky.example'] },
        { name: 'Hallucinated', country: 'TH', evidence: [] },
        { name: 'Has Website', country: 'TH', evidence: [], website: 'https://site.example' },
      ],
    });
    const out = await mineCandidates({ ai: ai as never, subject: SUBJECT, count: 5, exclude: [], pool: POOL, matchNote: null, logger });
    expect(out.map((c) => c.name)).toEqual(['Grounded', 'Has Website']);
  });

  it('with an EMPTY pool (search down) AI-only proposals are still allowed (degradation)', async () => {
    const ai = aiReturning({ candidates: [{ name: 'Proposal', country: 'TH', evidence: [] }] });
    const out = await mineCandidates({ ai: ai as never, subject: SUBJECT, count: 5, exclude: [], pool: [], matchNote: null, logger });
    expect(out.map((c) => c.name)).toEqual(['Proposal']);
  });
});

describe('qualifyCandidates — cheap look-alike filter, fail-open', () => {
  const CANDIDATES = [
    { name: 'Real Studio', country: 'TH', evidence: [{ url: 'u', title: 'yoga', snippet: 'classes' }] },
    { name: 'Just A Bar', country: 'TH', evidence: [{ url: 'v', title: 'bar', snippet: 'cocktails' }] },
  ];

  it('keeps only names the filter qualifies', async () => {
    const ai = aiReturning({ qualified: ['Real Studio'] });
    const out = await qualifyCandidates({ ai: ai as never, subject: SUBJECT, candidates: CANDIDATES as never, logger });
    expect(out.map((c) => c.name)).toEqual(['Real Studio']);
  });

  it('an over-eager filter (keeps nothing) must not empty the funnel', async () => {
    const ai = aiReturning({ qualified: [] });
    const out = await qualifyCandidates({ ai: ai as never, subject: SUBJECT, candidates: CANDIDATES as never, logger });
    expect(out).toHaveLength(2);
  });

  it('a filter failure fails open', async () => {
    const ai = { isConfigured: () => true, structured: jest.fn().mockRejectedValue(new Error('down')) };
    const out = await qualifyCandidates({ ai: ai as never, subject: SUBJECT, candidates: CANDIDATES as never, logger });
    expect(out).toHaveLength(2);
  });
});

describe('decideBreadthCheckpoint — the adaptive loop decision, pure', () => {
  it.each([
    // foundCount, target, gained, dryRounds, cycle, maxCycles → event
    [8, 8, 3, 0, 1, 50, BreadthEvent.TARGET_MET],
    [9, 8, 1, 0, 2, 50, BreadthEvent.TARGET_MET],
    [2, 8, 0, 1, 3, 50, BreadthEvent.WENT_DRY],      // second consecutive dry round
    [2, 8, 0, 0, 3, 3, BreadthEvent.CAP_REACHED],     // first dry round, but the cap hit
    [2, 8, 2, 1, 3, 50, BreadthEvent.CONTINUE],       // productive round resets dryness
    [2, 8, 2, 0, 3, 3, BreadthEvent.CAP_REACHED],     // productive but cap hit
  ])('found %i/%i gained %i dry %i cycle %i/%i → %s', (foundCount, targetCount, gained, dryRounds, cycle, maxCycles, expected) => {
    expect(decideBreadthCheckpoint({ foundCount, targetCount, gained, dryRounds, cycle, maxCycles }).event).toBe(expected);
  });

  it('tracks dry rounds: a zero-gain round increments, a productive one resets', () => {
    expect(decideBreadthCheckpoint({ foundCount: 1, targetCount: 8, gained: 0, dryRounds: 0, cycle: 1, maxCycles: 50 }).dryRounds).toBe(1);
    expect(decideBreadthCheckpoint({ foundCount: 3, targetCount: 8, gained: 2, dryRounds: 1, cycle: 2, maxCycles: 50 }).dryRounds).toBe(0);
  });
});

describe('fallbackCandidates — deterministic no-AI degradation', () => {
  it('produces the requested count, skipping excluded names', () => {
    const out = fallbackCandidates({ count: 3, exclude: ['Subject Provider 2'] });
    expect(out.map((c) => c.name)).toEqual(['Subject Provider 1', 'Subject Provider 3', 'Subject Provider 4']);
    expect(out.every((c) => c.source === LeadSource.Fallback)).toBe(true);
  });
});
