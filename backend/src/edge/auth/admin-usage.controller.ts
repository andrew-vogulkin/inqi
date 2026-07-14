import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsageReportService } from '../../infra/usage/usage-report.service';
import { AdminGuard } from './admin.guard';
import { UsageReportQueryDto, UsageReportResultDto } from './usage-report.dto';
import { ApiStandardErrors } from '../../common/errors';

/**
 * HP-15 — aggregate usage report: combined cost across every report in a date
 * window, plus the per-report breakdown for visibility. Admin-only; the sibling of
 * the per-report cost view (GET /reports/:id/cost).
 */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@ApiStandardErrors(400, 401, 403) // every endpoint here can return these (ErrorEnvelope)
@Controller('admin/usage')
export class AdminUsageController {
  constructor(private readonly usage: UsageReportService) {}

  @Get()
  @ApiOperation({ summary: 'Aggregate usage across all reports in a from/to window (admin only)' })
  @ApiOkResponse({ type: UsageReportResultDto })
  summary(@Query() query: UsageReportQueryDto): Promise<UsageReportResultDto> {
    return this.usage.summary({ from: query.from, to: query.to, limit: query.limit });
  }
}
