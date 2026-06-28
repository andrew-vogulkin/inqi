import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportsService } from '../../domain/reports/reports.service';
import { ReportDto } from './report-dto/report.dto';

/** Capability-token surface: the report webview via the tokened link (no login). */
@ApiTags('capability-token')
@Controller('reports')
export class ReportController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Fetch a report by its webview token' })
  @ApiOkResponse({ type: ReportDto })
  get(@Param('token') token: string) {
    return this.reports.getByToken({ token });
  }
}
