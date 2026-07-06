import { Module } from '@nestjs/common';
import { SnapshotsModule } from '../../domain/snapshot/snapshots.module';
import { AuthModule } from '../auth/auth.module';
import { PublicReportsController } from './public-reports.controller';

/** Edge: the live-report read for the webview. HP-24: now AuthGuard + ownership (no longer public). */
@Module({
  imports: [SnapshotsModule, AuthModule],
  controllers: [PublicReportsController],
})
export class PublicModule {}
