import { Module } from '@nestjs/common';
import { QuestionnaireModule } from '../../domain/questionnaire/questionnaire.module';
import { SnapshotsModule } from '../../domain/snapshot/snapshots.module';
import { AuthModule } from '../auth/auth.module';
import { QuestionnaireController } from './questionnaire.controller';
import { SnapshotController } from './snapshot.controller';

/**
 * Edge: the report/questionnaire token surfaces. HP-24 retired the login-free tier —
 * these now sit behind AuthGuard + ownership; the token is just the resource id
 * resolved within the owner's scope.
 */
@Module({
  imports: [QuestionnaireModule, SnapshotsModule, AuthModule],
  controllers: [QuestionnaireController, SnapshotController],
})
export class CapabilityTokenModule {}
