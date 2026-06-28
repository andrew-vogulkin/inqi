import OpenAI from 'openai';
import { ModelTier } from '@inqi/shared';
import { ErrorCode, UpstreamError } from '../../common/errors';
import { AiProvider, ChatMsg } from './ai.tokens';

export interface QwenConnection {
  apiKey?: string;
  baseUrl?: string;
  models: Record<ModelTier, string>;
  /** Whether this backend is usable (callers fall back to stubs when false). */
  configured: boolean;
}

/** Token-usage report from one model call (HP-15). `estimated` = the API omitted a usage block. */
export interface AiUsage { model: string; tier: ModelTier; promptTokens: number; completionTokens: number; totalTokens: number; estimated: boolean }
export type OnUsage = (usage: AiUsage) => void;

/**
 * Shared OpenAI-compatible Qwen engine behind the breadth/depth/balanced tier
 * router. Concrete backends (`qwen_local`, `qwen_cloud`) subclass this with their
 * own connection profile; the request/JSON/validation logic is identical.
 */
export abstract class QwenProviderBase implements AiProvider {
  private readonly client: OpenAI;
  private readonly models: Record<ModelTier, string>;
  private readonly configured: boolean;
  private readonly onUsage?: OnUsage;

  protected constructor(conn: QwenConnection, onUsage?: OnUsage) {
    this.client = new OpenAI({ apiKey: conn.apiKey ?? 'unset', baseURL: conn.baseUrl });
    this.models = conn.models;
    this.configured = conn.configured;
    this.onUsage = onUsage;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  modelFor({ tier }: { tier: ModelTier }): string {
    return this.models[tier];
  }

  async chat({ messages, tier = ModelTier.Balanced }: { messages: ChatMsg[]; tier?: ModelTier }): Promise<string> {
    return this.createChat({ messages, tier, jsonMode: false });
  }

  complete({ system, user, tier = ModelTier.Balanced }: { system: string; user: string; tier?: ModelTier }): Promise<string> {
    return this.chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], tier });
  }

  async json<T = unknown>({ system, user, tier = ModelTier.Balanced }: { system: string; user: string; tier?: ModelTier }): Promise<T> {
    const txt = await this.createChat({
      messages: [{ role: 'system', content: `${system}\nRespond with strict JSON only.` }, { role: 'user', content: user }],
      tier,
      jsonMode: true,
    });
    return this.parseJson<T>({ txt, tier });
  }

  async structured<T>({ system, user, tier = ModelTier.Balanced, validate }: { system: string; user: string; tier?: ModelTier; validate: (raw: unknown) => T }): Promise<T> {
    const raw = await this.json<unknown>({ system, user, tier });
    try {
      return validate(raw);
    } catch (e) {
      throw new UpstreamError({
        code: ErrorCode.AiInvalidJson,
        message: `AI output failed schema validation: ${(e as Error).message}`,
        retryable: false,
        details: { tier },
      });
    }
  }

  /** Single call site for the model. `jsonMode` forces JSON output (suppresses prose/reasoning). */
  private async createChat({ messages, tier, jsonMode }: { messages: ChatMsg[]; tier: ModelTier; jsonMode: boolean }): Promise<string> {
    try {
      const r = await this.client.chat.completions.create({
        model: this.models[tier],
        messages,
        ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      });
      // Cost accounting (HP-15): record token usage from the API's usage block in this one place.
      const u = r.usage;
      this.onUsage?.({
        model: this.models[tier], tier,
        promptTokens: u?.prompt_tokens ?? 0, completionTokens: u?.completion_tokens ?? 0, totalTokens: u?.total_tokens ?? 0,
        estimated: !u,
      });
      return r.choices[0]?.message?.content ?? '';
    } catch (e) {
      throw new UpstreamError({
        code: ErrorCode.AiRequestFailed,
        message: `AI request failed: ${(e as Error).message}`,
        retryable: true,
        details: { tier },
      });
    }
  }

  private parseJson<T>({ txt, tier }: { txt: string; tier: ModelTier }): T {
    const m = txt.match(/\{[\s\S]*\}/);
    try {
      return JSON.parse(m ? m[0] : txt) as T;
    } catch (e) {
      throw new UpstreamError({
        code: ErrorCode.AiInvalidJson,
        message: `AI returned invalid JSON: ${(e as Error).message}`,
        retryable: false,
        details: { tier },
      });
    }
  }
}
