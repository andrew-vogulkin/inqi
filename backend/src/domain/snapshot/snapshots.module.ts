import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { ReportModule } from '../report/report.module';
import { ObservabilityModule } from '../../infra/observability/observability.module';
import { SnapshotsService } from './snapshots.service';
import { SnapshotsRepository } from './snapshots.repository';

/** Domain: report synthesis + dynamic assembly (+ HP-21 freemium unlock charge/audit). */
@Module({
  imports: [CreditsModule, ObservabilityModule, ReportModule],
  providers: [SnapshotsService, SnapshotsRepository],
  exports: [SnapshotsService],
})
export class SnapshotsModule {}
