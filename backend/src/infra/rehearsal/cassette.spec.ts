import { Cassette, CassetteMissError, recorded, requestKey, stableStringify } from './cassette';

describe('stableStringify + requestKey', () => {
  it('is invariant to object key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(requestKey({ query: 'x', category: 'general' })).toBe(requestKey({ category: 'general', query: 'x' }));
  });
  it('distinguishes different requests', () => {
    expect(requestKey({ query: 'a' })).not.toBe(requestKey({ query: 'b' }));
  });
  it('handles nested arrays/objects and primitives', () => {
    expect(stableStringify({ xs: [{ b: 1, a: 2 }], n: null })).toBe('{"n":null,"xs":[{"a":2,"b":1}]}');
  });
});

describe('Cassette', () => {
  it('round-trips entries through JSON', () => {
    const c = new Cassette();
    c.put({ kind: 'web_search', key: 'k1', request: { query: 'x' }, response: [{ url: 'u' }] });
    const restored = new Cassette(JSON.parse(JSON.stringify(c.toJSON())));
    expect(restored.get('web_search', 'k1')?.response).toEqual([{ url: 'u' }]);
    expect(restored.get('web_search', 'missing')).toBeUndefined();
    expect(restored.size).toBe(1);
  });
});

describe('recorded()', () => {
  const kind = 'web_search';
  const req = { query: 'hillcreek' };

  it('off: always runs live, records nothing', async () => {
    const c = new Cassette();
    let calls = 0;
    const r = await recorded({ mode: 'off', onMiss: 'throw', cassette: c, kind, request: req, live: async () => { calls++; return 'live'; } });
    expect(r).toBe('live');
    expect(calls).toBe(1);
    expect(c.size).toBe(0);
  });

  it('record: runs live and stores the result', async () => {
    const c = new Cassette();
    const r = await recorded({ mode: 'record', onMiss: 'throw', cassette: c, kind, request: req, live: async () => 'fresh' });
    expect(r).toBe('fresh');
    expect(c.get(kind, requestKey(req))?.response).toBe('fresh');
  });

  it('replay: returns the recorded result without running live', async () => {
    const c = new Cassette();
    await recorded({ mode: 'record', onMiss: 'throw', cassette: c, kind, request: req, live: async () => 'recorded' });
    let live = 0;
    const r = await recorded({ mode: 'replay', onMiss: 'throw', cassette: c, kind, request: req, live: async () => { live++; return 'LIVE'; } });
    expect(r).toBe('recorded');
    expect(live).toBe(0);
  });

  it('replay miss (throw): raises CassetteMissError', async () => {
    const c = new Cassette();
    await expect(recorded({ mode: 'replay', onMiss: 'throw', cassette: c, kind, request: req, live: async () => 'x' }))
      .rejects.toBeInstanceOf(CassetteMissError);
  });

  it('replay miss (live): falls through to live and records the new entry', async () => {
    const c = new Cassette();
    let live = 0;
    const r = await recorded({ mode: 'replay', onMiss: 'live', cassette: c, kind, request: req, live: async () => { live++; return 'grown'; } });
    expect(r).toBe('grown');
    expect(live).toBe(1);
    expect(c.get(kind, requestKey(req))?.response).toBe('grown'); // cassette grew
  });
});
