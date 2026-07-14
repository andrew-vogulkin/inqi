import { BreadthEvent, BreadthState, PhaseKey } from '@inqi/shared';
import { BreadthSearchSteps, BreadthRunData } from './breadth-search.steps';
import { StepCtx, StepOutcome } from './phase-step.tokens';

/** Capture the handlers the steps class registers, so we can drive one state directly. */
function build({ queries, searched = [], emptySearchRetries = 0, queriesPerCycle = 6, hits = [{ title: 'T', url: 'http://x', content: 'c' }], structured }: {
  queries: string[]; searched?: string[]; emptySearchRetries?: number; queriesPerCycle?: number;
  hits?: { title: string; url: string; content: string }[]; structured?: jest.Mock;
}) {
  const handlers = new Map<string, { execute: (ctx: StepCtx) => Promise<StepOutcome> }>();
  const registry = { register: ({ state, handler }: { key: string; state: string; handler: never }) => handlers.set(state, handler) };
  // One call per query — the whole point: a query IS a billable search.
  const web = { webSearch: jest.fn().mockResolvedValue(hits) };
  const ai = { isConfigured: () => true, structured: structured ?? jest.fn() };
  const usage = { recordAction: jest.fn() };

  new BreadthSearchSteps(registry as never, ai as never, web as never, usage as never);

  const data: BreadthRunData = {
    purpose: 'funnel', epicId: 'e1', subject: { title: 'yoga studio', description: 'Bangkok' },
    count: 8, maxCycles: 3, queriesPerCycle, emptySearchRetries,
    cycle: 1, exclude: [], queries, searched, pool: null, proposed: [], candidates: [],
    seenNames: [], gainedThisCycle: 0, dryRounds: 0, matchNote: null, notes: [],
  };
  const ctx = { run: { reportId: 'r1', data }, log: jest.fn().mockResolvedValue(undefined) } as unknown as StepCtx;
  return { search: handlers.get(BreadthState.SEARCH)!, marketing: handlers.get(BreadthState.MARKETING)!, ctx, web, ai };
}

/** The queries actually sent to the provider (one webSearch call each). */
const searchedQueries = (web: { webSearch: jest.Mock }): string[] => web.webSearch.mock.calls.map((c) => c[0].query);

describe('breadth SEARCH — query dedupe (every query is a billable search)', () => {
  it('skips queries already searched earlier in the run', async () => {
    // Each relax round buys a FRESH batch from the model; the prompt only ASKS it not to
    // repeat. Overlap used to be re-searched — and re-billed — in full.
    const { search, ctx, web } = build({ queries: ['yoga bangkok', 'yoga studio bkk'], searched: ['yoga bangkok'] });
    const out = await search.execute(ctx);

    expect(searchedQueries(web)).toEqual(['yoga studio bkk']); // the repeat never left the process
    expect(out.event).toBe(BreadthEvent.POOL_READY);
    expect(out.dataPatch?.searched).toEqual(['yoga bangkok', 'yoga studio bkk']);
  });

  it('dedupes repeats WITHIN a single batch (the model emits them)', async () => {
    const { search, ctx, web } = build({ queries: ['yoga bangkok', 'yoga bangkok', 'pilates bangkok'] });
    await search.execute(ctx);
    expect(searchedQueries(web)).toEqual(['yoga bangkok', 'pilates bangkok']);
  });

  it('runs NOTHING when the whole batch was already searched', async () => {
    const { search, ctx, web } = build({ queries: ['yoga bangkok'], searched: ['yoga bangkok'] });
    const out = await search.execute(ctx);

    expect(web.webSearch).not.toHaveBeenCalled(); // a fully-duplicate batch is worth zero
    expect(out.event).toBe(BreadthEvent.POOL_READY);
  });
});

describe('breadth SEARCH — the empty-pool retry is retired by default', () => {
  // It re-fired the WHOLE batch and stalled 75s per attempt. It existed because SearXNG's
  // engines suspend after a burst and answer 200-with-empty; the global 1-req/s throttle
  // now prevents those bursts, and on a paid API empty means genuinely empty.
  it('does not re-fire the batch on an empty pool when retries are 0', async () => {
    const { search, ctx, web } = build({ queries: ['a', 'b'], hits: [], emptySearchRetries: 0 });
    const out = await search.execute(ctx);

    expect(web.webSearch).toHaveBeenCalledTimes(2); // one pass over the batch, no re-fire
    expect(out.event).toBe(BreadthEvent.POOL_READY);
  });

  it('still honours the retry when explicitly configured (the SearXNG escape hatch)', async () => {
    const { search, ctx, web } = build({ queries: ['a'], hits: [], emptySearchRetries: 1 });
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 as never; }) as never);
    await search.execute(ctx);
    expect(web.webSearch).toHaveBeenCalledTimes(2); // original + one re-fire
    jest.restoreAllMocks();
  });
});

describe('breadth MARKETING — the last-resort pass obeys the same dial', () => {
  const marketingReply = () => jest.fn().mockResolvedValue({ queries: ['yoga studio bangkok', 'pilates bangkok'] });

  it('asks for queriesPerCycle queries — marketing searches are billable too', async () => {
    const structured = marketingReply();
    const { marketing, ctx } = build({ queries: [], searched: ['old q'], queriesPerCycle: 4, structured });
    await marketing.execute(ctx);
    // The count reaches the model through the system prompt, off the same config dial.
    expect(structured.mock.calls[0][0].system).toContain('4 queries');
  });

  // Marketing is told "don't repeat these". Showing it only the LAST batch let it
  // re-propose queries from earlier cycles — the SEARCH dedupe then binned them, so the
  // AI call was spent for nothing.
  it('sees EVERY query the run has issued, not just the last batch', async () => {
    const structured = marketingReply();
    const { marketing, ctx } = build({ queries: ['latest only'], searched: ['cycle-1 q', 'cycle-2 q'], structured });
    await marketing.execute(ctx);
    const user = structured.mock.calls[0][0].user as string;
    expect(user).toContain('cycle-1 q');
    expect(user).toContain('cycle-2 q');
  });

  it('spends its one pass, then concedes on the second visit', async () => {
    const { marketing, ctx } = build({ queries: [], structured: marketingReply() });
    const first = await marketing.execute(ctx);
    expect(first.event).toBe(BreadthEvent.MARKETING_QUERIES);
    expect(first.dataPatch?.marketingDone).toBe(true);

    const { marketing: again, ctx: ctx2 } = build({ queries: [], structured: marketingReply() });
    (ctx2.run.data as unknown as BreadthRunData).marketingDone = true;
    expect((await again.execute(ctx2)).event).toBe(BreadthEvent.MARKETING_EXHAUSTED);
  });
});
