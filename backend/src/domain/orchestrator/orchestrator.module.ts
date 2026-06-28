import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { WorkflowEngine } from './workflow-engine.service';

/**
 * Domain: the orchestrator engine — the versioned workflow state machine. Depends
 * only on global infra + credits (HP-19 settlement on terminal transitions), so any
 * domain module can import it to fire transitions without a circular dependency on
 * the pipeline workers + agentic reactor (those live in {@link OrchestratorWorkersModule}).
 */
@Module({
  imports: [CreditsModule],
  providers: [WorkflowEngine],
  exports: [WorkflowEngine],
})
export class OrchestratorModule {}
