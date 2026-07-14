import { WebSearchSource } from '@inqi/shared';
import { ConfigService } from '../config/config.service';
import { SERPER_PROVIDER_LABEL, SerperWebSearchProvider } from './serper.provider';

function svc(over: Partial<{ apiKey: string; maxResults: number }> = {}) {
  const config = {
    webSearch: { maxResults: 8 },
    serper: { apiKey: 'sk-test', baseUrl: 'https://google.serper.dev', timeoutMs: 5000, ...over },
  } as unknown as ConfigService;
  const usage = { recordAction: jest.fn() };
  return { provider: new SerperWebSearchProvider(config, usage as never, undefined), usage };
}

/** Mock fetch; return `body` as the JSON payload and capture the request. */
function mockFetch(body: unknown) {
  const fn = jest.fn().mockResolvedValue({ ok: true, json: async () => body });
  (global as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}
const calledUrl = (fn: jest.Mock, i = 0): string => String(fn.mock.calls[i][0]);
const calledBody = (fn: jest.Mock, i = 0): Record<string, unknown> => JSON.parse(fn.mock.calls[i][1].body);
const calledHeaders = (fn: jest.Mock, i = 0): Record<string, string> => fn.mock.calls[i][1].headers;

afterEach(() => jest.restoreAllMocks());

describe('SerperWebSearchProvider — general search', () => {
  it('POSTs to /search with the API key and normalizes organic hits → {title,url,content}', async () => {
    const fetchFn = mockFetch({ organic: [{ title: 'T', link: 'http://x/y', snippet: 'C', position: 1 }] });
    const out = await svc().provider.webSearch({ query: 'used road bike', category: 'general' });

    expect(calledUrl(fetchFn)).toBe('https://google.serper.dev/search');
    expect(calledHeaders(fetchFn)['X-API-KEY']).toBe('sk-test');
    expect(calledBody(fetchFn)).toMatchObject({ q: 'used road bike', num: 8 });
    expect(out).toEqual([{ title: 'T', url: 'http://x/y', content: 'C' }]);
  });

  it('maps time_range → Google\'s tbs recency filter, and passes language/page', async () => {
    const fetchFn = mockFetch({ organic: [] });
    await svc().provider.webSearch({ query: 'q', category: 'general', time_range: 'week', language: 'en', pageno: 2 });
    expect(calledBody(fetchFn)).toMatchObject({ tbs: 'qdr:w', hl: 'en', page: 2 });
  });

  it('caps results at maxResults', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, link: `u${i}`, snippet: `c${i}` }));
    mockFetch({ organic: many });
    expect(await svc().provider.webSearch({ query: 'q', category: 'general' })).toHaveLength(8);
  });
});

describe('SerperWebSearchProvider — map search', () => {
  // Field names taken from the LIVE API: the business kind is `type`, not `category`.
  it('uses the /maps endpoint and surfaces latitude/longitude/address + social proof', async () => {
    const fetchFn = mockFetch({
      credits: 3,
      places: [{
        title: 'BGA Specialty Coffee', address: '83/8 Kasem Phanitchayakan Alley',
        latitude: 13.7317, longitude: 100.5941, website: 'https://bga.example',
        rating: 4.6, ratingCount: 212, type: 'Coffee shop', phoneNumber: '+66 97 098 9777',
      }],
    });
    const [hit] = await svc().provider.webSearch({ query: 'coffee ekkamai', category: 'map' });

    expect(calledUrl(fetchFn)).toBe('https://google.serper.dev/maps');
    expect(hit).toMatchObject({
      title: 'BGA Specialty Coffee', url: 'https://bga.example',
      latitude: 13.7317, longitude: 100.5941, address: '83/8 Kasem Phanitchayakan Alley',
    });
    // Breadth qualifies vendors on this — a rating with no count is noise.
    expect(hit.content).toBe('Coffee shop · rating 4.6 (212 reviews) · +66 97 098 9777');
  });

  // Measured live: ~30% of places have no website. An empty url would strand the result,
  // because the depth agent's open_url needs something to fetch.
  it('falls back to a Google Maps permalink when a place has no website', async () => {
    mockFetch({ places: [{ title: 'Nameless Bar', cid: '12345', latitude: 1, longitude: 2 }] });
    const [hit] = await svc().provider.webSearch({ query: 'bar', category: 'map' });
    expect(hit.url).toBe('https://maps.google.com/?cid=12345');
  });
});

describe('SerperWebSearchProvider — degradations and failures', () => {
  // Serper has no social index. Silently running a general search is the right call —
  // returning nothing would make the agent think the topic has no discussion at all.
  it('degrades "social media" to a plain web search rather than returning nothing', async () => {
    const fetchFn = mockFetch({ organic: [{ title: 'T', link: 'u', snippet: 'C' }] });
    const out = await svc().provider.webSearch({ query: 'q', category: 'social media' });
    expect(calledUrl(fetchFn)).toBe('https://google.serper.dev/search');
    expect(out).toHaveLength(1);
  });

  it('surfaces an upstream failure as WEB_SEARCH_FAILED (does not return silently-empty results)', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    await expect(svc().provider.webSearch({ query: 'q', category: 'general' })).rejects.toThrow(/web search request failed/);
  });

  it('refuses to run without an API key', async () => {
    mockFetch({ organic: [] });
    const { provider } = svc({ apiKey: undefined as unknown as string });
    await expect(provider.webSearch({ query: 'q', category: 'general' })).rejects.toThrow(/SERPER_API_KEY/);
  });

  // The model is only ever handed web_search, so advertising tools this backend cannot
  // serve would just invite calls that fail.
  it('advertises ONLY web_search — no translate/currency (Serper has no such endpoints)', () => {
    expect(svc().provider.tools.map((t) => t.function.name)).toEqual(['web_search']);
  });

  it('throws on translate/currency rather than faking an answer', async () => {
    const { provider } = svc();
    expect(() => provider.translate({ text: 'x', source_lang: 'en', target_lang: 'es' })).toThrow(/not supported/);
    expect(() => provider.currencyConvert({ amount: 1, from_currency: 'USD', to_currency: 'EUR' })).toThrow(/not supported/);
  });
});

describe('SerperWebSearchProvider — cost accounting', () => {
  it('bills the CREDITS Serper reports, not the call count — a /search is 1', async () => {
    mockFetch({ organic: [], credits: 1 });
    const { provider, usage } = svc();
    await provider.webSearch({ query: 'q', category: 'general' });
    expect(usage.recordAction).toHaveBeenCalledWith(expect.objectContaining({ model: SERPER_PROVIDER_LABEL, quantity: 1 }));
  });

  // Measured live: /maps bills 3 credits and has no `num` to shrink it. Counting calls
  // would understate a map-heavy report by 3x.
  it('bills a /maps call at its real 3 credits', async () => {
    mockFetch({ places: [], credits: 3 });
    const { provider, usage } = svc();
    await provider.webSearch({ query: 'q', category: 'map' });
    expect(usage.recordAction).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3 }));
  });

  it('falls back to the known /maps rate if a response omits `credits`', async () => {
    mockFetch({ places: [] });
    const { provider, usage } = svc();
    await provider.webSearch({ query: 'q', category: 'map' });
    expect(usage.recordAction).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3 }));
  });

  // Serper doesn't charge for errors, so neither do we — usage is recorded only after
  // a call actually succeeds.
  it('records nothing when the call fails', async () => {
    (global as unknown as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const { provider, usage } = svc();
    await expect(provider.webSearch({ query: 'q', category: 'general' })).rejects.toThrow();
    expect(usage.recordAction).not.toHaveBeenCalled();
  });

  it('attributes an agent tool call to resource_get', async () => {
    mockFetch({ organic: [] });
    const { provider, usage } = svc();
    await provider.executeTool({ name: 'web_search', args: { query: 'q' } });
    expect(usage.recordAction).toHaveBeenCalledWith(expect.objectContaining({ source: WebSearchSource.ResourceGet }));
  });

  it('returns a JSON error string for an unknown tool (never throws into the agent loop)', async () => {
    const out = await svc().provider.executeTool({ name: 'nope', args: {} });
    expect(JSON.parse(out)).toEqual({ error: 'unknown tool: nope' });
  });
});
