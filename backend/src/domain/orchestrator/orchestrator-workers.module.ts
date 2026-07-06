import { Module } from '@nestjs/common';
import { SubjectsModule } from '../subjects/subjects.module';
import { QuestionnaireModule } from '../questionnaire/questionnaire.module';
import { SnapshotsModule } from '../snapshot/snapshots.module';
import { PhasesModule } from '../phases/phases.module';
import { OrchestratorModule } from './orchestrator.module';
import { OrchestratorService } from './orchestrator.service';
import { WorkflowAdminService } from './workflow-admin.service';
import { WorkflowAdminRepository } from './workflow-admin.repository';

/**
 * Registers the orchestrator pipeline workers on init. Kept separate from
 * {@link OrchestratorModule} (which exports the engine) so domain modules can
 * import the engine without a dependency cycle through these workers. Also exports
 * the operator controls (HP-11) + workflow-version admin (HP-12) for the edge.
 */
@Module({
  imports: [OrchestratorModule, PhasesModule, SubjectsModule, QuestionnaireModule, SnapshotsModule],
  providers: [OrchestratorService, WorkflowAdminService, WorkflowAdminRepository],
  exports: [OrchestratorService, WorkflowAdminService],
})
export class OrchestratorWorkersModule {}
