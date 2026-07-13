import { Injectable, Logger, Optional } from '@nestjs/common';
import { UsageKind, WebSearchSource } from '@inqi/shared';
import { ConfigService } from '../config/config.service';
import { UsageService } from '../usage/usage.service';
import { UsageContextService } from '../usage/usage-context.service';
import { ErrorCode, UpstreamError } from '../../common/errors';
import { WebSearchProvider } from './websearch.tokens';
import {
  WEB_SEARCH_TOOLS, WebResult, WebSearchToolName,
  webSearchArgsSchema, translateArgsSchema, currencyConvertArgsSchema,
  WebSearchArgs, TranslateArgs, CurrencyConvertArgs,
} from './websearch.tools';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The provider label stamped on web-search usage rows (the cost view shows it). */
export const WEB_SEARCH_PROVIDER_LABEL = 'searxng';

/** Map the async-local usage stage → the cost-breakdown source bucket (HP-15). */
function sourceForStage(stage?: string): WebSearchSource {
  switch (stage) {
    case WebSearchSource.SubjectBuild: return WebSearchSource.SubjectBuild;   // 'subject_build'
    case WebSearchSource.BreadthSearch: return WebSearchSource.BreadthSearch; // 'breadth_search'
    case WebSearchSource.DepthSearch: return WebSearchSource.DepthSearch;     // 'depth_search'
    default: return WebSearchSource.Other; // pre_research / reactor / unset
  }
}

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
  // Concurrency gate (see `searx`): breadth/depth fire ~10 queries at once and
  // SearXNG's rate-limited public engines then return 200-with-empty for most of
  // the burst. We cap in-flight requests and space out their starts so each is served.
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private lastStart = 0;

  constructor(
    private readonly config: ConfigService,
    // Optional so unit tests can construct the provider bare; recording is best-effort.
    @Optional() private readonly usage?: UsageService,
    @Optional() private readonly usageCtx?: UsageContextService,
  ) {}

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
          // Agent-initiated tool call → attributed to `resource_get` (on-demand
          // resource retrieval), distinct from the pipeline's lifecycle searches.
          return JSON.stringify(await this.webSearch(webSearchArgsSchema.parse(raw), { source: WebSearchSource.ResourceGet }));
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
  async webSearch(args: WebSearchArgs, opts?: { source?: WebSearchSource }): Promise<WebResult[]> {
    // Cost accounting (HP-15): one row per logical search, attributed to the report
    // via the async-local usage context. `source` = the caller's explicit bucket
    // (the agent tool), else derived from the current phase stage.
    const source = opts?.source ?? sourceForStage(this.usageCtx?.current()?.stage);
    void this.usage?.recordAction({ reportId: this.usageCtx?.reportId(), kind: UsageKind.WebSearch, model: WEB_SEARCH_PROVIDER_LABEL, source });
    const params = {
      q: args.query,
      categories: args.category, // URLSearchParams encodes the space in "social media"
      ...(args.time_range ? { time_range: args.time_range } : {}),
      ...(args.language ? { language: args.language } : {}),
      ...(args.pageno ? { pageno: String(args.pageno) } : {}),
    };
    let res = await this.searx(params);
    // A rate-limited burst returns 200 + no results; one spaced retry usually lands
    // (concurrency has cleared by now), so a real hit isn't lost to a throttled miss.
    if (!res.results?.length) {
      await sleep(this.config.webSearch.emptyRetryMs);
      res = await this.searx(params);
    }
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

  /**
   * One GET to SearXNG, run through the concurrency gate: at most `maxConcurrency`
   * requests in flight, and each start spaced `minSpacingMs` from the last, so a
   * fan-out of queries is served instead of throttled to empty.
   */
  private async searx(params: Record<string, string>): Promise<SearxResponse> {
    await this.acquire();
    try {
      return await this.searxOnce(params);
    } finally {
      this.release();
    }
  }

  /** Wait for a concurrency slot, then pace this request start behind the previous one. */
  private async acquire(): Promise<void> {
    if (this.active >= this.config.webSearch.maxConcurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    const gap = this.lastStart + this.config.webSearch.minSpacingMs - Date.now();
    if (gap > 0) await sleep(gap);
    this.lastStart = Date.now();
  }

  private release(): void {
    this.active--;
    this.waiters.shift()?.();
  }

  /** One GET to the SearXNG JSON API with a bounded timeout. */
  private async searxOnce(params: Record<string, string>): Promise<SearxResponse> {
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
