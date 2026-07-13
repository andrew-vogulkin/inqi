import { ConfigService } from '../config/config.service';
import { SearxngWebSearchProvider } from './searxng.provider';

function svc(over: Partial<{ requestIntervalMs: number; emptyRetryMs: number }> = {}): SearxngWebSearchProvider {
  // requestIntervalMs/emptyRetryMs = 0 keeps the rate limiter + retry no-delay in unit tests.
  const config = { webSearch: { baseUrl: 'https://searx.test:8443', timeoutMs: 5000, maxResults: 8, requestIntervalMs: 0, emptyRetryMs: 0, ...over } } as unknown as ConfigService;
  return new SearxngWebSearchProvider(config);
}

/** Mock global fetch; return `body` as the JSON payload and capture the requested URL. */
function mockFetch(body: unknown) {
  const fn = jest.fn().mockResolvedValue({ ok: true, json: async () => body });
  (global as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

/** The URL string passed to fetch on call `i` (fetch is called with a URL object). */
const calledUrl = (fn: jest.Mock, i = 0): string => String(fn.mock.calls[i][0]);

afterEach(() => jest.restoreAllMocks());

describe('WebSearchService', () => {
  describe('web_search', () => {
    it('builds a general JSON search and normalizes results[] → {title,url,content}', async () => {
      const fetchFn = mockFetch({ results: [{ title: 'T', url: 'http://x/y', content: 'C', extra: 'drop' }] });
      const out = await svc().webSearch({ query: 'used road bike', category: 'general' });
      const url = new URL(calledUrl(fetchFn));
      expect(url.origin + url.pathname).toBe('https://searx.test:8443/search');
      expect(url.searchParams.get('q')).toBe('used road bike');
      expect(url.searchParams.get('categories')).toBe('general');
      expect(url.searchParams.get('format')).toBe('json');
      expect(out).toEqual([{ title: 'T', url: 'http://x/y', content: 'C' }]);
    });

    it('surfaces latitude/longitude/address for map results (general results stay {title,url,content})', async () => {
      mockFetch({ results: [{ title: 'The Niche Mono', url: 'https://osm/way/1', content: '', latitude: 13.7045, longitude: 100.5925, address: null }] });
      const [hit] = await svc().webSearch({ query: 'Niche Mono', category: 'map' });
      expect(hit).toEqual({ title: 'The Niche Mono', url: 'https://osm/way/1', content: '', latitude: 13.7045, longitude: 100.5925 });
      expect('address' in hit).toBe(false); // null address omitted
    });

    it('URL-encodes the space in the "social media" category', async () => {
      const fetchFn = mockFetch({ results: [] });
      await svc().webSearch({ query: 'q', category: 'social media' });
      // URLSearchParams encodes the space (as +); decoded it round-trips to the literal value.
      expect(calledUrl(fetchFn)).toContain('categories=social+media');
      expect(new URL(calledUrl(fetchFn)).searchParams.get('categories')).toBe('social media');
    });

    it('retries ONCE when the first result set is empty (a rate-limited miss), then serves the hit', async () => {
      // SearXNG returns 200-with-empty when its engines are throttled; the spaced retry lands.
      const fn = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ title: 'T', url: 'u', content: 'C' }] }) });
      (global as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
      const out = await svc().webSearch({ query: 'canalizador Lisboa', category: 'general' });
      expect(fn).toHaveBeenCalledTimes(2);
      expect(out).toEqual([{ title: 'T', url: 'u', content: 'C' }]);
    });

    it('retries at most once — a genuinely empty query returns [] after two tries', async () => {
      const fetchFn = mockFetch({ results: [] });
      const out = await svc().webSearch({ query: 'nothing here', category: 'general' });
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(out).toEqual([]);
    });

    it('passes optional time_range/language/pageno and caps at maxResults', async () => {
      const many = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, url: `u${i}`, content: `c${i}` }));
      const fetchFn = mockFetch({ results: many });
      const out = await svc().webSearch({ query: 'q', category: 'general', time_range: 'week', language: 'en', pageno: 2 });
      const p = new URL(calledUrl(fetchFn)).searchParams;
      expect(p.get('time_range')).toBe('week');
      expect(p.get('language')).toBe('en');
      expect(p.get('pageno')).toBe('2');
      expect(out).toHaveLength(8);
    });
  });

  describe('translate', () => {
    it('uses the src-tgt query form and reads answers[0].translations[0].text', async () => {
      const fetchFn = mockFetch({ answers: [{ translations: [{ text: 'Hola Mundo' }] }] });
      const out = await svc().translate({ text: 'hello world', source_lang: 'en', target_lang: 'es' });
      const p = new URL(calledUrl(fetchFn)).searchParams;
      expect(p.get('q')).toBe('en-es hello world');
      expect(p.get('categories')).toBe('translate');
      expect(out).toBe('Hola Mundo');
    });

    it('returns "" when no translation answer is present', async () => {
      mockFetch({ answers: [] });
      expect(await svc().translate({ text: 'x', source_lang: 'en', target_lang: 'es' })).toBe('');
    });
  });

  describe('currency_convert', () => {
    it('uses the "{amount} {FROM} to {TO}" form and reads answers[0].answer', async () => {
      const fetchFn = mockFetch({ answers: [{ answer: '100.0 USD = 87.75 EUR' }] });
      const out = await svc().currencyConvert({ amount: 100, from_currency: 'usd', to_currency: 'eur' });
      const p = new URL(calledUrl(fetchFn)).searchParams;
      expect(p.get('q')).toBe('100 USD to EUR'); // currencies upper-cased
      expect(p.get('categories')).toBe('currency');
      expect(out).toBe('100.0 USD = 87.75 EUR');
    });
  });

  describe('executeTool', () => {
    it('dispatches web_search and returns a JSON string of results', async () => {
      mockFetch({ results: [{ title: 'T', url: 'u', content: 'C' }] });
      const out = await svc().executeTool({ name: 'web_search', args: { query: 'q' } });
      expect(JSON.parse(out)).toEqual([{ title: 'T', url: 'u', content: 'C' }]);
    });

    it('parses a JSON-string arguments payload (OpenAI tool-call shape)', async () => {
      const fetchFn = mockFetch({ answers: [{ answer: '1.0 USD = 0.9 EUR' }] });
      const out = await svc().executeTool({ name: 'currency_convert', args: '{"amount":1,"from_currency":"USD","to_currency":"EUR"}' });
      expect(new URL(calledUrl(fetchFn)).searchParams.get('q')).toBe('1 USD to EUR');
      expect(out).toBe('1.0 USD = 0.9 EUR');
    });

    it('returns an error string for an unknown tool (does not throw)', async () => {
      const out = await svc().executeTool({ name: 'nope', args: {} });
      expect(JSON.parse(out)).toEqual({ error: 'unknown tool: nope' });
    });

    it('returns an error string when the upstream request fails (does not throw)', async () => {
      const fn = jest.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
      (global as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
      const out = await svc().executeTool({ name: 'web_search', args: { query: 'q' } });
      expect(JSON.parse(out).error).toMatch(/web search request failed/);
    });

    it('returns an error string when arguments fail validation (does not throw)', async () => {
      mockFetch({ results: [] });
      const out = await svc().executeTool({ name: 'web_search', args: { query: '' } }); // min(1) violated
      expect(JSON.parse(out).error).toBeDefined();
    });
  });

  it('exposes the three tool definitions for the model', () => {
    expect(svc().tools.map((t) => t.function.name)).toEqual(['web_search', 'translate', 'currency_convert']);
  });

  describe('global rate limit', () => {
    it('spaces consecutive engine requests by at least requestIntervalMs, even when fired concurrently', async () => {
      const interval = 40;
      const provider = svc({ requestIntervalMs: interval });
      const starts: number[] = [];
      const fn = jest.fn().mockImplementation(async () => { starts.push(Date.now()); return { ok: true, json: async () => ({ results: [{ title: 'T', url: 'u', content: 'C' }] }) }; });
      (global as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;

      // Fire five searches at once — they share ONE global queue, not five parallel starts.
      await Promise.all(Array.from({ length: 5 }, () => provider.webSearch({ query: 'q', category: 'general' })));

      expect(starts).toHaveLength(5);
      // The 5th request reserves the 4-interval slot, so it cannot start before then —
      // a wall-clock total assertion (robust to scheduler jitter; per-gap timing flakes
      // under parallel test load since jitter compresses individual measured gaps).
      expect(starts[4] - starts[0]).toBeGreaterThanOrEqual(4 * interval - 8);
    });
  });
});
