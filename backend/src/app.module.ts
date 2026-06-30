import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

// Infra (@Global)
import { ConfigModule } from './infra/config/config.module';
import { PersistenceModule } from './infra/persistence/persistence.module';
import { QueueModule } from './infra/queue/queue.module';
import { EventsModule } from './infra/events/events.module';
import { AiModule } from './infra/ai/ai.module';
import { WebSearchModule } from './infra/websearch/websearch.module';
import { ObservabilityModule } from './infra/observability/observability.module';
import { UsageModule } from './infra/usage/usage.module';

// Edge / ingress
import { PublicModule } from './edge/public/public.module';
import { AuthModule } from './edge/auth/auth.module';
import { CapabilityTokenModule } from './edge/capability-token/capability-token.module';
import { WebhooksModule } from './edge/webhooks/webhooks.module';

// Domain workers + seams not reached transitively
import { OrchestratorWorkersModule } from './domain/orchestrator/orchestrator-workers.module';
import { NotificationModule } from './domain/notifications/notification.module';
import { EvalModule } from './domain/eval/eval.module';

@Module({
  imports: [
    // Infra
    ConfigModule, PersistenceModule, QueueModule, EventsModule, AiModule, WebSearchModule, ObservabilityModule, UsageModule,
    // API throttling (separate from the orchestrator's per-email-domain send throttle).
    // A report view fans out a provenance fetch per option (+polling), so the limit is
    // generous and env-tunable (THROTTLE_LIMIT / THROTTLE_TTL_MS).
    ThrottlerModule.forRoot([{ ttl: Number(process.env.THROTTLE_TTL_MS ?? 60_000), limit: Number(process.env.THROTTLE_LIMIT ?? 1000) }]),
    // Edge
    PublicModule, AuthModule, CapabilityTokenModule, WebhooksModule,
    // Domain
    OrchestratorWorkersModule, NotificationModule, EvalModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
