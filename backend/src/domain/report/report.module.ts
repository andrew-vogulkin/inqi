import { Module } from '@nestjs/common';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { CreditsModule } from '../credits/credits.module';
import { ReportService } from './report.service';
import { ReportRepository } from './report.repository';
import { ReportContextService } from './report-context.service';

/** Domain: the report aggregate + lifecycle entry (HP-19: credit-gated intake). */
@Module({
  imports: [OrchestratorModule, CreditsModule],
  providers: [ReportService, ReportRepository, ReportContextService],
  exports: [ReportService, ReportContextService],
})
export class ReportModule {}
