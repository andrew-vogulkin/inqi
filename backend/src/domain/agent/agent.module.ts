import { Module } from '@nestjs/common';
import { SourcesModule } from '../source/sources.module';
import { ReportModule } from '../report/report.module';
import { AgentService } from './agent.service';
import { AgentRepository } from './agent.repository';

/**
 * Domain: agent logic + the 8 personas. Registers the per-inquiry + reply-loop
 * workers on init; exports AgentService so the inbound webhook can drive the loop.
 * Inquiry settlements are handed back to the orchestrator via the queue
 * (QueueJob.InquirySettled), so there's no direct dependency on it.
 */
@Module({
  imports: [SourcesModule, ReportModule],
  providers: [AgentService, AgentRepository],
  exports: [AgentService],
})
export class AgentModule {}
