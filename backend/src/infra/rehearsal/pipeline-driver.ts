import { WebSearchProvider } from '../websearch/websearch.tokens';
import { PageReader } from '../browser/browser.tokens';
import { RehearsalCase } from './rehearsal-case';
import { RunOutcome } from './scorer';

/**
 * Candidate config a rehearsal runs under — the prompt/lesson/numeric overrides
 * being evaluated. An empty object is the current baseline; P2/P3 populate it
 * (e.g. injected research lessons, a candidate depth prompt, tweaked thresholds).
 */
export interface RehearsalConfig {
  [key: string]: unknown;
}

/**
 * Executes ONE golden case's research core and reports its outcome. The runner
 * hands in replay-bound web-search + page-reader so the driver sees frozen
 * evidence; the driver runs the real pipeline (model live) under `config` and
 * returns the terminal state + qualified provider names.
 *
 * Swappable by design: a fake driver for unit tests; an app-backed driver (Nest
 * context on the testcontainers DB) for integration.
 */
export interface PipelineDriver {
  run(args: {
    rehearsalCase: RehearsalCase;
    webSearch: WebSearchProvider;
    pageReader: PageReader;
    config: RehearsalConfig;
  }): Promise<RunOutcome>;
}
