import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { ObservabilityModule } from '../../infra/observability/observability.module';
import { ReportsService } from './reports.service';
import { ReportsRepository } from './reports.repository';

/** Domain: report synthesis + dynamic assembly (+ HP-21 freemium unlock charge/audit). */
@Module({
  imports: [CreditsModule, ObservabilityModule],
  providers: [ReportsService, ReportsRepository],
  exports: [ReportsService],
})
export class ReportsModule {}
