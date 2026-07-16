import { Module } from '@nestjs/common';
import { SourcesModule } from '../source/sources.module';
import { CreditsService } from './credits.service';
import { CreditsRepository } from './credits.repository';

/**
 * Domain: customer credits (HP-19). Depends on global infra (persistence, events,
 * observability/audit, config) + SourcesModule for the mail transport (credit-request
 * approval emails). SourcesModule only pulls ComplianceModule, so there's no cycle back.
 */
@Module({
  imports: [SourcesModule],
  providers: [CreditsService, CreditsRepository],
  exports: [CreditsService],
})
export class CreditsModule {}
