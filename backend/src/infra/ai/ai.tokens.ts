import { ModelTier } from '@inqi/shared';

/** Chat roles for the model (OpenAI-compatible). */
export const ChatRole = {
  System: 'system',
  User: 'user',
  Assistant: 'assistant',
} as const;
export type ChatRole = (typeof ChatRole)[keyof typeof ChatRole];

export interface ChatMsg {
  role: ChatRole;
  content: string;
}

/** An OpenAI function-calling tool set the model may use during a {@link AiProvider.toolStructured} run. */
export interface ToolSet {
  /** OpenAI-format tool definitions to advertise to the model. */
  definitions: unknown[];
  /** Run one tool call; the returned string is what the model sees as the tool result. Never throw — return an error JSON string instead. */
  execute(call: { name: string; args: unknown }): Promise<string>;
}

/**
 * Swappable LLM provider (Qwen today → any OpenAI-compatible model). Bind a
 * concrete impl to {@link AI_PROVIDER}; inject by token, never by class.
 */
export interface AiProvider {
  /** Whether a real backend is configured (an API key is present). Callers fall back to stubs when false. */
  isConfigured(): boolean;
  modelFor(args: { tier: ModelTier }): string;
  chat(args: { messages: ChatMsg[]; tier?: ModelTier }): Promise<string>;
  complete(args: { system: string; user: string; tier?: ModelTier }): Promise<string>;
  json<T = unknown>(args: { system: string; user: string; tier?: ModelTier }): Promise<T>;
  /**
   * Structured output: prompt for JSON, then run `validate` (e.g. a zod
   * `schema.parse`) on the parsed object. Keeps the schema library out of this
   * contract — domain prompts own their zod schemas and pass `schema.parse`.
   */
  structured<T>(args: { system: string; user: string; tier?: ModelTier; validate: (raw: unknown) => T }): Promise<T>;
  /**
   * Agentic structured output: run a bounded tool-calling loop (the model may call
   * the given tools up to `maxToolCalls` times), then force a final strict-JSON
   * answer and validate it. `onToolCall` lets callers log tool activity.
   */
  toolStructured<T>(args: {
    system: string; user: string; tier?: ModelTier; tools: ToolSet;
    maxToolCalls?: number; validate: (raw: unknown) => T;
    onToolCall?: (call: { name: string; args: unknown }) => void;
  }): Promise<T>;
}
export const AI_PROVIDER = Symbol('AiProvider');

/** Swappable embeddings provider (Qwen embeddings / local) for subject similarity. */
export interface EmbeddingsProvider {
  embed(args: { text: string }): Promise<number[]>;
}
export const EMBEDDINGS_PROVIDER = Symbol('EmbeddingsProvider');
