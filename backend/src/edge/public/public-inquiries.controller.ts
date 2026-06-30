import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportsService } from '../../domain/reports/reports.service';
import { LiveReportDto } from './live-report.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.tokens';

/**
 * Live-report webview read. HP-24: now authenticated + owner-scoped — the inquiry id
 * is the resource id resolved within the owner's scope (401 unauth, 404 non-owner).
 */
@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('inquiries')
export class PublicInquiriesController {
  constructor(private readonly reports: ReportsService) {}

  // HP-08: live-assembled report (from Findings) at any point during the run.
  @Get(':id/report-live')
  @ApiOperation({ summary: 'Live-assembled report (ranked options + state); owner/admin only' })
  @ApiOkResponse({ type: LiveReportDto })
  reportLive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reports.live({ inquiryId: id, viewer: { sub: user.sub, email: user.email, role: user.role } });
  }
}
