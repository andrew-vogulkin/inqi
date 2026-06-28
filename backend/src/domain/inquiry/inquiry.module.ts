import { Module } from '@nestjs/common';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { InquiryService } from './inquiry.service';
import { InquiryRepository } from './inquiry.repository';

/** Domain: the inquiry aggregate + lifecycle entry. */
@Module({
  imports: [OrchestratorModule],
  providers: [InquiryService, InquiryRepository],
  exports: [InquiryService],
})
export class InquiryModule {}
