import { PageReader, PageReadResult } from '../browser/browser.tokens';
import { Cassette, OnMiss, RehearsalMode, recorded } from './cassette';

/**
 * Cassette decorator over any {@link PageReader}. Page reads (the depth agent's
 * open_url) are recorded/replayed so a rehearsal sees the same page text — including
 * the same bot-challenge/login-wall verdicts — for a given URL.
 */
export class RecordingPageReader implements PageReader {
  constructor(
    private readonly inner: PageReader,
    private readonly cassette: Cassette,
    private readonly mode: RehearsalMode,
    private readonly onMiss: OnMiss = 'throw',
  ) {}

  read(args: { url: string }): Promise<PageReadResult> {
    return recorded({ mode: this.mode, onMiss: this.onMiss, cassette: this.cassette, kind: 'page', request: { url: args.url }, live: () => this.inner.read(args) });
  }
}
