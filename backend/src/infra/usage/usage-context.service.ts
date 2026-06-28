import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface UsageCtx { inquiryId?: string; stage?: string }

/**
 * Async-local context (HP-15) carrying the current inquiry/stage, so the AI
 * provider can attribute token usage to an inquiry without threading `inquiryId`
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

  inquiryId(): string | undefined {
    return this.als.getStore()?.inquiryId;
  }
}
