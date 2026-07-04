/**
 * Swappable headless-browser page reader — the depth agent's `open_url` tool.
 * Playwright/Chromium today; a remote browser service can bind later. Inject by
 * token, never by class.
 */
export interface PageReadResult {
  url: string;
  title: string;
  /** Visible page text, whitespace-collapsed and truncated to the configured budget. */
  text: string;
  truncated: boolean;
}

export interface PageReader {
  /** Open an http(s) page and extract its readable text. Throws on bad urls / navigation failure. */
  read(args: { url: string }): Promise<PageReadResult>;
}
export const PAGE_READER = Symbol('PageReader');

/** OpenAI tool definition for the page reader (advertised to the depth agent). */
export const OPEN_URL_TOOL = {
  type: 'function',
  function: {
    name: 'open_url',
    description: 'Open a web page in a real browser and read its visible text. Use it to inspect a promising search result in depth (menus, prices, reviews, contact details).',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Absolute http(s) URL to open — must come from a web_search result.' } },
      required: ['url'],
    },
  },
} as const;
