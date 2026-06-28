import { Injectable, OnModuleInit, OnModuleDestroy, Global, Module } from '@nestjs/common';
import PgBoss from 'pg-boss';

/** pg-boss = Postgres-backed job queue (no Redis). One per process. */
@Injectable()
export class BossService implements OnModuleInit, OnModuleDestroy {
  readonly boss = new PgBoss(process.env.DATABASE_URL!);
  async onModuleInit() { await this.boss.start(); }
  async onModuleDestroy() { await this.boss.stop(); }
  enqueue<T extends object>(name: string, data: T) { return this.boss.send(name, data); }
  work<T extends object>(name: string, handler: (job: PgBoss.Job<T>) => Promise<void>) {
    return this.boss.work<T>(name, async ([job]) => handler(job));
  }
}

@Global()
@Module({ providers: [BossService], exports: [BossService] })
export class QueueModule {}
