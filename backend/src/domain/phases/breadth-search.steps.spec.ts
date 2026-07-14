import { BreadthEvent, BreadthState, LeadSpecificity, PhaseKey } from '@inqi/shared';
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

// run.data is PERSISTED. A run already in flight when this code deploys has none of the
// fields added here — and `[...undefined]` throws, killing the run. Seen for real: every
// in-flight widen run died with "d.searched is not iterable".
describe('breadth SEARCH — survives a run persisted before these fields existed', () => {
  it('backfills searched/queriesPerCycle/emptySearchRetries instead of throwing', async () => {
    const { search, ctx, web } = build({ queries: ['a', 'b'] });
    const legacy = ctx.run.data as unknown as Record<string, unknown>;
    delete legacy.searched;            // the shape an older run actually has on disk
    delete legacy.queriesPerCycle;
    delete legacy.emptySearchRetries;

    const out = await search.execute(ctx);

    expect(out.event).toBe(BreadthEvent.POOL_READY);
    expect(web.webSearch).toHaveBeenCalledTimes(2);
    expect(out.dataPatch?.searched).toEqual(['a', 'b']); // the set starts fresh, not undefined
  });
});

/**
 * Keeping general aggregators must not let the loop declare victory on them. Seen live:
 * a Serper run returned ten marketplace SEARCH pages, counted them as 10/10 and stopped —
 * strictly worse than the old behaviour, which dropped them and kept hunting for dealers.
 */
describe('breadth CHECKPOINT — only SPECIFIC leads satisfy the target', () => {
  const lead = (name: string, aggregator = false) => ({
    name, country: 'DE', evidence: [],
    ...(aggregator ? { specificity: LeadSpecificity.GeneralAggregator } : {}),
  });

  function checkpointWith(candidates: ReturnType<typeof lead>[], count = 3) {
    const handlers = new Map<string, { execute: (c: StepCtx) => Promise<StepOutcome> }>();
    const registry = { register: ({ state, handler }: { state: string; handler: never }) => handlers.set(state, handler) };
    new BreadthSearchSteps(registry as never, { isConfigured: () => true } as never, { webSearch: jest.fn() } as never, { recordAction: jest.fn() } as never);
    const data = {
      purpose: 'funnel', epicId: 'e1', subject: { title: 't', description: 'd' },
      count, maxCycles: 3, queriesPerCycle: 6, emptySearchRetries: 0, cycle: 1,
      exclude: [], queries: [], searched: [], pool: null, proposed: [],
      candidates, seenNames: [], gainedThisCycle: 1, dryRounds: 0, matchNote: null, notes: [],
    } as unknown as BreadthRunData;
    const ctx = { run: { reportId: 'r1', data }, log: jest.fn().mockResolvedValue(undefined) } as unknown as StepCtx;
    return handlers.get(BreadthState.CHECKPOINT)!.execute(ctx);
  }

  it('does NOT call TARGET_MET when the target is filled only with directories', async () => {
    const out = await checkpointWith([lead('Classic.com', true), lead('Hemmings', true), lead('CarGurus', true)], 3);
    expect(out.event).not.toBe(BreadthEvent.TARGET_MET); // 0 specific — keep hunting
    expect(out.event).toBe(BreadthEvent.CONTINUE);
  });

  it('calls TARGET_MET on specific leads, and the directories ride along as extras', async () => {
    const out = await checkpointWith([lead('Hollmann'), lead('Gallery Aaldering'), lead('Early 911S'), lead('Classic.com', true)], 3);
    expect(out.event).toBe(BreadthEvent.TARGET_MET);
  });

  it('a cycle that gained only directories is a DRY round, not progress', async () => {
    // gained drives the dry counter; directories must not make a barren cycle look productive.
    const out = await checkpointWith([lead('Hemmings', true)], 3);
    expect(out.event).toBe(BreadthEvent.CONTINUE);
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
