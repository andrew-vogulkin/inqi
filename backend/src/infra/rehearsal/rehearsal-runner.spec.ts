import { RehearsalRunner } from './rehearsal-runner';
import { InMemoryCassetteStore } from './cassette-store';
import { PipelineDriver } from './pipeline-driver';
import { RehearsalCase } from './rehearsal-case';
import { RunOutcome } from './scorer';
import { WebSearchProvider } from '../websearch/websearch.tokens';
import { WebResult } from '../websearch/websearch.tools';
import { PageReader, PageReadResult } from '../browser/browser.tokens';

const CASE: RehearsalCase = { id: 'hc', rawRequest: 'a venue in Tagaytay', note: 'n', expectations: { mustQualify: ['Hillcreek'], minOptions: 1 } };

/** Fake inner providers that count real calls, so we can prove replay avoids them. */
function fakes() {
  const calls = { web: 0, page: 0 };
  const web: WebSearchProvider = {
    tools: [] as never,
    webSearch: async () => { calls.web++; return [{ url: 'https://hillcreek.example', title: 'Hillcreek Gardens', content: 'venue' }] as WebResult[]; },
    executeTool: async () => 'r', translate: async () => 't', currencyConvert: async () => 'c',
  };
  const page: PageReader = { read: async ({ url }) => { calls.page++; return { url, title: 'T', text: 'x', truncated: false } as PageReadResult; } };
  return { web, page, calls };
}

/** A driver that actually consumes the (replayed) evidence and derives an outcome from it. */
function driverFrom(outcome: (evidence: WebResult[]) => RunOutcome): PipelineDriver {
  return {
    run: async ({ webSearch, pageReader, rehearsalCase }) => {
      const evidence = (await webSearch.webSearch({ query: rehearsalCase.rawRequest } as never)) as WebResult[];
      await pageReader.read({ url: evidence[0]?.url ?? 'https://x.example' });
      return outcome(evidence);
    },
  };
}

const qualifyFromEvidence = (ev: WebResult[]): RunOutcome => ({ state: 'REPORT_DELIVERED', options: ev.map((e) => ({ name: e.title })) });

describe('RehearsalRunner', () => {
  it('records a case live, scores it, and persists the cassette', async () => {
    const store = new InMemoryCassetteStore();
    const f = fakes();
    const run = await new RehearsalRunner(driverFrom(qualifyFromEvidence), store, f.web, f.page).runCase(CASE, { mode: 'record' });

    expect(f.calls.web).toBe(1);              // hit the real provider while recording
    expect(run.result.passed).toBe(true);      // "Hillcreek Gardens" satisfies mustQualify + minOptions
    expect(run.cassetteSize).toBeGreaterThan(0);
    expect((await store.load('hc')).size).toBeGreaterThan(0); // saved
  });

  it('replays from the cassette without touching the real providers (frozen evidence)', async () => {
    const store = new InMemoryCassetteStore();
    await new RehearsalRunner(driverFrom(qualifyFromEvidence), store, fakes().web, fakes().page).runCase(CASE, { mode: 'record' });

    const replayFakes = fakes();
    const run = await new RehearsalRunner(driverFrom(qualifyFromEvidence), store, replayFakes.web, replayFakes.page).runCase(CASE, { mode: 'replay' });

    expect(replayFakes.calls.web).toBe(0);     // served entirely from the cassette
    expect(replayFakes.calls.page).toBe(0);
    expect(run.result.passed).toBe(true);       // identical evidence → identical (passing) outcome
  });

  it('runSet rolls per-case results into a scorecard', async () => {
    const store = new InMemoryCassetteStore();
    const f = fakes();
    // one passing case, one failing (driver returns no options → fails minOptions)
    const failCase: RehearsalCase = { id: 'empty', rawRequest: 'q', note: 'n', expectations: { minOptions: 1 } };
    const driver: PipelineDriver = {
      run: async ({ rehearsalCase, webSearch }) => {
        await webSearch.webSearch({ query: 'q' } as never);
        return rehearsalCase.id === 'hc' ? { state: 'REPORT_DELIVERED', options: [{ name: 'Hillcreek Gardens' }] } : { state: 'REPORT_DELIVERED', options: [] };
      },
    };
    const card = await new RehearsalRunner(driver, store, f.web, f.page).runSet([CASE, failCase], { mode: 'record' });
    expect(card).toMatchObject({ passed: 1, failed: 1, total: 2 });
  });
});
