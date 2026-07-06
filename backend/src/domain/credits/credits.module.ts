import { Module } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { CreditsRepository } from './credits.repository';

/**
 * Domain: customer credits (HP-19). Depends only on global infra (persistence,
 * events, observability/audit, config), so the workflow engine + report intake +
 * edge controllers can all import it without a cycle.
 */
@Module({
  providers: [CreditsService, CreditsRepository],
  exports: [CreditsService],
})
export class CreditsModule {}
