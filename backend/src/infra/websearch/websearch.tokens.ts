import { ToolDefinition, WebResult, WebSearchArgs, TranslateArgs, CurrencyConvertArgs } from './websearch.tools';

/**
 * Swappable web-search tool backend. SearXNG (self-hosted) today → any hosted
 * search API later. Bind a concrete impl to {@link WEB_SEARCH}; inject by token,
 * never by class — so call sites depend on the capability, not the provider.
 */
export interface WebSearchProvider {
  /** The tool definitions to advertise to the model (OpenAI function-calling format). */
  readonly tools: ToolDefinition[];
  /** Run a model tool call by name; returns the string the model should see as the result. */
  executeTool(call: { name: string; args: unknown }): Promise<string>;
  /** General/map/social-media web search → normalized hits. */
  webSearch(args: WebSearchArgs): Promise<WebResult[]>;
  /** Translate text between two language codes. */
  translate(args: TranslateArgs): Promise<string>;
  /** Convert a currency amount; returns the human-readable answer string. */
  currencyConvert(args: CurrencyConvertArgs): Promise<string>;
}

export const WEB_SEARCH = Symbol('WebSearchProvider');
