import { Global, Module } from '@nestjs/common';
import { PAGE_READER } from './browser.tokens';
import { PlaywrightPageReader } from './playwright-page.reader';

/**
 * Infra (@Global): the headless-browser page reader behind {@link PAGE_READER} —
 * the depth agent's `open_url` tool. Chromium is lazy-launched on first read, so
 * carrying this module costs nothing until an agent actually opens a page.
 */
@Global()
@Module({
  providers: [{ provide: PAGE_READER, useClass: PlaywrightPageReader }],
  exports: [PAGE_READER],
})
export class BrowserModule {}
