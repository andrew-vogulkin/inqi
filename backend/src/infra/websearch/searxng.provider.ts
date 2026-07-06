import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { ErrorCode, UpstreamError } from '../../common/errors';
import { WebSearchProvider } from './websearch.tokens';
import {
  WEB_SEARCH_TOOLS, WebResult, WebSearchToolName,
  webSearchArgsSchema, translateArgsSchema, currencyConvertArgsSchema,
  WebSearchArgs, TranslateArgs, CurrencyConvertArgs,
} from './websearch.tools';

/** Subset of a SearXNG `format=json` response we read. */
interface SearxResponse {
  // `map` results additionally carry latitude/longitude/address (OSM/Photon places).
  results?: Array<{ title?: string; url?: string; content?: string; latitude?: number; longitude?: number; address?: string | null }>;
  // `answers` shape varies by category: translate → { translations: [{ text }] },
  // currency → { answer }, older builds → a plain string.
  answers?: unknown[];
}

/**
 * {@link WebSearchProvider} backed by a self-hosted SearXNG instance (the local
 * driver). Each public method (and each `executeTool` branch) maps to exactly one
 * `…/search?format=json` GET. Bound to {@link WEB_SEARCH} when
 * `config.webSearchDriver` is `searxng`.
 */
@Injectable()
export class SearxngWebSearchProvider implements WebSearchProvider {
  private readonly logger = new Logger(SearxngWebSearchProvider.name);

  constructor(private readonly config: ConfigService) {}

  /** The tool definitions to advertise to the model (drop into an OpenAI `tools` array). */
  get tools() {
    return WEB_SEARCH_TOOLS;
  }

  /**
   * Execute a model tool call by name. Returns the string the model should see as
   * the tool result. Argument-validation and transport failures are caught and
   * returned as a short JSON error string, so one bad tool call never breaks the
   * agent loop. Programmatic callers can use the typed methods below instead.
   */
  async executeTool({ name, args }: { name: string; args: unknown }): Promise<string> {
    try {
      const raw = this.parseArgs(args);
      switch (name as WebSearchToolName) {
        case 'web_search':
          return JSON.stringify(await this.webSearch(webSearchArgsSchema.parse(raw)));
        case 'translate':
          return await this.translate(translateArgsSchema.parse(raw));
        case 'currency_convert':
          return await this.currencyConvert(currencyConvertArgsSchema.parse(raw));
        default:
          return JSON.stringify({ error: `unknown tool: ${name}` });
      }
    } catch (e) {
      this.logger.warn(`tool ${name} failed: ${(e as Error).message}`);
      return JSON.stringify({ error: (e as Error).message });
    }
  }

  /** General/map/social-media web search → normalized hits (capped at maxResults). */
  async webSearch(args: WebSearchArgs): Promise<WebResult[]> {
    const res = await this.searx({
      q: args.query,
      categories: args.category, // URLSearchParams encodes the space in "social media"
      ...(args.time_range ? { time_range: args.time_range } : {}),
      ...(args.language ? { language: args.language } : {}),
      ...(args.pageno ? { pageno: String(args.pageno) } : {}),
    });
    return (res.results ?? []).slice(0, this.config.webSearch.maxResults).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      content: r.content ?? '',
      // Only map results carry geo — include it so the model gets coordinates/address.
      ...(typeof r.latitude === 'number' ? { latitude: r.latitude } : {}),
      ...(typeof r.longitude === 'number' ? { longitude: r.longitude } : {}),
      ...(r.address ? { address: r.address } : {}),
    }));
  }

  /** Translate text. SearXNG needs the `src-tgt text` query form; plain text returns nothing. */
  async translate(args: TranslateArgs): Promise<string> {
    const res = await this.searx({
      q: `${args.source_lang}-${args.target_lang} ${args.text}`,
      categories: 'translate',
    });
    return this.firstTranslation(res) ?? '';
  }

  /** Convert a currency amount (answer comes back in `answers`, e.g. "100.0 USD = 87.75 EUR"). */
  async currencyConvert(args: CurrencyConvertArgs): Promise<string> {
    const res = await this.searx({
      q: `${args.amount} ${args.from_currency.toUpperCase()} to ${args.to_currency.toUpperCase()}`,
      categories: 'currency',
    });
    return this.firstAnswer(res) ?? '';
  }

  /** Model tool-call arguments arrive as a JSON string (OpenAI) or an already-parsed object. */
  private parseArgs(args: unknown): unknown {
    if (typeof args === 'string') {
      try { return JSON.parse(args); } catch { return {}; }
    }
    return args ?? {};
  }

  /** One GET to the SearXNG JSON API with a bounded timeout. */
  private async searx(params: Record<string, string>): Promise<SearxResponse> {
    const url = new URL('/search', this.config.webSearch.baseUrl);
    url.search = new URLSearchParams({ ...params, format: 'json' }).toString();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.config.webSearch.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`searxng responded ${res.status}`);
      return (await res.json()) as SearxResponse;
    } catch (e) {
      throw new UpstreamError({ code: ErrorCode.WebSearchFailed, message: `web search request failed: ${(e as Error).message}` });
    } finally {
      clearTimeout(timer);
    }
  }

  /** translate result: answers[0].translations[0].text (defensive to string/object shapes). */
  private firstTranslation(res: SearxResponse): string | null {
    const a = res.answers?.[0] as { translations?: Array<{ text?: string }> } | string | undefined;
    if (a == null) return null;
    if (typeof a === 'string') return a;
    return a.translations?.[0]?.text ?? null;
  }

  /** currency result: answers[0].answer (defensive to string/object shapes). */
  private firstAnswer(res: SearxResponse): string | null {
    const a = res.answers?.[0] as { answer?: string } | string | undefined;
    if (a == null) return null;
    return typeof a === 'string' ? a : a.answer ?? null;
  }
}
