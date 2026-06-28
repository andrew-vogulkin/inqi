import { Module } from '@nestjs/common';
import { ReportsModule } from '../../domain/reports/reports.module';
import { PublicInquiriesController } from './public-inquiries.controller';

/** Edge: public (unauthenticated) live-report read for the webview (HP-19: intake moved to auth). */
@Module({
  imports: [ReportsModule],
  controllers: [PublicInquiriesController],
})
export class PublicModule {}
