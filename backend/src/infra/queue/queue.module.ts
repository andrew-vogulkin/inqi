import { Global, Module } from '@nestjs/common';
import { BossService } from './boss.service';

/** Infra (@Global): the pg-boss job queue. */
@Global()
@Module({ providers: [BossService], exports: [BossService] })
export class QueueModule {}
