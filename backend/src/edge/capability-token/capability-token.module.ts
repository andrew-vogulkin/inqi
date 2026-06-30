import { Module } from '@nestjs/common';
import { QuestionnaireModule } from '../../domain/questionnaire/questionnaire.module';
import { ReportsModule } from '../../domain/reports/reports.module';
import { AuthModule } from '../auth/auth.module';
import { QuestionnaireController } from './questionnaire.controller';
import { ReportController } from './report.controller';

/**
 * Edge: the report/questionnaire token surfaces. HP-24 retired the login-free tier —
 * these now sit behind AuthGuard + ownership; the token is just the resource id
 * resolved within the owner's scope.
 */
@Module({
  imports: [QuestionnaireModule, ReportsModule, AuthModule],
  controllers: [QuestionnaireController, ReportController],
})
export class CapabilityTokenModule {}
