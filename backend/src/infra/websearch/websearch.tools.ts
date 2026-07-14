import { z } from 'zod';

/** An OpenAI-compatible function-calling tool definition (advertised to the model). */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const WEB_SEARCH_CATEGORIES = ['general', 'map', 'social media'] as const;
export type WebSearchCategory = (typeof WEB_SEARCH_CATEGORIES)[number];

export type WebSearchToolName = 'web_search' | 'translate' | 'currency_convert';

/**
 * The one tool every provider must serve, and the only one the agent is ever handed.
 * `translate` / `currency_convert` are SearXNG-only extras — a hosted SERP API has no
 * equivalent, so a provider may legitimately advertise `web_search` alone.
 */
export const WEB_SEARCH_TOOL_NAME: WebSearchToolName = 'web_search';

/**
 * The tool array exposed to the model. Each tool maps to exactly one SearXNG
 * `…/search?format=json` request (see {@link WebSearchService}). Kept as a plain
 * literal so it can be passed straight into an OpenAI-compatible `tools` field.
 */
export const WEB_SEARCH_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        "Search the web. Set category to choose what to search: 'general' for normal web pages, 'map' to find places/addresses/coordinates, 'social media' for posts and discussions on Mastodon/Lemmy.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for.' },
          category: {
            type: 'string',
            enum: ['general', 'map', 'social media'],
            description: 'Which kind of search to run. Defaults to general.',
          },
          time_range: {
            type: 'string',
            enum: ['', 'day', 'week', 'month', 'year'],
            description: 'Restrict to recent results. Empty = no limit.',
          },
          language: { type: 'string', description: "Two-letter language code, e.g. 'en'. Optional." },
          pageno: { type: 'integer', description: 'Result page, starts at 1.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'translate',
      description: 'Translate text from one language to another.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to translate.' },
          source_lang: { type: 'string', description: "Source language code, e.g. 'en'." },
          target_lang: { type: 'string', description: "Target language code, e.g. 'es', 'fr', 'de'." },
        },
        required: ['text', 'source_lang', 'target_lang'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'currency_convert',
      description: 'Convert an amount from one currency to another.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Amount to convert, e.g. 100.' },
          from_currency: { type: 'string', description: "Source currency code, e.g. 'USD'." },
          to_currency: { type: 'string', description: "Target currency code, e.g. 'EUR'." },
        },
        required: ['amount', 'from_currency', 'to_currency'],
      },
    },
  },
];

// --- Runtime schemas for the model's tool-call arguments (untrusted → validated) ---

export const webSearchArgsSchema = z.object({
  query: z.string().min(1),
  category: z.enum(['general', 'map', 'social media']).default('general'),
  time_range: z.enum(['', 'day', 'week', 'month', 'year']).optional(),
  language: z.string().optional(),
  pageno: z.number().int().min(1).optional(),
});
export type WebSearchArgs = z.infer<typeof webSearchArgsSchema>;

export const translateArgsSchema = z.object({
  text: z.string().min(1),
  source_lang: z.string().min(2),
  target_lang: z.string().min(2),
});
export type TranslateArgs = z.infer<typeof translateArgsSchema>;

export const currencyConvertArgsSchema = z.object({
  amount: z.number(),
  from_currency: z.string().min(3),
  to_currency: z.string().min(3),
});
export type CurrencyConvertArgs = z.infer<typeof currencyConvertArgsSchema>;

/**
 * A normalized web-search hit (the subset the model needs). `latitude`/`longitude`/
 * `address` are only present for `category: 'map'` results (OSM/Photon places).
 */
export interface WebResult {
  title: string;
  url: string;
  content: string;
  latitude?: number;
  longitude?: number;
  address?: string;
}
