import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { AuditService } from './audit.service';
import { AuditQueryService } from './audit-query.service';
import { HealthController } from './health.controller';

/** Infra (@Global): health + activity logging + audit sink (write) + audit projection (read). */
@Global()
@Module({
  controllers: [HealthController],
  providers: [ActivityService, AuditService, AuditQueryService],
  exports: [ActivityService, AuditService, AuditQueryService],
})
export class ObservabilityModule {}
