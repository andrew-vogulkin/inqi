import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

// Infra (@Global)
import { ConfigModule } from './infra/config/config.module';
import { PersistenceModule } from './infra/persistence/persistence.module';
import { QueueModule } from './infra/queue/queue.module';
import { EventsModule } from './infra/events/events.module';
import { AiModule } from './infra/ai/ai.module';
import { ObservabilityModule } from './infra/observability/observability.module';

// Edge / ingress
import { PublicModule } from './edge/public/public.module';
import { AuthModule } from './edge/auth/auth.module';
import { CapabilityTokenModule } from './edge/capability-token/capability-token.module';
import { WebhooksModule } from './edge/webhooks/webhooks.module';

// Domain workers + seams not reached transitively
import { OrchestratorWorkersModule } from './domain/orchestrator/orchestrator-workers.module';
import { EvalModule } from './domain/eval/eval.module';

@Module({
  imports: [
    // Infra
    ConfigModule, PersistenceModule, QueueModule, EventsModule, AiModule, ObservabilityModule,
    // API throttling (separate from the orchestrator's per-email-domain send throttle)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    // Edge
    PublicModule, AuthModule, CapabilityTokenModule, WebhooksModule,
    // Domain
    OrchestratorWorkersModule, EvalModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
