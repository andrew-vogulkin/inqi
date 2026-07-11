import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportService } from '../../domain/report/report.service';
import { AdminGuard } from './admin.guard';
import { ReportSearchQueryDto, ReportSearchResultDto } from './report-search.dto';
import { ApiStandardErrors } from '../../common/errors';

/**
 * Admin report search — feeds the operator report picker (live board / run
 * controls / cost). Cursor-paginated so the picker can scroll indefinitely.
 */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@ApiStandardErrors(400, 401, 403) // every endpoint here can return these (ErrorEnvelope)
@Controller('admin/reports')
export class AdminReportSearchController {
  constructor(private readonly reports: ReportService) {}

  @Get()
  @ApiOperation({ summary: 'Search reports for the operator picker (ref / customer email / request text; newest-first, cursor-paginated)' })
  @ApiOkResponse({ type: ReportSearchResultDto })
  search(@Query() query: ReportSearchQueryDto) {
    return this.reports.search({ q: query.q, limit: query.limit, cursor: query.cursor });
  }
}
