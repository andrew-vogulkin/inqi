import { Module } from '@nestjs/common';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { CreditsModule } from '../credits/credits.module';
import { InquiryService } from './inquiry.service';
import { InquiryRepository } from './inquiry.repository';

/** Domain: the inquiry aggregate + lifecycle entry (HP-19: credit-gated intake). */
@Module({
  imports: [OrchestratorModule, CreditsModule],
  providers: [InquiryService, InquiryRepository],
  exports: [InquiryService],
})
export class InquiryModule {}
