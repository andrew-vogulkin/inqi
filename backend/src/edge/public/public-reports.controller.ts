import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { SnapshotsService } from '../../domain/snapshot/snapshots.service';
import { LiveReportDto } from './live-report.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.tokens';
import { ApiStandardErrors } from '../../common/errors';

/**
 * Live-report webview read. HP-24: now authenticated + owner-scoped — the report id
 * is the resource id resolved within the owner's scope (401 unauth, 404 non-owner).
 */
@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@ApiStandardErrors(401, 404) // every endpoint here can return these (ErrorEnvelope)
@Controller('reports')
export class PublicReportsController {
  constructor(private readonly reports: SnapshotsService) {}

  // HP-08: live-assembled report (from Findings) at any point during the run.
  @Get(':id/live')
  @ApiOperation({ summary: 'Live-assembled report (ranked options + state); owner/admin only' })
  @ApiParam({ name: 'id', description: 'Report id', example: 'clz1abcd0000xy' })
  @ApiOkResponse({ type: LiveReportDto })
  reportLive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reports.live({ reportId: id, viewer: { sub: user.sub, email: user.email, role: user.role } });
  }
}
