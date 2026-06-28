import { Module } from '@nestjs/common';
import { WorkflowEngine } from './workflow-engine.service';

/**
 * Domain: the orchestrator engine — the versioned workflow state machine. Depends
 * only on global infra, so any domain module can import it to fire transitions
 * without a circular dependency on the pipeline workers + agentic reactor (those
 * live in {@link OrchestratorWorkersModule}).
 */
@Module({
  providers: [WorkflowEngine],
  exports: [WorkflowEngine],
})
export class OrchestratorModule {}
