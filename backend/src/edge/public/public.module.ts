import { Module } from '@nestjs/common';
import { ReportsModule } from '../../domain/reports/reports.module';
import { AuthModule } from '../auth/auth.module';
import { PublicInquiriesController } from './public-inquiries.controller';

/** Edge: the live-report read for the webview. HP-24: now AuthGuard + ownership (no longer public). */
@Module({
  imports: [ReportsModule, AuthModule],
  controllers: [PublicInquiriesController],
})
export class PublicModule {}
