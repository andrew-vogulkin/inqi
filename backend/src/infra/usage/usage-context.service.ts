import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface UsageCtx { reportId?: string; stage?: string }

/**
 * Async-local context (HP-15) carrying the current report/stage, so the AI
 * provider can attribute token usage to a report without threading `reportId`
 * through every call. Set by the stage wrapper + reactor; read at record time.
 */
@Injectable()
export class UsageContextService {
  private readonly als = new AsyncLocalStorage<UsageCtx>();

  run<T>(ctx: UsageCtx, fn: () => Promise<T>): Promise<T> {
    return this.als.run(ctx, fn);
  }

  current(): UsageCtx | undefined {
    return this.als.getStore();
  }

  reportId(): string | undefined {
    return this.als.getStore()?.reportId;
  }
}
