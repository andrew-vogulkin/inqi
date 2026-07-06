import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { SubjectsModule } from '../subjects/subjects.module';
import { SubjectProvidersModule } from '../subject-providers/subject-providers.module';
import { QuestionnaireModule } from '../questionnaire/questionnaire.module';
import { SourcesModule } from '../source/sources.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { PhasesModule } from './phases.module';
import { PreResearchSteps } from './pre-research.steps';
import { BreadthSearchSteps } from './breadth-search.steps';
import { DepthSearchSteps } from './depth-search.steps';
import { AssembleFunnelService } from './assemble-funnel.service';

/**
 * The phase step handlers + their workers (ResearchBackground, AssembleFunnel).
 * Kept separate from {@link PhasesModule} (which exports the engine) so domain
 * modules can start/advance phase runs without a dependency cycle through the
 * handlers' domain-service graph — the same split the orchestrator uses.
 */
@Module({
  imports: [PhasesModule, OrchestratorModule, ComplianceModule, SubjectsModule, SubjectProvidersModule, QuestionnaireModule, SourcesModule],
  providers: [PreResearchSteps, BreadthSearchSteps, DepthSearchSteps, AssembleFunnelService],
})
export class PhaseHandlersModule {}
