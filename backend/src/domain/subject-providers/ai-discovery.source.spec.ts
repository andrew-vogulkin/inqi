import { AiProvider } from '../../infra/ai/ai.tokens';
import { AiDiscoverySource } from './ai-discovery.source';

const unconfigured = { isConfigured: () => false } as unknown as AiProvider;
const src = () => new AiDiscoverySource(unconfigured);
const subject = { title: 'road bike', description: 'used road bike' };

describe('AiDiscoverySource (fallback)', () => {
  it('returns `count` distinct candidates when AI is unconfigured', async () => {
    const r = await src().discover({ subject, count: 5, exclude: [] });
    expect(r).toHaveLength(5);
    expect(new Set(r.map((c) => c.name)).size).toBe(5);
  });

  it('never proposes excluded names (widening)', async () => {
    const exclude = ['Subject Provider 1', 'Subject Provider 2'];
    const r = await src().discover({ subject, count: 3, exclude });
    expect(r).toHaveLength(3);
    expect(r.some((c) => exclude.includes(c.name))).toBe(false);
  });
});
