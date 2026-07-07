import { WebSearchProvider } from '../websearch/websearch.tokens';
import { ToolDefinition, WebResult, WebSearchArgs, TranslateArgs, CurrencyConvertArgs } from '../websearch/websearch.tools';
import { Cassette, OnMiss, RehearsalMode, recorded } from './cassette';

/**
 * Cassette decorator over any {@link WebSearchProvider}. Every network-bound call
 * (search, tool exec, translate, currency) is recorded/replayed so a rehearsal sees
 * identical search evidence. `tools` is pass-through (static definitions, no I/O).
 */
export class RecordingWebSearchProvider implements WebSearchProvider {
  constructor(
    private readonly inner: WebSearchProvider,
    private readonly cassette: Cassette,
    private readonly mode: RehearsalMode,
    private readonly onMiss: OnMiss = 'throw',
  ) {}

  get tools(): ToolDefinition[] {
    return this.inner.tools;
  }

  private route<T>(kind: string, request: unknown, live: () => Promise<T>): Promise<T> {
    return recorded({ mode: this.mode, onMiss: this.onMiss, cassette: this.cassette, kind, request, live });
  }

  executeTool(call: { name: string; args: unknown }): Promise<string> {
    return this.route('tool', call, () => this.inner.executeTool(call));
  }

  webSearch(args: WebSearchArgs): Promise<WebResult[]> {
    return this.route('web_search', args, () => this.inner.webSearch(args));
  }

  translate(args: TranslateArgs): Promise<string> {
    return this.route('translate', args, () => this.inner.translate(args));
  }

  currencyConvert(args: CurrencyConvertArgs): Promise<string> {
    return this.route('currency', args, () => this.inner.currencyConvert(args));
  }
}
