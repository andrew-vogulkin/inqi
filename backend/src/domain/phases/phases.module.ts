import { Module } from '@nestjs/common';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { PhaseEngine } from './phase-engine.service';
import { PhaseRunRepository } from './phase-run.repository';
import { PhaseRegistryService } from './phase-registry';
import { PhaseStepRegistry } from './phase-step.tokens';

/**
 * Domain: the phase-run engine — the generic state machine driving the
 * pre_research / breadth_search / depth_search workflow types. Depends only on
 * infra + the report WorkflowEngine (parent-event bridging), so any module can
 * start/advance phase runs without a cycle through the step handlers (those
 * live in {@link PhaseHandlersModule} — same split as the orchestrator).
 */
@Module({
  imports: [OrchestratorModule],
  providers: [PhaseEngine, PhaseRunRepository, PhaseRegistryService, PhaseStepRegistry],
  exports: [PhaseEngine, PhaseRunRepository, PhaseStepRegistry],
})
export class PhasesModule {}
