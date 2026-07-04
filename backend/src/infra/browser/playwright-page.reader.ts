import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Browser, chromium } from 'playwright';
import { ConfigService } from '../config/config.service';
import { PageReader, PageReadResult } from './browser.tokens';

/** Resource types that never carry readable text — blocked to keep page reads fast. */
const BLOCKED_RESOURCES = new Set(['image', 'media', 'font', 'stylesheet']);

/**
 * Playwright/Chromium page reader. One shared headless browser per process
 * (lazy-launched); each read gets a throwaway context. Extracts the page's
 * visible text (whitespace-collapsed, budget-truncated) for the depth agent.
 */
@Injectable()
export class PlaywrightPageReader implements PageReader, OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightPageReader.name);
  private browser?: Promise<Browser>;

  constructor(private readonly config: ConfigService) {}

  async onModuleDestroy() {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }

  private launch(): Promise<Browser> {
    if (!this.browser) {
      this.browser = chromium.launch({ headless: true });
      this.logger.log('launching headless chromium (depth-agent page reader)');
    }
    return this.browser;
  }

  async read({ url }: { url: string }): Promise<PageReadResult> {
    const parsed = new URL(url); // throws on garbage
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`refusing non-http(s) url: ${parsed.protocol}`);
    }
    const { pageTimeoutMs, pageMaxChars } = this.config.browser;
    const browser = await this.launch();
    const context = await browser.newContext({ javaScriptEnabled: true, viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.route('**/*', (route) => (BLOCKED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue()));
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
      const title = await page.title();
      const raw = await page.evaluate(() => document.body?.innerText ?? '');
      const text = raw.replace(/\s+/g, ' ').trim();
      const truncated = text.length > pageMaxChars;
      return { url, title, text: truncated ? text.slice(0, pageMaxChars) : text, truncated };
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}
