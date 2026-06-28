import { Module } from '@nestjs/common';
import { InquiryModule } from '../../domain/inquiry/inquiry.module';
import { ReportsModule } from '../../domain/reports/reports.module';
import { PublicInquiriesController } from './public-inquiries.controller';

/** Edge: public (unauthenticated) intake surface + live-report read for the webview. */
@Module({
  imports: [InquiryModule, ReportsModule],
  controllers: [PublicInquiriesController],
})
export class PublicModule {}
