import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Cassette } from './cassette';
import { FileCassetteStore, InMemoryCassetteStore } from './cassette-store';

describe('InMemoryCassetteStore', () => {
  it('round-trips a cassette by case id; unknown case → empty', async () => {
    const store = new InMemoryCassetteStore();
    const c = new Cassette();
    c.put({ kind: 'page', key: 'k', request: { url: 'u' }, response: { text: 'hi' } });
    await store.save('case-1', c);
    expect((await store.load('case-1')).get('page', 'k')?.response).toEqual({ text: 'hi' });
    expect((await store.load('never')).size).toBe(0);
  });
});

describe('FileCassetteStore', () => {
  const dir = join(__dirname, '__cassettes_test__');
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('persists a cassette to JSON and reads it back', async () => {
    const store = new FileCassetteStore(dir);
    const c = new Cassette();
    c.put({ kind: 'web_search', key: 'k1', request: { query: 'x' }, response: [{ url: 'u' }] });
    await store.save('golden-hillcreek', c);

    const raw = JSON.parse(await fs.readFile(join(dir, 'golden-hillcreek.json'), 'utf8'));
    expect(raw).toHaveLength(1);
    const reloaded = await store.load('golden-hillcreek');
    expect(reloaded.get('web_search', 'k1')?.response).toEqual([{ url: 'u' }]);
  });

  it('returns an empty cassette when the file is absent', async () => {
    expect((await new FileCassetteStore(dir).load('absent')).size).toBe(0);
  });

  it('rejects an unsafe case id (path traversal)', async () => {
    await expect(new FileCassetteStore(dir).save('../evil', new Cassette())).rejects.toThrow(/unsafe/);
  });
});
