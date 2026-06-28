import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { HealthController } from './health.controller';

/** Infra (@Global): health endpoint + AgentRun/AgentEvent activity logging. */
@Global()
@Module({ controllers: [HealthController], providers: [ActivityService], exports: [ActivityService] })
export class ObservabilityModule {}
