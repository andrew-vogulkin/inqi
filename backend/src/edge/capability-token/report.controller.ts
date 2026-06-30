import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportsService } from '../../domain/reports/reports.service';
import { ReportDto } from './report-dto/report.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.tokens';

/** Report webview by token. HP-24: authenticated + owner-scoped (token = resource id within owner scope). */
@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('reports')
export class ReportController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Fetch a report by its webview token (owner/admin only)' })
  @ApiOkResponse({ type: ReportDto })
  get(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    return this.reports.getByToken({ token, viewer: { sub: user.sub, email: user.email, role: user.role } });
  }
}
