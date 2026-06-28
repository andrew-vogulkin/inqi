import { Module } from '@nestjs/common';
import { SubjectsModule } from '../subjects/subjects.module';
import { SubjectProvidersModule } from '../subject-providers/subject-providers.module';
import { QuestionnaireModule } from '../questionnaire/questionnaire.module';
import { ReportsModule } from '../reports/reports.module';
import { OrchestratorModule } from './orchestrator.module';
import { OrchestratorService } from './orchestrator.service';
import { OrchestratorRepository } from './orchestrator.repository';

/**
 * Registers the orchestrator pipeline workers on init. Kept separate from
 * {@link OrchestratorModule} (which exports the engine) so domain modules can
 * import the engine without a dependency cycle through these workers.
 */
@Module({
  imports: [OrchestratorModule, SubjectsModule, SubjectProvidersModule, QuestionnaireModule, ReportsModule],
  providers: [OrchestratorService, OrchestratorRepository],
  exports: [OrchestratorService], // operator controls (cancel) — HP-09 seam, HP-11 expands
})
export class OrchestratorWorkersModule {}
