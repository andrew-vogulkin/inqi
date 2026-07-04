import { Module } from '@nestjs/common';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { QuestionnaireService } from './questionnaire.service';
import { QuestionnaireGenerator } from './questionnaire-generator';
import { QuestionnaireRepository } from './questionnaire.repository';

/** Domain: tokened questionnaire link + mandatory confirm gate. */
@Module({
  imports: [OrchestratorModule, ComplianceModule],
  providers: [QuestionnaireService, QuestionnaireRepository, QuestionnaireGenerator],
  exports: [QuestionnaireService, QuestionnaireGenerator],
})
export class QuestionnaireModule {}
