import { Global, Module } from '@nestjs/common';
import { UsageContextService } from './usage-context.service';
import { UsageService } from './usage.service';
import { CostService } from './cost.service';
import { UsageReportService } from './usage-report.service';

/** Infra (@Global): usage ledger + async-local attribution context + cost rollup (HP-15). */
@Global()
@Module({
  providers: [UsageContextService, UsageService, CostService, UsageReportService],
  exports: [UsageContextService, UsageService, CostService, UsageReportService],
})
export class UsageModule {}
