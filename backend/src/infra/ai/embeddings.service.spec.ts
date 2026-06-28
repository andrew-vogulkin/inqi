import { ConfigService } from '../config/config.service';
import { EmbeddingsService } from './embeddings.service';

const DIM = 256;

function svc(): EmbeddingsService {
  const config = { embeddingsDriver: 'local', embeddings: { dim: DIM, model: 'x', apiKey: undefined, baseUrl: undefined } } as unknown as ConfigService;
  const usage = { recordAi: async () => {} } as any;
  const usageCtx = { inquiryId: () => undefined } as any;
  return new EmbeddingsService(config, usage, usageCtx);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

describe('EmbeddingsService (local fallback)', () => {
  it('is deterministic: same text → identical vector', async () => {
    const e = svc();
    expect(await e.embed({ text: 'a used road bike' })).toEqual(await e.embed({ text: 'a used road bike' }));
  });

  it('returns an L2-normalized vector of the configured dimension', async () => {
    const v = await svc().embed({ text: 'a used road bike, 56cm, Amsterdam' });
    expect(v).toHaveLength(DIM);
    expect(Math.sqrt(v.reduce((a, x) => a + x * x, 0))).toBeCloseTo(1, 5);
  });

  it('places similar texts closer (higher cosine) than dissimilar ones', async () => {
    const e = svc();
    const a = await e.embed({ text: 'second-hand road bike 56cm amsterdam' });
    const b = await e.embed({ text: 'used road bike 56cm near amsterdam' });
    const c = await e.embed({ text: 'wedding catering service for 200 guests' });
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  });
});
