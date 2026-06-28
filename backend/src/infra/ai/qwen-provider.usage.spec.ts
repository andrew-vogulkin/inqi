import { ModelTier } from '@inqi/shared';
import { AiUsage, OnUsage, QwenProviderBase } from './qwen-provider.base';

class TestProvider extends QwenProviderBase {
  constructor(onUsage: OnUsage) {
    super({ models: { [ModelTier.Breadth]: 'm', [ModelTier.Depth]: 'm', [ModelTier.Balanced]: 'test-model' }, configured: true }, onUsage);
  }
  setClient(create: () => Promise<unknown>) { (this as unknown as { client: unknown }).client = { chat: { completions: { create } } }; }
}

describe('QwenProviderBase usage capture (HP-15)', () => {
  it('records token usage from the API usage block', async () => {
    const seen: AiUsage[] = [];
    const p = new TestProvider((u) => seen.push(u));
    p.setClient(async () => ({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, choices: [{ message: { content: 'hi' } }] }));
    await p.chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ model: 'test-model', promptTokens: 10, completionTokens: 5, totalTokens: 15, estimated: false });
  });

  it('handles a usage-less response: 0 tokens + estimated flag (never throws)', async () => {
    const seen: AiUsage[] = [];
    const p = new TestProvider((u) => seen.push(u));
    p.setClient(async () => ({ choices: [{ message: { content: '{}' } }] })); // no usage block (e.g. local model)
    await p.json({ system: 's', user: 'u' });
    expect(seen[0]).toMatchObject({ promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: true });
  });
});
