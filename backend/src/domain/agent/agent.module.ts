import { Module } from '@nestjs/common';
import { OutreachModule } from '../outreach/outreach.module';
import { AgentService } from './agent.service';
import { AgentRepository } from './agent.repository';

/**
 * Domain: agent logic + the 8 personas. Registers the per-subtask + reply-loop
 * workers on init; exports AgentService so the inbound webhook can drive the loop.
 * Subtask settlements are handed back to the orchestrator via the queue
 * (QueueJob.SubtaskSettled), so there's no direct dependency on it.
 */
@Module({
  imports: [OutreachModule],
  providers: [AgentService, AgentRepository],
  exports: [AgentService],
})
export class AgentModule {}
