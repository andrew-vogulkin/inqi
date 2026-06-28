import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InquiryService } from '../../domain/inquiry/inquiry.service';
import { ReportsService } from '../../domain/reports/reports.service';
import { CreateInquiryDto } from '../inquiry-dto/create-inquiry.dto';
import { InquiryDto } from '../inquiry-dto/inquiry.dto';
import { LiveReportDto } from './live-report.dto';

/** Public (unauthenticated) intake + the live-report read the customer webview streams. */
@ApiTags('public')
@Controller('inquiries')
export class PublicInquiriesController {
  constructor(
    private readonly inquiries: InquiryService,
    private readonly reports: ReportsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Submit a new inquiry' })
  @ApiCreatedResponse({ type: InquiryDto })
  create(@Body() dto: CreateInquiryDto) {
    return this.inquiries.create({ dto });
  }

  // HP-08: live-assembled report (from Findings) at any point. The inquiry id is
  // the customer's capability for their own webview.
  @Get(':id/report-live')
  @ApiOperation({ summary: 'Live-assembled report (ranked options + state) while the pipeline runs' })
  @ApiOkResponse({ type: LiveReportDto })
  reportLive(@Param('id') id: string) {
    return this.reports.live({ inquiryId: id });
  }
}
