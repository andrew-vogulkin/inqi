import { WebSearchProvider } from '../websearch/websearch.tokens';
import { PageReader } from '../browser/browser.tokens';
import { OnMiss, RehearsalMode } from './cassette';
import { CassetteStore } from './cassette-store';
import { RecordingWebSearchProvider } from './recording-web-search.provider';
import { RecordingPageReader } from './recording-page.reader';
import { RehearsalCase } from './rehearsal-case';
import { PipelineDriver, RehearsalConfig } from './pipeline-driver';
import { CaseResult, RunOutcome, Scorecard, evaluateCase, scoreRun } from './scorer';

export interface CaseRun {
  result: CaseResult;
  outcome: RunOutcome;
  cassetteSize: number;
}

export interface RunOptions {
  config?: RehearsalConfig;   // candidate overrides; omitted = baseline
  mode?: RehearsalMode;       // 'replay' (default) | 'record' | 'off'
  onMiss?: OnMiss;            // replay-miss policy; 'live' lets a candidate explore new queries
}

/**
 * Drives the golden set through a {@link PipelineDriver} under the cassette layer,
 * scores each run, and rolls up a {@link Scorecard}. `record` captures a case's
 * evidence live; `replay` freezes it so a candidate is judged on identical inputs.
 * The pipeline itself (and the model) live in the injected driver — this class is
 * pure orchestration and is unit-tested with a fake driver.
 */
export class RehearsalRunner {
  constructor(
    private readonly driver: PipelineDriver,
    private readonly store: CassetteStore,
    private readonly innerWeb: WebSearchProvider,
    private readonly innerPage: PageReader,
  ) {}

  async runCase(rehearsalCase: RehearsalCase, opts: RunOptions = {}): Promise<CaseRun> {
    const mode: RehearsalMode = opts.mode ?? 'replay';
    const onMiss: OnMiss = opts.onMiss ?? 'throw';
    const cassette = await this.store.load(rehearsalCase.id);

    const webSearch = new RecordingWebSearchProvider(this.innerWeb, cassette, mode, onMiss);
    const pageReader = new RecordingPageReader(this.innerPage, cassette, mode, onMiss);

    const outcome = await this.driver.run({ rehearsalCase, webSearch, pageReader, config: opts.config ?? {} });

    // Persist the cassette whenever it may have grown (recording, or a lenient replay miss).
    if (mode === 'record' || onMiss === 'live') await this.store.save(rehearsalCase.id, cassette);

    return { result: evaluateCase({ rehearsalCase, outcome }), outcome, cassetteSize: cassette.size };
  }

  async runSet(cases: RehearsalCase[], opts: RunOptions = {}): Promise<Scorecard> {
    const results: CaseResult[] = [];
    for (const c of cases) results.push((await this.runCase(c, opts)).result); // serial: replay is cheap, live shares one model queue
    return scoreRun(results);
  }
}
