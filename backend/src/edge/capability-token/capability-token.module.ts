import { Module } from '@nestjs/common';
import { QuestionnaireModule } from '../../domain/questionnaire/questionnaire.module';
import { ReportsModule } from '../../domain/reports/reports.module';
import { QuestionnaireController } from './questionnaire.controller';
import { ReportController } from './report.controller';

/** Edge: capability-token surfaces — a token grants exactly one capability, no login. */
@Module({
  imports: [QuestionnaireModule, ReportsModule],
  controllers: [QuestionnaireController, ReportController],
})
export class CapabilityTokenModule {}
