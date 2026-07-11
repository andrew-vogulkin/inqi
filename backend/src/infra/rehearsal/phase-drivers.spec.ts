import { BreadthEvent, SearchFocus } from '@inqi/shared';
import { AiProvider } from '../ai/ai.tokens';
import { WebSearchProvider } from '../websearch/websearch.tokens';
import { BreadthDriver, DepthDriver, evaluateBreadthCase, evaluateDepthCase } from './phase-drivers';
import { RehearsalCase } from './rehearsal-case';

const kase = (over: Partial<RehearsalCase> = {}): RehearsalCase => ({
  id: 'plumber-lisbon', rawRequest: 'A reliable local plumber in Lisbon', geo: { label: 'Lisbon' },
  focus: SearchFocus.Quality, note: 't', expectations: { minOptions: 1 },
  breadth: { minCandidates: 2, mustSurface: ['CanalizaLisboa'] }, ...over,
});

const web = (hits: { title: string; url: string; content: string }[]): WebSearchProvider =>
  ({ webSearch: async () => hits } as unknown as WebSearchProvider);

/** AI stub keyed on the calling stage's system prompt (each lifecycle stage announces itself). */
const breadthAi = (names: string[]): AiProvider => ({
  isConfigured: () => true,
  structured: async ({ system, validate }: { system: string; validate: (r: unknown) => unknown }) => {
    if (/candidate qualifier/i.test(system)) return validate({ qualified: names }) as never;
    if (/form web-search queries|converted poorly/i.test(system)) return validate({ queries: ['plumbers lisbon', 'plumber bathroom renovation', 'canalizador lisboa'] }) as never;
    // discovery mining — candidates grounded in the pool url so the evidence floor keeps them
    return validate({ candidates: names.map((n) => ({ name: n, country: 'PT', evidence: ['https://a.pt'] })) }) as never;
  },
} as unknown as AiProvider);

describe('BreadthDriver', () => {
  it('runs the loop over the injected (recording) web provider and meets its target', async () => {
    // Both AI mining answers propose the two names; qualify keeps them → TARGET_MET at count 2.
    const driver = new BreadthDriver(breadthAi(['CanalizaLisboa', 'Lisboa Plumb Pro']));
    const out = await driver.run({ rehearsalCase: kase(), webSearch: web([{ title: 'x', url: 'https://a.pt', content: 'c' }]), count: 2 });
    expect(out.terminal).toBe(BreadthEvent.TARGET_MET);
    expect(out.candidates.map((c) => c.name)).toEqual(['CanalizaLisboa', 'Lisboa Plumb Pro']);
    const graded = evaluateBreadthCase({ rehearsalCase: kase(), outcome: out });
    expect(graded.passed).toBe(true);
  });

  it('honours the dryRoundsToStop gene (goes dry faster when patience is 1)', async () => {
    const dryAi = breadthAi([]); // mining proposes nothing → every round is dry
    const driver = new BreadthDriver(dryAi);
    const out = await driver.run({ rehearsalCase: kase(), webSearch: web([]), count: 3, tunables: { dryRoundsToStop: 1, maxCycles: 5 } });
    expect(out.terminal).toBe(BreadthEvent.WENT_DRY);
    expect(out.cycles).toBe(1);
  });
});

describe('DepthDriver', () => {
  const depthCase = kase({
    id: 'hillcreek-cloudflare',
    depth: { fixture: { provider: 'Hillcreek Gardens', regionHint: 'Tagaytay' }, minSources: 1 },
  });

  it('investigates the fixture with tools bound to the injected web provider', async () => {
    const ai = {
      isConfigured: () => true,
      structured: async ({ validate }: { validate: (r: unknown) => unknown }) => validate({ queries: ['hillcreek gardens reviews'] }),
      toolStructured: async ({ validate }: { validate: (r: unknown) => unknown }) =>
        validate({ sentiment: 'positive', themes: [], quotes: [], eligibility: 'eligible', redFlags: [], qualityScore: 0.8, sources: [{ source: 'web', url: 'https://x', snippet: 's' }] }),
    } as unknown as AiProvider;
    const driver = new DepthDriver(ai, () => ({ definitions: [], execute: async () => 'ok' }));
    const out = await driver.run({ rehearsalCase: depthCase, webSearch: web([{ title: 'h', url: 'https://h.ph', content: 'venue' }]) });
    expect(out.verdict?.qualityScore).toBe(0.8);
    expect(evaluateDepthCase({ rehearsalCase: depthCase, outcome: out }).passed).toBe(true);
  });

  it('a case without a depth fixture grades as failed (no verdict), never throws', async () => {
    const driver = new DepthDriver({} as AiProvider, () => ({ definitions: [], execute: async () => 'ok' }));
    const out = await driver.run({ rehearsalCase: kase(), webSearch: web([]) });
    expect(out.verdict).toBeNull();
    expect(evaluateDepthCase({ rehearsalCase: kase(), outcome: out }).passed).toBe(false);
  });
});
