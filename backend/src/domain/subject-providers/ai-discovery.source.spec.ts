import { ConfigService } from '../../infra/config/config.service';
import { AiProvider } from '../../infra/ai/ai.tokens';
import { WebSearchProvider } from '../../infra/websearch/websearch.tokens';
import { AiDiscoverySource } from './ai-discovery.source';

const unconfigured = { isConfigured: () => false } as unknown as AiProvider;
const noWeb = { webSearch: jest.fn(async () => []) } as unknown as WebSearchProvider;
const cfg = (breadthMaxCycles = 50) => ({ research: { breadthMaxCycles } }) as unknown as ConfigService;
const src = () => new AiDiscoverySource(unconfigured, noWeb, cfg());
const subject = { title: 'road bike', description: 'used road bike' };

describe('AiDiscoverySource (fallback)', () => {
  it('returns `count` distinct candidates when AI is unconfigured', async () => {
    const { candidates: r } = await src().discover({ subject, count: 5, exclude: [] });
    expect(r).toHaveLength(5);
    expect(new Set(r.map((c) => c.name)).size).toBe(5);
  });

  it('never proposes excluded names (widening)', async () => {
    const exclude = ['Subject Provider 1', 'Subject Provider 2'];
    const { candidates: r } = await src().discover({ subject, count: 3, exclude });
    expect(r).toHaveLength(3);
    expect(r.some((c) => exclude.includes(c.name))).toBe(false);
  });
});

describe('AiDiscoverySource (multi-query breadth search + relevance filter)', () => {
  const HITS = [
    { title: 'Best road bikes Lisbon', url: 'https://a.example/1', content: 'Bike Hub Lisboa tops the list' },
    { title: 'Directory', url: 'https://b.example/2', content: 'Velo Porto — used bikes' },
  ];
  const CANDIDATES = [
    { name: 'Bike Hub Lisboa', country: 'PT', evidence: ['https://a.example/1', 'https://INVENTED.example/x'], website: 'https://bikehub.example' },
    { name: 'Velo Porto', country: 'PT', evidence: ['https://b.example/2'] },
    { name: 'Rooftop Wine Bar', country: 'PT', evidence: [], website: 'https://rooftopwine.example' }, // keyword look-alike — the filter must drop it
  ];

  /** The structured mock dispatches on the system prompt: query-formation → filter → mining. */
  const makeAi = ({ qualified }: { qualified: string[] }) => ({
    isConfigured: () => true,
    structured: jest.fn(async ({ system }: { system: string }) => {
      if (system.includes('form web-search queries')) return { queries: ['road bike shop Lisbon', 'used road bikes Porto', 'bike store Portugal'] };
      if (system.includes('candidate qualifier')) return { qualified };
      return { candidates: CANDIDATES };
    }),
  }) as unknown as AiProvider;

  it('runs EVERY model-formed query, merges hits, and keeps only real evidence urls', async () => {
    const web = { webSearch: jest.fn(async () => HITS) } as unknown as WebSearchProvider;
    const { candidates: r } = await new AiDiscoverySource(makeAi({ qualified: ['Bike Hub Lisboa', 'Velo Porto', 'Rooftop Wine Bar'] }), web, cfg()).discover({ subject, count: 8, exclude: [] });
    expect((web.webSearch as jest.Mock).mock.calls.map((c) => c[0].query)).toEqual([
      'road bike shop Lisbon', 'used road bikes Porto', 'bike store Portugal',
    ]);
    expect(r[0].evidence).toEqual([{ url: 'https://a.example/1', title: 'Best road bikes Lisbon', snippet: 'Bike Hub Lisboa tops the list' }]);
    expect(r[1].evidence).toEqual([{ url: 'https://b.example/2', title: 'Directory', snippet: 'Velo Porto — used bikes' }]);
  });

  it('the qualification filter drops setting/keyword look-alikes', async () => {
    const web = { webSearch: jest.fn(async () => HITS) } as unknown as WebSearchProvider;
    const { candidates: r } = await new AiDiscoverySource(makeAi({ qualified: ['Bike Hub Lisboa', 'Velo Porto'] }), web, cfg()).discover({ subject, count: 8, exclude: [] });
    expect(r.map((c) => c.name)).toEqual(['Bike Hub Lisboa', 'Velo Porto']); // Rooftop Wine Bar filtered out
  });

  it('an over-eager filter never empties the funnel (fail-open to the proposed set)', async () => {
    const web = { webSearch: jest.fn(async () => HITS) } as unknown as WebSearchProvider;
    const { candidates: r } = await new AiDiscoverySource(makeAi({ qualified: [] }), web, cfg()).discover({ subject, count: 8, exclude: [] });
    expect(r).toHaveLength(3);
  });

  it('an unreachable search backend never blocks discovery (AI-only proposal)', async () => {
    const web = { webSearch: jest.fn(async () => { throw new Error('searx down'); }) } as unknown as WebSearchProvider;
    const { candidates: r } = await new AiDiscoverySource(makeAi({ qualified: ['Bike Hub Lisboa', 'Velo Porto', 'Rooftop Wine Bar'] }), web, cfg()).discover({ subject, count: 8, exclude: [] });
    expect(r).toHaveLength(3);
    expect(r[0].evidence).toEqual([]); // no search hits → no evidence survives the url filter
  });

  it('EVIDENCE FLOOR: when the pool had results, a candidate with no evidence AND no website is dropped', async () => {
    const ai = {
      isConfigured: () => true,
      structured: jest.fn(async ({ system }: { system: string }) => {
        if (system.includes('form web-search queries')) return { queries: ['q1'] };
        if (system.includes('candidate qualifier')) return { qualified: ['Grounded Shop', 'Phantom Provider'] };
        if (system.includes('converted poorly')) return {}; // parse fails → loop stops
        return { candidates: [
          { name: 'Grounded Shop', country: 'PT', evidence: ['https://a.example/1'] },
          { name: 'Phantom Provider', country: 'PT', evidence: [] }, // hallucinated — no page ever showed it
        ] };
      }),
    } as unknown as AiProvider;
    const web = { webSearch: jest.fn(async () => HITS) } as unknown as WebSearchProvider;
    const { candidates: r } = await new AiDiscoverySource(ai, web, cfg()).discover({ subject, count: 8, exclude: [] });
    expect(r.map((c) => c.name)).toEqual(['Grounded Shop']);
  });

  it('breadth stores the FACTS depth later strengthens (website/socials/facts)', async () => {
    const ai = {
      isConfigured: () => true,
      structured: jest.fn(async ({ system }: { system: string }) => {
        if (system.includes('form web-search queries')) return { queries: ['q1'] };
        if (system.includes('candidate qualifier')) return { qualified: ['Surf School X'] };
        if (system.includes('converted poorly')) return {};
        return { candidates: [{ name: 'Surf School X', country: 'PT', evidence: ['https://a.example/1'], website: 'https://surfx.example', socials: ['https://instagram.com/surfx'], facts: ['Weekend package €189 for two'] }] };
      }),
    } as unknown as AiProvider;
    const web = { webSearch: jest.fn(async () => HITS) } as unknown as WebSearchProvider;
    const { candidates: r } = await new AiDiscoverySource(ai, web, cfg()).discover({ subject, count: 8, exclude: [] });
    expect(r[0].website).toBe('https://surfx.example');
    expect(r[0].socials).toEqual(['https://instagram.com/surfx']);
    expect(r[0].facts).toEqual(['Weekend package €189 for two']);
  });

  it('low conversion → fallback round: relaxed constraint noted, broader queries run, new finds carry matchNote', async () => {
    let mineCall = 0;
    const ai = {
      isConfigured: () => true,
      structured: jest.fn(async ({ system }: { system: string }) => {
        if (system.includes('form web-search queries')) return { queries: ['rooftop yoga class Lisbon'] };
        if (system.includes('converted poorly')) return { relaxed: 'rooftop', queries: ['yoga studio Lisbon'] };
        if (system.includes('candidate qualifier')) return { qualified: ['Yoga Hub', 'Zen Studio', 'Calm Loft', 'Flow House'] };
        mineCall++;
        const g = (name: string) => ({ name, country: 'PT', evidence: [], website: `https://${name.toLowerCase().replace(/ /g, '')}.example` });
        return mineCall === 1
          ? { candidates: [g('Yoga Hub')] } // round 1: 1 of 8 → conversion checkpoint fails
          : { candidates: [g('Zen Studio'), g('Calm Loft'), g('Flow House')] };
      }),
    } as unknown as AiProvider;
    const web = { webSearch: jest.fn(async () => HITS) } as unknown as WebSearchProvider;

    const { candidates, notes } = await new AiDiscoverySource(ai, web, cfg()).discover({ subject, count: 8, exclude: [] });
    expect(notes).toEqual(['search converted 1/8 — relaxed "rooftop", re-searching']);
    expect((web.webSearch as jest.Mock).mock.calls.map((c) => c[0].query)).toEqual(['rooftop yoga class Lisbon', 'yoga studio Lisbon']);
    expect(candidates.map((c) => c.name)).toEqual(['Yoga Hub', 'Zen Studio', 'Calm Loft', 'Flow House']);
    expect(candidates[0].matchNote).toBeNull();              // round-1 find = full match
    expect(candidates[1].matchNote).toContain('rooftop');     // fallback finds must be confirmed downstream
  });
});

describe('AiDiscoverySource (adaptive cycles)', () => {
  const HITS = [{ title: 't', url: 'https://x.example/1', content: 'c' }];

  /** Relax always produces NEW queries; mining yields per-round candidates from `rounds`. */
  const adaptiveAi = ({ rounds }: { rounds: string[][] }) => {
    let mineCall = 0;
    let relaxCall = 0;
    return {
      isConfigured: () => true,
      structured: jest.fn(async ({ system }: { system: string }) => {
        if (system.includes('form web-search queries')) return { queries: ['q1'] };
        if (system.includes('converted poorly')) { relaxCall++; return { relaxed: `constraint${relaxCall}`, queries: [`q${relaxCall + 1}`] }; }
        if (system.includes('candidate qualifier')) return { qualified: rounds.flat() };
        const names = rounds[Math.min(mineCall++, rounds.length - 1)];
        return { candidates: names.map((name) => ({ name, country: 'PT', evidence: [], website: `https://${name.toLowerCase()}.example` })) };
      }),
    } as unknown as AiProvider;
  };

  it('presses toward the FULL target but stops after 2 consecutive dry rounds', async () => {
    // Round 1 finds A; rounds 2+3 re-find only A (no new names) → dry ×2 → stop at 1/4.
    const ai = adaptiveAi({ rounds: [['A'], ['A'], ['A']] });
    const web = { webSearch: jest.fn(async () => HITS) } as unknown as WebSearchProvider;
    const { candidates, notes } = await new AiDiscoverySource(ai, web, cfg()).discover({ subject, count: 4, exclude: [] });
    expect(candidates.map((c) => c.name)).toEqual(['A']);
    expect((web.webSearch as jest.Mock).mock.calls).toHaveLength(3); // 1 productive + 2 dry, never 50
    expect(notes.at(-1)).toContain('went dry after 3 cycle(s)');
  });

  it('the hard cycle cap bounds a still-productive loop', async () => {
    // Every round finds one NEW name — without the cap this would run to the target (10).
    const ai = adaptiveAi({ rounds: [['A'], ['B'], ['C'], ['D'], ['E']] });
    const web = { webSearch: jest.fn(async () => HITS) } as unknown as WebSearchProvider;
    const { candidates, notes } = await new AiDiscoverySource(ai, web, cfg(3)).discover({ subject, count: 10, exclude: [] });
    expect(candidates.map((c) => c.name)).toEqual(['A', 'B', 'C']);
    expect(notes.at(-1)).toContain('cycle cap (3) reached at 3/10');
  });
});
