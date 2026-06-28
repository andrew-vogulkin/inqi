import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { QueueJob } from '@inqi/shared';

/** pg-boss = Postgres-backed job queue (no Redis). One instance per process. */
@Injectable()
export class BossService implements OnModuleInit, OnModuleDestroy {
  readonly boss = new PgBoss(process.env.DATABASE_URL!);

  async onModuleInit() {
    await this.boss.start();
  }

  async onModuleDestroy() {
    await this.boss.stop();
  }

  /** Enqueue a job. `options` carries pg-boss send options (priority, startAfter, …). */
  enqueue<T extends object>({ job, data, options }: { job: QueueJob; data: T; options?: PgBoss.SendOptions }) {
    return this.boss.send(job, data, options ?? {});
  }

  /** Register a worker for a job. pg-boss v9 delivers a single job per callback. */
  work<T extends object>({ job, handler }: { job: QueueJob; handler: (job: PgBoss.Job<T>) => Promise<void> }) {
    return this.boss.work<T>(job, async (j) => handler(j));
  }
}
