import { Global, Module } from '@nestjs/common';
import { UsageContextService } from './usage-context.service';
import { UsageService } from './usage.service';
import { CostService } from './cost.service';

/** Infra (@Global): usage ledger + async-local attribution context + cost rollup (HP-15). */
@Global()
@Module({
  providers: [UsageContextService, UsageService, CostService],
  exports: [UsageContextService, UsageService, CostService],
})
export class UsageModule {}
