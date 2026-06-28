import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

/** Orchestrator model sizing. Breadth = cheap/fast (wide funnel, candidate
 *  discovery, simple parsing). Depth = strong (per-subject-provider research, drafting
 *  & replying in an email chain, verification reasoning, report synthesis). */
export type ModelTier = 'breadth' | 'depth' | 'balanced';
export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

@Injectable()
export class QwenService {
  private client = new OpenAI({ apiKey: process.env.QWEN_API_KEY, baseURL: process.env.QWEN_BASE_URL });
  private models: Record<ModelTier, string> = {
    breadth: process.env.QWEN_MODEL_BREADTH ?? 'qwen-turbo',
    depth: process.env.QWEN_MODEL_DEPTH ?? 'qwen-max',
    balanced: process.env.QWEN_MODEL ?? 'qwen-plus',
  };

  modelFor(tier: ModelTier) { return this.models[tier]; }

  async chat(messages: ChatMsg[], tier: ModelTier = 'balanced'): Promise<string> {
    const r = await this.client.chat.completions.create({ model: this.models[tier], messages });
    return r.choices[0]?.message?.content ?? '';
  }

  complete(system: string, user: string, tier: ModelTier = 'balanced') {
    return this.chat([{ role: 'system', content: system }, { role: 'user', content: user }], tier);
  }

  async json<T = any>(system: string, user: string, tier: ModelTier = 'balanced'): Promise<T> {
    const txt = await this.complete(system + '\nRespond with strict JSON only.', user, tier);
    const m = txt.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : txt) as T;
  }
}
