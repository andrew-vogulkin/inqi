import { Cassette, CassetteMissError } from './cassette';
import { RecordingWebSearchProvider } from './recording-web-search.provider';
import { RecordingPageReader } from './recording-page.reader';
import { WebSearchProvider } from '../websearch/websearch.tokens';
import { PageReader, PageReadResult } from '../browser/browser.tokens';

function fakeWeb() {
  const calls = { webSearch: 0, executeTool: 0 };
  const provider: WebSearchProvider = {
    tools: [{ type: 'function', function: { name: 'web_search', description: '', parameters: {} } }] as never,
    webSearch: async () => { calls.webSearch++; return [{ url: 'https://x.example', title: 'X', content: 'body' }]; },
    executeTool: async () => { calls.executeTool++; return 'tool-result'; },
    translate: async () => 'translated',
    currencyConvert: async () => 'converted',
  };
  return { provider, calls };
}

function fakePage(result: Partial<PageReadResult> = {}) {
  const calls = { read: 0 };
  const provider: PageReader = {
    read: async ({ url }) => { calls.read++; return { url, title: 'T', text: 'page text', truncated: false, ...result }; },
  };
  return { provider, calls };
}

describe('RecordingWebSearchProvider', () => {
  it('records on record mode, replays without hitting the inner provider', async () => {
    const cassette = new Cassette();
    const rec = fakeWeb();
    const recording = new RecordingWebSearchProvider(rec.provider, cassette, 'record');
    const first = await recording.webSearch({ query: 'hillcreek', category: 'general' } as never);
    expect(rec.calls.webSearch).toBe(1);

    const rep = fakeWeb();
    const replaying = new RecordingWebSearchProvider(rep.provider, cassette, 'replay');
    const second = await replaying.webSearch({ query: 'hillcreek', category: 'general' } as never);
    expect(second).toEqual(first);       // identical evidence
    expect(rep.calls.webSearch).toBe(0); // inner never called on a hit
  });

  it('replays executeTool by (name, args) and passes tools through untouched', async () => {
    const cassette = new Cassette();
    const rec = fakeWeb();
    const recording = new RecordingWebSearchProvider(rec.provider, cassette, 'record');
    await recording.executeTool({ name: 'web_search', args: { query: 'q' } });
    expect(recording.tools).toBe(rec.provider.tools); // pass-through, no I/O

    const rep = fakeWeb();
    const replaying = new RecordingWebSearchProvider(rep.provider, cassette, 'replay');
    expect(await replaying.executeTool({ name: 'web_search', args: { query: 'q' } })).toBe('tool-result');
    expect(rep.calls.executeTool).toBe(0);
  });

  it('throws on a replay miss by default, but grows the cassette when onMiss=live', async () => {
    const cassette = new Cassette();
    const strict = new RecordingWebSearchProvider(fakeWeb().provider, cassette, 'replay');
    await expect(strict.webSearch({ query: 'new' } as never)).rejects.toBeInstanceOf(CassetteMissError);

    const lenient = fakeWeb();
    const grow = new RecordingWebSearchProvider(lenient.provider, cassette, 'replay', 'live');
    await grow.webSearch({ query: 'new' } as never);
    expect(lenient.calls.webSearch).toBe(1); // fell through to live
    expect(cassette.size).toBe(1);           // and recorded it
  });
});

describe('RecordingPageReader', () => {
  it('replays a page read (incl. a blocked verdict) by url', async () => {
    const cassette = new Cassette();
    const rec = fakePage({ blocked: true, blockReason: 'bot challenge (Cloudflare)', status: 403 });
    await new RecordingPageReader(rec.provider, cassette, 'record').read({ url: 'https://walled.example/' });

    const rep = fakePage();
    const out = await new RecordingPageReader(rep.provider, cassette, 'replay').read({ url: 'https://walled.example/' });
    expect(out.blocked).toBe(true);
    expect(out.blockReason).toBe('bot challenge (Cloudflare)');
    expect(rep.calls.read).toBe(0); // served from cassette
  });
});
