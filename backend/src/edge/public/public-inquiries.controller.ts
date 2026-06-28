import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportsService } from '../../domain/reports/reports.service';
import { LiveReportDto } from './live-report.dto';

/**
 * Public (unauthenticated) read for the live-report webview. Intake moved to the
 * authenticated, credit-gated `POST /inquiries` (HP-19); **viewing stays login-free**
 * — the inquiry id is the customer's capability for their own report webview.
 */
@ApiTags('public')
@Controller('inquiries')
export class PublicInquiriesController {
  constructor(private readonly reports: ReportsService) {}

  // HP-08: live-assembled report (from Findings) at any point during the run.
  @Get(':id/report-live')
  @ApiOperation({ summary: 'Live-assembled report (ranked options + state) while the pipeline runs' })
  @ApiOkResponse({ type: LiveReportDto })
  reportLive(@Param('id') id: string) {
    return this.reports.live({ inquiryId: id });
  }
}
