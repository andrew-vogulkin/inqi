import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { SnapshotsService } from '../../domain/snapshot/snapshots.service';
import { ReportSnapshotDto } from './snapshot-dto/snapshot.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.tokens';
import { ApiStandardErrors } from '../../common/errors';

/** Report webview by token. HP-24: authenticated + owner-scoped (token = resource id within owner scope). */
@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@ApiStandardErrors(401, 404) // every endpoint here can return these (ErrorEnvelope)
@Controller('snapshots')
export class SnapshotController {
  constructor(private readonly reports: SnapshotsService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Fetch a report by its webview token (owner/admin only)' })
  @ApiParam({ name: 'token', description: 'Report webview token', example: 'a1b2c3d4e5f6a1b2c3d4' })
  @ApiOkResponse({ type: ReportSnapshotDto })
  get(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    return this.reports.getByToken({ token, viewer: { sub: user.sub, email: user.email, role: user.role } });
  }
}
