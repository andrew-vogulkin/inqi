import { Injectable, Logger, Optional } from '@nestjs/common';
import { UsageKind, WebSearchSource } from '@inqi/shared';
import { ConfigService } from '../config/config.service';
import { UsageService } from '../usage/usage.service';
import { UsageContextService } from '../usage/usage-context.service';
import { ErrorCode, UpstreamError } from '../../common/errors';
import { WebSearchProvider } from './websearch.tokens';
import { sourceForStage } from './websearch.source';
import {
  WEB_SEARCH_TOOLS, WebResult, WebSearchToolName, WEB_SEARCH_TOOL_NAME,
  webSearchArgsSchema, WebSearchArgs, TranslateArgs, CurrencyConvertArgs,
} from './websearch.tools';

/** The provider label stamped on web-search usage rows (the cost view shows it). */
export const SERPER_PROVIDER_LABEL = 'serper';

/** `time_range` → Google's `tbs` recency filter. */
const TBS_BY_RANGE: Record<string, string> = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' };

/**
 * A /maps call bills 3 credits (measured against the live API), vs 1 for /search — and
 * there is no `num` to shrink it. Only used if a response somehow omits `credits`.
 */
const MAPS_CREDITS = 3;

/** An organic web hit (POST /search). */
interface SerperOrganic { title?: string; link?: string; snippet?: string }
/**
 * A place (POST /maps) — the only Serper shape that carries geo. Field names verified
 * against the live API: the kind of business is `type` (NOT `category`), and `ratingCount`
 * rides along with `rating` — both matter, because breadth qualifies vendors on exactly
 * that social proof.
 */
interface SerperPlace {
  title?: string; address?: string; latitude?: number; longitude?: number;
  website?: string; cid?: string; rating?: number; ratingCount?: number;
  type?: string; types?: string[]; phoneNumber?: string;
}
/** `credits` is what the call actually cost — /search bills 1, /maps bills 3. */
interface SerperResponse { organic?: SerperOrganic[]; places?: SerperPlace[]; credits?: number }

/**
 * {@link WebSearchProvider} backed by Serper (hosted Google SERP API), the paid
 * alternative to the self-hosted SearXNG driver. Bound to {@link WEB_SEARCH} when
 * `config.webSearchDriver` is `serper`.
 *
 * Deliberately NOT rate-limited. The 1-req/s throttle in the SearXNG provider exists
 * because we scrape shared community engines that fall over under load; Serper is a
 * paid API built for concurrency, so throttling it would only make reports slower.
 *
 * Serper has no translate or currency endpoint. Rather than fake them, this provider
 * advertises only `web_search` to the model and throws on the other two — which is
 * safe, because the agent is only ever handed the `web_search` tool.
 */
@Injectable()
export class SerperWebSearchProvider implements WebSearchProvider {
  private readonly logger = new Logger(SerperWebSearchProvider.name);

  constructor(
    private readonly config: ConfigService,
    // Optional so unit tests can construct the provider bare; recording is best-effort.
    @Optional() private readonly usage?: UsageService,
    @Optional() private readonly usageCtx?: UsageContextService,
  ) {}

  /**
   * Only `web_search` — advertising translate/currency would invite the model to call
   * tools this backend cannot serve.
   */
  get tools() {
    return WEB_SEARCH_TOOLS.filter((t) => t.function.name === WEB_SEARCH_TOOL_NAME);
  }

  /** Execute a model tool call by name; a bad call returns a JSON error, never throws into the agent loop. */
  async executeTool({ name, args }: { name: string; args: unknown }): Promise<string> {
    try {
      const raw = typeof args === 'string' ? (JSON.parse(args) as unknown) : args;
      switch (name as WebSearchToolName) {
        case 'web_search':
          // Agent-initiated tool call → attributed to `resource_get`, distinct from
          // the pipeline's lifecycle searches.
          return JSON.stringify(await this.webSearch(webSearchArgsSchema.parse(raw), { source: WebSearchSource.ResourceGet }));
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
    const max = this.config.webSearch.maxResults;
    // 'map' has its own endpoint (it is the only one returning coordinates). Serper has
    // no social-media index, so 'social media' degrades to a plain web search.
    const isMap = args.category === 'map';
    if (args.category === 'social media') {
      this.logger.debug(`serper has no social-media index — running "${args.query}" as a general web search`);
    }

    const res = await this.post({
      path: isMap ? '/maps' : '/search',
      body: {
        q: args.query,
        num: max,
        ...(args.pageno ? { page: args.pageno } : {}),
        ...(args.language ? { hl: args.language } : {}),
        ...(args.time_range && TBS_BY_RANGE[args.time_range] ? { tbs: TBS_BY_RANGE[args.time_range] } : {}),
      },
    });

    // Cost accounting (HP-15): bill CREDITS, not calls. A /search is 1 credit but a /maps
    // is 3 — counting calls would understate map-heavy reports by 3x. Serper reports the
    // exact charge per response, so the cost view matches the invoice. Recorded AFTER the
    // call on purpose: Serper doesn't bill failures, so neither do we.
    const source = opts?.source ?? sourceForStage(this.usageCtx?.current()?.stage);
    void this.usage?.recordAction({
      reportId: this.usageCtx?.reportId(),
      kind: UsageKind.WebSearch,
      model: SERPER_PROVIDER_LABEL,
      source,
      quantity: res.credits ?? (isMap ? MAPS_CREDITS : 1),
    });

    return (isMap ? this.fromPlaces(res.places ?? []) : this.fromOrganic(res.organic ?? [])).slice(0, max);
  }

  /** Organic hits → {title,url,content}. */
  private fromOrganic(organic: SerperOrganic[]): WebResult[] {
    return organic.map((r) => ({ title: r.title ?? '', url: r.link ?? '', content: r.snippet ?? '' }));
  }

  /**
   * Places → {title,url,content} + geo. A place often has no website, so fall back to
   * its Google Maps permalink: the depth agent's `open_url` needs *something* to fetch,
   * and an empty url would strand the result.
   */
  private fromPlaces(places: SerperPlace[]): WebResult[] {
    return places.map((p) => ({
      title: p.title ?? '',
      url: p.website || (p.cid ? `https://maps.google.com/?cid=${p.cid}` : ''),
      content: [
        p.type ?? p.types?.[0],
        // Rating without a count is noise — "5.0" from one review qualifies nobody.
        p.rating != null ? `rating ${p.rating}${p.ratingCount != null ? ` (${p.ratingCount} reviews)` : ''}` : null,
        p.phoneNumber,
      ].filter(Boolean).join(' · '),
      ...(typeof p.latitude === 'number' ? { latitude: p.latitude } : {}),
      ...(typeof p.longitude === 'number' ? { longitude: p.longitude } : {}),
      ...(p.address ? { address: p.address } : {}),
    }));
  }

  /** One POST to the Serper API with a bounded timeout. */
  private async post({ path, body }: { path: string; body: Record<string, unknown> }): Promise<SerperResponse> {
    const { apiKey, baseUrl, timeoutMs } = this.config.serper;
    if (!apiKey) {
      throw new UpstreamError({ code: ErrorCode.WebSearchFailed, message: 'SERPER_API_KEY is not configured', retryable: false });
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(new URL(path, baseUrl), {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`serper responded ${res.status}`);
      return (await res.json()) as SerperResponse;
    } catch (e) {
      throw new UpstreamError({ code: ErrorCode.WebSearchFailed, message: `web search request failed: ${(e as Error).message}` });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Serper has no translate endpoint — the model is never given this tool. */
  translate(_args: TranslateArgs): Promise<string> {
    throw new UpstreamError({ code: ErrorCode.WebSearchFailed, message: 'translate is not supported by the serper driver', retryable: false });
  }

  /** Serper has no currency endpoint — the model is never given this tool. */
  currencyConvert(_args: CurrencyConvertArgs): Promise<string> {
    throw new UpstreamError({ code: ErrorCode.WebSearchFailed, message: 'currency_convert is not supported by the serper driver', retryable: false });
  }
}
