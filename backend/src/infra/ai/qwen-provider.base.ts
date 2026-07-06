import OpenAI from 'openai';
import { ModelTier } from '@inqi/shared';
import { ErrorCode, UpstreamError } from '../../common/errors';
import { AiProvider, ChatMsg, ToolSet } from './ai.tokens';
import { RequestQueue } from './request-queue';

export interface QwenConnection {
  apiKey?: string;
  baseUrl?: string;
  models: Record<ModelTier, string>;
  /** Whether this backend is usable (callers fall back to stubs when false). */
  configured: boolean;
  /**
   * Max requests this backend serves at once — the rest queue FIFO. Set to 1 for
   * the local provider (one GPU: honest sequential flow); leave unset for cloud.
   */
  maxConcurrency?: number;
}

/**
 * Token-usage report from one model call (HP-15). `estimated` = the API omitted a
 * usage block. `modelVersion` is the SERVED model identity the backend reported
 * (`response.model` — e.g. the exact checkpoint llama.cpp/DashScope actually ran),
 * vs `model`, our configured alias for the tier.
 */
export interface AiUsage { model: string; modelVersion: string; tier: ModelTier; promptTokens: number; completionTokens: number; totalTokens: number; estimated: boolean }
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
  /** FIFO limiter in front of the backend (set when `maxConcurrency` is configured — local provider). */
  private readonly queue: RequestQueue | null;

  protected constructor(conn: QwenConnection, onUsage?: OnUsage) {
    this.client = new OpenAI({ apiKey: conn.apiKey ?? 'unset', baseURL: conn.baseUrl });
    this.models = conn.models;
    this.configured = conn.configured;
    this.onUsage = onUsage;
    this.queue = conn.maxConcurrency && conn.maxConcurrency > 0 ? new RequestQueue(conn.maxConcurrency) : null;
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

  async toolStructured<T>({ system, user, tier = ModelTier.Depth, tools, maxToolCalls = 6, validate, onToolCall }: {
    system: string; user: string; tier?: ModelTier; tools: ToolSet;
    maxToolCalls?: number; validate: (raw: unknown) => T;
    onToolCall?: (call: { name: string; args: unknown }) => void;
  }): Promise<T> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    let calls = 0;
    while (calls < maxToolCalls) {
      const msg = await this.request({ messages, tier, jsonMode: false, tools: tools.definitions as OpenAI.ChatCompletionTool[] });
      const toolCalls = msg.tool_calls ?? [];
      if (!toolCalls.length) break; // model chose to answer — fall through to the forced-JSON final
      messages.push(msg as OpenAI.ChatCompletionMessageParam);
      for (const tc of toolCalls) {
        calls++;
        const name = tc.function?.name ?? '';
        let args: unknown = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = tc.function?.arguments; }
        onToolCall?.({ name, args });
        const result = await tools.execute({ name, args }); // ToolSet contract: never throws
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        if (calls >= maxToolCalls) break;
      }
    }
    // Final forcing call OMITS the tools entirely — llama.cpp leaks the tool-call
    // template as text under `tool_choice: 'none'`, so absence is the reliable off-switch.
    messages.push({ role: 'user', content: 'Research complete (tool budget spent). Respond now with the final STRICT JSON only — no prose.' });
    const finalMsg = await this.request({ messages, tier, jsonMode: true });
    const raw = this.parseJson<unknown>({ txt: finalMsg.content ?? '', tier });
    try {
      return validate(raw);
    } catch (e) {
      throw new UpstreamError({
        code: ErrorCode.AiInvalidJson,
        message: `AI tool-loop output failed schema validation: ${(e as Error).message}`,
        retryable: false,
        details: { tier },
      });
    }
  }

  /** Single call site for the model. `jsonMode` forces JSON output (suppresses prose/reasoning). */
  private async createChat({ messages, tier, jsonMode }: { messages: ChatMsg[]; tier: ModelTier; jsonMode: boolean }): Promise<string> {
    const msg = await this.request({ messages, tier, jsonMode });
    return msg.content ?? '';
  }

  /** The one model call: optional tools, usage accounting (HP-15), typed failure. */
  private async request(args: {
    messages: (ChatMsg | OpenAI.ChatCompletionMessageParam)[]; tier: ModelTier; jsonMode: boolean; tools?: OpenAI.ChatCompletionTool[];
  }): Promise<OpenAI.ChatCompletionMessage> {
    // The provider queue: every request takes an honest FIFO slot (parallel = maxConcurrency).
    if (this.queue) return this.queue.run(() => this.dispatch(args));
    return this.dispatch(args);
  }

  private async dispatch({ messages, tier, jsonMode, tools }: {
    messages: (ChatMsg | OpenAI.ChatCompletionMessageParam)[]; tier: ModelTier; jsonMode: boolean; tools?: OpenAI.ChatCompletionTool[];
  }): Promise<OpenAI.ChatCompletionMessage> {
    try {
      // The Qwen reasoning model "thinks" before answering; left unbounded it burns a huge
      // token budget (a stage can run for minutes and get reaped). Disable thinking and cap
      // output for fast, bounded structured replies. `chat_template_kwargs` is the
      // llama.cpp/vLLM convention; harmless (ignored) on backends that don't support it.
      const r = await this.client.chat.completions.create({
        model: this.models[tier],
        messages: messages as OpenAI.ChatCompletionMessageParam[],
        max_tokens: 6000,
        ...(tools?.length ? { tools } : {}),
        ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        ...({ chat_template_kwargs: { enable_thinking: false } } as Record<string, unknown>),
      });
      // Cost accounting (HP-15): record token usage from the API's usage block in this one place.
      const u = r.usage;
      this.onUsage?.({
        model: this.models[tier], modelVersion: r.model || this.models[tier], tier,
        promptTokens: u?.prompt_tokens ?? 0, completionTokens: u?.completion_tokens ?? 0, totalTokens: u?.total_tokens ?? 0,
        estimated: !u,
      });
      return r.choices[0]?.message ?? ({ role: 'assistant', content: '', refusal: null } as OpenAI.ChatCompletionMessage);
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
